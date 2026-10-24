#!/usr/bin/env bash
# LOCAL-ONLY privilege-hardening Phase 1 tests on a THROW-AWAY PostgreSQL with SYNTHETIC data.
# Rebuilds the schema from THIS repo's migrations (Supabase-style default privileges), so the audited
# catalog is the one the migrations really create. Refuses non-local hosts and any credential env var.
# Optional integration variants need other PRs' migration dirs (CI fetches them best-effort):
#   PR31_DIR PR44_DIR PR45_DIR = directory containing supabase/migrations of that PR
set -euo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
PH1=20261020190000_prompter_privilege_hardening_phase1
P() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -v ON_ERROR_STOP=1 "$@"; }
PL() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
W="$(mktemp -d)"; fail=0
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then  # CI pins PostgreSQL 17 (production is 17.x; MAINTAIN exists only from 17): refuse to run on anything else
  v=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d postgres -c "show server_version_num")
  [ $((v/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$v is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$v)"
fi
pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }

P -d postgres -c "drop database if exists p1_tpl" -c "create database p1_tpl" >/dev/null
P -d p1_tpl -f "$here/support/base.sql" >/dev/null
for f in "$root"/supabase/migrations/2026*.sql; do
  case "$(basename "$f")" in "$PH1.sql") continue;; esac
  PL -d p1_tpl -f "$f" >/dev/null 2>&1 || true      # storage / pg_cron-only statements are skipped locally
done
P -d p1_tpl -c "select 1 from prompter_subscriptions, prompter_ai_jobs limit 0" >/dev/null

mk() { P -d postgres -c "drop database if exists $1" -c "create database $1 template p1_tpl" >/dev/null; }
apm() { # <db> <dir> <migration-name>
  P -d "$1" -f "$2/supabase/migrations/$3.sql" >/dev/null; }
L31="20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard 20261019100200_prompter_p0_plan_entitlements_lockdown 20261019110000_prompter_trial_abuse_protection 20261019120000_prompter_shared_tables_truncate_delete_hardening"
M44=20261020160000_prompter_billing_financial_safety
M45=20261020180000_prompter_billing_security_hardening_p0
prep() { # <db> <variant>
  local db="$1"
  case "$2" in
    main) ;;
    pr31) for m in $L31; do apm "$db" "$PR31_DIR" "$m"; done ;;
    pr31_44_45) for m in $L31; do apm "$db" "$PR31_DIR" "$m"; done; apm "$db" "$PR44_DIR" "$M44"; apm "$db" "$PR45_DIR" "$M45" ;;
  esac
}
rbsql() { # <pairs|-> -> path of a plain-SQL copy of the rollback with the pairs filled in ("-" leaves the shipped placeholder untouched)
  local out="$W/rb_$RANDOM.sql"
  RB_IN="$root/supabase/rollback/$PH1.down.sql" RB_OUT="$out" RB_PAIRS="$1" python3 -c "
import os
s=open(os.environ['RB_IN']).read(); p=os.environ['RB_PAIRS']
if p!='-':
    d=\"v_raw text := 'REPLACE_WITH_PAIRS';\"
    assert s.count(d)==1
    s=s.replace(d, \"v_raw text := '\"+p.replace(\"'\",\"''\")+\"';\")
open(os.environ['RB_OUT'],'w').write(s)"
  echo "$out"
}
apply_ph1() { P -d "$1" -f "$root/supabase/migrations/$PH1.sql" >/dev/null; }

probe_variant() { # <name> <variant>
  local n="$1" v="$2" b="p1b_$1" a="p1a_$1"
  echo "== variant $n"
  mk "$b"; prep "$b" "$v"; P -d "$b" -f "$here/support/fixtures.sql" >/dev/null
  mk "$a"; prep "$a" "$v"; P -d "$a" -f "$here/support/fixtures.sql" >/dev/null
  P -d "$a" -f "$here/support/snapshot.sql" >/dev/null
  P -d "$a" -c "create table t_matrix_before as select * from t_matrix()" >/dev/null
  P -d "$b" -f "$here/probes.sql" >/dev/null
  apply_ph1 "$a"; apply_ph1 "$a"                                   # twice => idempotent
  pass "$n: migration applies and re-applies cleanly (idempotent)"
  P -d "$a" -f "$here/probes.sql" >/dev/null
  psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -F'|' -d "$b" -c "select name, result from t_probe order by name" > "$W/$n.before"
  psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -F'|' -d "$a" -c "select name, result from t_probe order by name" > "$W/$n.after"
  python3 "$here/compare_probes.py" "$W/$n.before" "$W/$n.after" "$here/expected_changes.txt" "$n" || fail=1
  # catalog assertions need a pre-probe state: rebuild a clean "after" DB
  local c="p1c_$1"; mk "$c"; prep "$c" "$v"; P -d "$c" -f "$here/support/fixtures.sql" >/dev/null
  P -d "$c" -f "$here/support/snapshot.sql" >/dev/null
  P -d "$c" -c "create table t_matrix_before as select * from t_matrix()" >/dev/null
  apply_ph1 "$c"
  if P -d "$c" -f "$here/assert_after.sql" >"$W/assert.out" 2>&1; then grep -E "NOTICE:  PASS" "$W/assert.out" | sed "s/^psql:[^ ]* //; s/^NOTICE:  /$n: /"; else echo "FAILED catalog assertions ($n)"; grep -E "ASSERTION|ERROR" "$W/assert.out" | head -3; fail=1; fi
  # hash of the post-Phase-1 matrix (used for the order-independence check)
  psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -F' ' -d "$c" -c "select 'matrix_after_hash', md5(string_agg(tbl||role||priv||granted, '' order by tbl,role,priv)) from t_matrix()" > "$W/$n.hash"
  # ---- rollback = fail-closed targeted forward-fix (never a mass restore) ----
  P -d "$c" -c "create table t_matrix_after_ph1 as select * from t_matrix()" >/dev/null
  local D="$root/supabase/rollback/$PH1.down.sql" diffq="select count(*) from t_matrix() a join t_matrix_after_ph1 b using (tbl,role,priv) where a.granted is distinct from b.granted"
  local refused=0 total=0 pr
  for pr in "<none>" "" "prompter_ai_jobs:UPDATE" "prompter_ai_jobs:DELETE" "prompter_payment_transactions:INSERT" "prompter_payment_transactions:UPDATE" \
            "prompter_jobs:TRUNCATE" "prompter_jobs:REFERENCES" "prompter_jobs:TRIGGER" "prompter_jobs:UPDATE,prompter_ai_jobs:UPDATE" \
            "prompter_oauth_credentials:SELECT" "prompter_audit_logs:DELETE" "prompter_audit_logs:UPDATE" "prompter_subscriptions:DELETE" \
            "prompter_subscriptions:UPDATE" "prompter_invoices:INSERT" "prompter_webhook_events:INSERT" "prompter_plan_entitlements:UPDATE" \
            "prompter_plan_entitlements:INSERT" "anon:SELECT" "prompter_nonexistent:UPDATE" "prompter_marketing_metrics:UPDATE"; do
    total=$((total+1))
    if [ "$pr" = "<none>" ]; then f=$(rbsql -); else f=$(rbsql "$pr"); fi
    o=$(PL -d "$c" -v ON_ERROR_STOP=1 -f "$f" 2>&1) && rc=0 || rc=1
    if [ "$rc" = 1 ] && echo "$o" | grep -q "refused"; then refused=$((refused+1)); else echo "   NOT REFUSED: '$pr' rc=$rc"; fi
  done
  [ "$refused" = "$total" ] && pass "$n: rollback refuses $total forbidden/ambiguous requests (none, TRUNCATE, anon, ai_jobs, payment_transactions, invoices, webhooks, entitlements, audit, subscriptions, vault, mixed valid+invalid, unknown)" || bad "$n: only $refused/$total refused"
  r0=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "$diffq")
  [ "$r0" = 0 ] && pass "$n: refused rollbacks changed nothing (all-or-nothing)" || bad "$n: refused rollback changed $r0 cell(s)"
  P -d "$c" -f "$(rbsql 'prompter_jobs:UPDATE')" >/dev/null 2>&1
  r1=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "$diffq")
  [ "$r1" = 1 ] && pass "$n: restoring one named pair changes exactly that one cell" || bad "$n: single-pair restore changed $r1 cell(s)"
  P -d "$c" -f "$(rbsql 'prompter_jobs:INSERT,prompter_jobs:UPDATE,prompter_jobs:DELETE,prompter_platform_capabilities:INSERT,prompter_platform_capabilities:UPDATE,prompter_platform_capabilities:DELETE,prompter_product_snapshots:INSERT,prompter_product_snapshots:UPDATE,prompter_product_snapshots:DELETE')" >/dev/null 2>&1
  nr=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from t_matrix() a join t_matrix_after_ph1 b using (tbl,role,priv) where a.granted is distinct from b.granted and not (a.role='authenticated' and a.granted and a.priv in ('INSERT','UPDATE','DELETE') and a.tbl in ('prompter_jobs','prompter_platform_capabilities','prompter_product_snapshots'))")
  rr=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from t_matrix() a join t_matrix_after_ph1 b using (tbl,role,priv) where b.granted and not a.granted")
  [ "$nr" = 0 ] && [ "$rr" = 0 ] && pass "$n: maximum permitted rollback re-opens only the 9 allowed authenticated cells (no TRUNCATE/anon/financial/quota cell, nothing removed)" || bad "$n: max rollback side effects ($nr new dangerous, $rr removed)"
  # rollback must not re-open anything another migration (#31/#44/#45) had already closed BEFORE Phase 1
  closed_elsewhere=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from t_matrix_before b join t_matrix() a using (tbl,role,priv) where b.role='authenticated' and not b.granted and a.granted and not exists (select 1 from t_matrix_after_ph1 z where z.tbl=b.tbl and z.role=b.role and z.priv=b.priv and z.granted)")
  [ "$closed_elsewhere" = 0 ] && pass "$n: rollback re-opens no cell that was already closed before Phase 1 (by #31/#44/#45 or defaults)" || bad "$n: rollback re-opened $closed_elsewhere cell(s) closed before Phase 1"
  dang=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from t_matrix() where granted and role in ('anon','authenticated') and (role='anon' or priv in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))")
  [ "$dang" = 0 ] && pass "$n: after rollback no anon privilege and no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN exists on any prompter_* table" || bad "$n: $dang anon/TRUNCATE cells after rollback"
  if [ "$v" = pr31_44_45 ]; then
    chk=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select
       not has_table_privilege('authenticated','public.prompter_ai_jobs','UPDATE')
       and not has_column_privilege('authenticated','public.prompter_ai_jobs','created_at','UPDATE')
       and not has_column_privilege('authenticated','public.prompter_ai_jobs','tenant_id','UPDATE')
       and has_column_privilege('authenticated','public.prompter_ai_jobs','status','UPDATE')
       and not has_table_privilege('authenticated','public.prompter_ai_jobs','INSERT')
       and not has_table_privilege('authenticated','public.prompter_ai_jobs','DELETE')
       and not has_table_privilege('authenticated','public.prompter_payment_transactions','INSERT')
       and not has_table_privilege('authenticated','public.prompter_payment_transactions','UPDATE')
       and not has_table_privilege('authenticated','public.prompter_payment_transactions','DELETE')
       and has_column_privilege('authenticated','public.prompter_subscriptions','plan','UPDATE') = (select granted from t_matrix_after_ph1 where tbl='prompter_subscriptions' and priv='COLUMN_UPDATE_PLAN')")
    [ "$chk" = t ] && pass "$n: after rollback ai_jobs UPDATE/INSERT/DELETE (table + created_at/tenant_id) and payment_transactions INSERT/UPDATE/DELETE stay closed; completion columns stay writable" || bad "$n: a quota/financial privilege is open after rollback"
  fi
  # negative control: the OLD mass-restore script must be caught by the same detector
  P -d postgres -c "drop database if exists p1_legacy" -c "create database p1_legacy template p1c_$1" >/dev/null 2>&1 || { P -d "$c" -c "select 1" >/dev/null; }
  local lg="p1l_$1"; mk "$lg"; prep "$lg" "$v"; P -d "$lg" -f "$here/support/fixtures.sql" >/dev/null; apply_ph1 "$lg"
  P -d "$lg" -c "create table t_matrix_after_ph1 as select * from t_matrix()" >/dev/null
  P -d "$lg" -f "$here/support/legacy_mass_restore.sql" >/dev/null
  reopened=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$lg" -c "select count(*) from t_matrix() a join t_matrix_after_ph1 b using (tbl,role,priv) where a.granted and not b.granted")
  legacy_bad=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$lg" -c "select count(*) from t_matrix() where granted and role in ('anon','authenticated') and (role='anon' or priv='TRUNCATE')")
  [ "$legacy_bad" -gt 0 ] && pass "$n: negative control — the legacy mass-restore re-opens $reopened cells ($legacy_bad anon/TRUNCATE); the detector catches it" || bad "$n: detector did not catch the legacy mass-restore"
  if [ "$v" = pr31_44_45 ]; then
    lc=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$lg" -c "select has_table_privilege('authenticated','public.prompter_ai_jobs','UPDATE') and has_table_privilege('authenticated','public.prompter_payment_transactions','INSERT')")
    [ "$lc" = t ] && pass "$n: negative control — legacy script DID re-open ai_jobs UPDATE + payment_transactions INSERT (the PR #46 defect, now impossible)" || bad "$n: legacy control did not reproduce the defect"
  fi
  apply_ph1 "$c"
  r3=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from ((select * from t_matrix() except select * from t_matrix_after_ph1) union all (select * from t_matrix_after_ph1 except select * from t_matrix())) x")
  [ "$r3" = 0 ] && pass "$n: re-apply after targeted rollback reproduces the exact post-state" || bad "$n: reapply differs ($r3)"
}

probe_variant main_only main
if [ -n "${PR31_DIR:-}" ] && [ -n "${PR44_DIR:-}" ] && [ -n "${PR45_DIR:-}" ]; then
  probe_variant pr31_pr44_pr45_then_ph1 pr31_44_45
  # order independence: Phase 1 FIRST, then #31, #44, #45 => same final matrix as the reverse order
  mk p1_order; P -d p1_order -f "$here/support/fixtures.sql" >/dev/null; apply_ph1 p1_order
  for m in $L31; do apm p1_order "$PR31_DIR" "$m"; done; apm p1_order "$PR44_DIR" "$M44"; apm p1_order "$PR45_DIR" "$M45"
  h=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -F' ' -d p1_order -c "select 'matrix_after_hash', md5(string_agg(tbl||role||priv||granted, '' order by tbl,role,priv)) from t_matrix()")
  hh=$(cat "$W/pr31_pr44_pr45_then_ph1.hash")
  [ "$h" = "$hh" ] && pass "order-independent: Phase 1 before OR after #31/#44/#45 yields the identical privilege matrix" || bad "order matters: '$h' vs '$hh'"
  # no table created by #31/#44 is left with TRUNCATE for clients
  n=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d p1_order -c "select count(*) from t_matrix() where priv='TRUNCATE' and granted and role in ('anon','authenticated')")
  [ "$n" = 0 ] && pass "combined: no prompter_* table (incl. #31/#44 tables) grants TRUNCATE to a client role" || bad "combined: $n TRUNCATE grants remain"
else
  echo "SKIP: PR #31/#44/#45 integration variants (PR31_DIR/PR44_DIR/PR45_DIR not provided)"
fi


# ---- ROLLBACK STATIC + GUARD CONTROLS ----
RBF="$root/supabase/rollback/$PH1.down.sql"
[ "$(grep -cE '^[[:space:]]*\\' "$RBF")" = 0 ] && pass "rollback is plain SQL: no psql meta-command line (no \\set/\\if/\\gset/\\echo)" || bad "rollback contains psql meta-commands"
grep -qE ':\{\?|:'"'"'pairs|\bpsql\b -v' <(grep -vE '^[[:space:]]*--' "$RBF") && bad "rollback still references psql variables" || pass "rollback has no psql variable interpolation"
# the shipped (unedited) file must refuse
mk p1_rbplain; P -d p1_rbplain -f "$here/support/fixtures.sql" >/dev/null; apply_ph1 p1_rbplain
if PL -d p1_rbplain -v ON_ERROR_STOP=1 -f "$RBF" >"$W/rbp.out" 2>&1; then bad "unedited rollback ran"; else grep -q "refused" "$W/rbp.out" && pass "unedited rollback file refuses (fail-closed default)" || bad "unedited rollback failed for another reason"; fi
# GUARD: a policy that covers the command, or RLS off, must make the rollback refuse (cannot open a real write path)
mk p1_rbg; P -d p1_rbg -f "$here/support/fixtures.sql" >/dev/null; apply_ph1 p1_rbg
P -d p1_rbg -c "create policy t_ins on public.prompter_jobs for insert to authenticated with check (true)" >/dev/null
o=$(PL -d p1_rbg -v ON_ERROR_STOP=1 -f "$(rbsql 'prompter_jobs:INSERT')" 2>&1) && bad "rollback ran although an INSERT policy exists" || { echo "$o" | grep -q "policy covers" && pass "guard: refuses when a policy covers the command" || bad "guard(policy): wrong failure: $o"; }
P -d p1_rbg -c "drop policy t_ins on public.prompter_jobs" -c "create policy t_all on public.prompter_jobs for all to authenticated using (true)" >/dev/null
o=$(PL -d p1_rbg -v ON_ERROR_STOP=1 -f "$(rbsql 'prompter_jobs:DELETE')" 2>&1) && bad "rollback ran although an ALL policy exists" || { echo "$o" | grep -q "policy covers" && pass "guard: refuses when a FOR ALL policy covers the command" || bad "guard(all): wrong failure: $o"; }
P -d p1_rbg -c "drop policy t_all on public.prompter_jobs" -c "alter table public.prompter_jobs disable row level security" >/dev/null
o=$(PL -d p1_rbg -v ON_ERROR_STOP=1 -f "$(rbsql 'prompter_jobs:UPDATE')" 2>&1) && bad "rollback ran although RLS is disabled" || { echo "$o" | grep -q "RLS is not enabled" && pass "guard: refuses when RLS is disabled" || bad "guard(rls): wrong failure: $o"; }
chg=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d p1_rbg -c "select has_table_privilege('authenticated','public.prompter_jobs','UPDATE') or has_table_privilege('authenticated','public.prompter_jobs','INSERT') or has_table_privilege('authenticated','public.prompter_jobs','DELETE')")
[ "$chg" = f ] && pass "guard: refused requests left prompter_jobs closed" || bad "guard: a refused request changed prompter_jobs"
# injection attempt through the pair list is refused by the format check
o=$(PL -d p1_rbplain -v ON_ERROR_STOP=1 -f "$(rbsql "prompter_jobs:UPDATE'; drop table public.prompter_jobs; --")" 2>&1) && bad "malformed pair list ran" || { echo "$o" | grep -q "refused" && pass "malformed/injection pair list refused" || bad "malformed list: wrong failure"; }
psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d p1_rbplain -c "select to_regclass('public.prompter_jobs') is not null" | grep -q t && pass "injection attempt left prompter_jobs in place" || bad "prompter_jobs dropped"

# fail-closed: an event trigger that re-grants TRUNCATE right after any REVOKE must make the migration ABORT
mk p1_fc; P -d p1_fc -f "$here/support/fixtures.sql" >/dev/null
P -d p1_fc >/dev/null <<'SQL'
create function public.t_regrant() returns event_trigger language plpgsql as $$ begin
  if tg_tag = 'REVOKE' then execute 'grant truncate on public.prompter_invoices to authenticated'; end if; end $$;
create event trigger t_regrant_trg on ddl_command_end when tag in ('REVOKE') execute function public.t_regrant();
SQL
if P -d p1_fc -f "$root/supabase/migrations/$PH1.sql" >"$W/fc.out" 2>&1; then bad "fail-closed: migration did NOT abort although TRUNCATE was re-granted"; else grep -q "post-check failed" "$W/fc.out" && pass "fail-closed: migration aborts (post-check) if a revoke does not stick" || bad "fail-closed: aborted for another reason: $(head -2 "$W/fc.out")"; fi

# ---- NEGATIVE CONTROLS (mutation tests): each deliberately broken copy of the migration MUST abort with a post-check error ----
SRV=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d postgres -c "show server_version_num")
mut() { # <label> <python-snippet that edits variable s> -- expects the broken migration to be refused by its own post-checks
  local label="$1" py="$2" db="p1_mut_$$"
  mk "$db"; P -d "$db" -f "$here/support/fixtures.sql" >/dev/null
  MUT_IN="$root/supabase/migrations/$PH1.sql" MUT_OUT="$W/mut.sql" python3 -c "
import os,re
s=open(os.environ['MUT_IN']).read()
marker='  -- ---- fail-closed post-checks'
$py
open(os.environ['MUT_OUT'],'w').write(s)"
  if PL -d "$db" -v ON_ERROR_STOP=1 -f "$W/mut.sql" >"$W/mut.out" 2>&1; then bad "mutation '$label': broken migration was ACCEPTED"; else
    grep -q "post-check failed" "$W/mut.out" && pass "mutation '$label': refused by the migration's own post-check ($(grep -o 'post-check failed: [^"]*' "$W/mut.out" | head -1 | cut -c1-90))" || bad "mutation '$label': failed for another reason: $(head -2 "$W/mut.out")"; fi
}
mut "extra REVOKE SELECT from authenticated (flow breaker)" "s=s.replace(marker,'  revoke select on public.prompter_products from authenticated;\n'+marker,1)"
mut "service_role loses TRUNCATE"                          "s=s.replace(marker,'  revoke truncate on public.prompter_products from service_role;\n'+marker,1)"
mut "REFERENCES/TRIGGER revoke removed"                     "s=s.replace(\"    execute format('revoke references, trigger on public.%I from public, anon, authenticated', t);\n\",'',1)"
mut "REFERENCES re-granted to authenticated"                "s=s.replace(marker,'  grant references on public.prompter_products to authenticated;\n'+marker,1)"
mut "TRIGGER re-granted to authenticated"                   "s=s.replace(marker,'  grant trigger on public.prompter_products to authenticated;\n'+marker,1)"
mut "PUBLIC granted SELECT"                                  "s=s.replace(marker,'  grant select on public.prompter_products to public;\n'+marker,1)"
mut "new column-level grant appears"                        "s=s.replace(marker,'  grant select (id) on public.prompter_products to authenticated;\n'+marker,1)"
mut "anon re-granted SELECT"                                 "s=s.replace(marker,'  grant select on public.prompter_products to anon;\n'+marker,1)"
if [ "$SRV" -ge 170000 ]; then
  mut "MAINTAIN revoke removed (PostgreSQL 17)"            "s=s.replace(\"      execute format('revoke maintain on public.%I from public, anon, authenticated', t);\n\",'      null;\n',1)"
  mut "MAINTAIN re-granted to authenticated (PostgreSQL 17)" "s=s.replace(marker,'  grant maintain on public.prompter_products to authenticated;\n'+marker,1)"
else
  echo "SKIP: MAINTAIN mutation controls need PostgreSQL 17 (server_version_num=$SRV); the CI job runs them on 17"
  # PostgreSQL < 17 must still APPLY the migration: MAINTAIN is only ever issued through EXECUTE under a version guard
  grep -q "grant maintain" "$root/supabase/migrations/$PH1.sql" && bad "migration must never GRANT maintain" || pass "PostgreSQL $SRV: migration applied above without parsing MAINTAIN (dynamic, version-guarded)"
fi

# no production-looking target anywhere in the harness
[ -n "${KEEP_W:-}" ] && echo "kept: $W" || rm -rf "$W"
[ "$fail" = 0 ] && echo "ALL PHASE-1 LOCAL TESTS PASSED (synthetic PostgreSQL only; says nothing about production by itself)" || { echo "SOME TESTS FAILED"; exit 1; }
