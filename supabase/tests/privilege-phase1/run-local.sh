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
  # rollback => EXACT pre-state. When #31/#44/#45 were applied BEFORE Phase 1, the down script re-opens
  # what they closed (documented), so those PRs' migrations are re-run afterwards, as the runbook says.
  P -d "$c" -c "create table t_matrix_after_ph1 as select * from t_matrix()" >/dev/null
  P -d "$c" -f "$root/supabase/rollback/$PH1.down.sql" >/dev/null
  if [ "$v" = pr31_44_45 ]; then
    for m in $L31; do apm "$c" "$PR31_DIR" "$m"; done; apm "$c" "$PR44_DIR" "$M44"; apm "$c" "$PR45_DIR" "$M45"
    rbmsg="rollback + re-run of #31/#44/#45 migrations"
  else rbmsg="rollback"; fi
  r1=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from (select * from t_matrix() except select * from t_matrix_before) x") 
  r2=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from (select * from t_matrix_before except select * from t_matrix()) x")
  [ "$r1" = 0 ] && [ "$r2" = 0 ] && pass "$n: $rbmsg restores the exact pre-Phase-1 privilege matrix" || bad "$n: $rbmsg differs from pre-state ($r1/$r2)"
  apply_ph1 "$c"
  r3=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from ((select * from t_matrix() except select * from t_matrix_after_ph1) union all (select * from t_matrix_after_ph1 except select * from t_matrix())) x")
  [ "$r3" = 0 ] && pass "$n: re-apply after rollback reproduces the exact post-state" || bad "$n: reapply differs ($r3)"
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
