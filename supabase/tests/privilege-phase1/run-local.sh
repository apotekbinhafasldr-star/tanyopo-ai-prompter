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
    if [ "$pr" = "<none>" ]; then o=$(PL -d "$c" -v ON_ERROR_STOP=1 -f "$D" 2>&1) && rc=0 || rc=1
    else o=$(PL -d "$c" -v ON_ERROR_STOP=1 -v pairs="$pr" -f "$D" 2>&1) && rc=0 || rc=1; fi
    if [ "$rc" = 1 ] && echo "$o" | grep -q "refused"; then refused=$((refused+1)); else echo "   NOT REFUSED: '$pr' rc=$rc"; fi
  done
  [ "$refused" = "$total" ] && pass "$n: rollback refuses $total forbidden/ambiguous requests (none, TRUNCATE, anon, ai_jobs, payment_transactions, invoices, webhooks, entitlements, audit, subscriptions, vault, mixed valid+invalid, unknown)" || bad "$n: only $refused/$total refused"
  r0=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "$diffq")
  [ "$r0" = 0 ] && pass "$n: refused rollbacks changed nothing (all-or-nothing)" || bad "$n: refused rollback changed $r0 cell(s)"
  P -d "$c" -v pairs='prompter_jobs:UPDATE' -f "$D" >/dev/null 2>&1
  r1=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "$diffq")
  [ "$r1" = 1 ] && pass "$n: restoring one named pair changes exactly that one cell" || bad "$n: single-pair restore changed $r1 cell(s)"
  P -d "$c" -v pairs='prompter_jobs:INSERT,prompter_jobs:UPDATE,prompter_jobs:DELETE,prompter_platform_capabilities:INSERT,prompter_platform_capabilities:UPDATE,prompter_platform_capabilities:DELETE,prompter_product_snapshots:INSERT,prompter_product_snapshots:UPDATE,prompter_product_snapshots:DELETE' -f "$D" >/dev/null 2>&1
  nr=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from t_matrix() a join t_matrix_after_ph1 b using (tbl,role,priv) where a.granted is distinct from b.granted and not (a.role='authenticated' and a.granted and a.priv in ('INSERT','UPDATE','DELETE') and a.tbl in ('prompter_jobs','prompter_platform_capabilities','prompter_product_snapshots'))")
  rr=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from t_matrix() a join t_matrix_after_ph1 b using (tbl,role,priv) where b.granted and not a.granted")
  [ "$nr" = 0 ] && [ "$rr" = 0 ] && pass "$n: maximum permitted rollback re-opens only the 9 allowed authenticated cells (no TRUNCATE/anon/financial/quota cell, nothing removed)" || bad "$n: max rollback side effects ($nr new dangerous, $rr removed)"
  dang=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$c" -c "select count(*) from t_matrix() where granted and (role='anon' or priv='TRUNCATE')")
  [ "$dang" = 0 ] && pass "$n: after rollback no anon privilege and no TRUNCATE exists on any prompter_* table" || bad "$n: $dang anon/TRUNCATE cells after rollback"
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
  legacy_bad=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d "$lg" -c "select count(*) from t_matrix() where granted and (role='anon' or priv='TRUNCATE')")
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
  n=$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -d p1_order -c "select count(*) from t_matrix() where priv='TRUNCATE' and granted")
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

# no production-looking target anywhere in the harness
[ -n "${KEEP_W:-}" ] && echo "kept: $W" || rm -rf "$W"
[ "$fail" = 0 ] && echo "ALL PHASE-1 LOCAL TESTS PASSED (synthetic PostgreSQL only; says nothing about production by itself)" || { echo "SOME TESTS FAILED"; exit 1; }
