#!/usr/bin/env bash
# LOCAL-ONLY billing security hardening tests on THROW-AWAY PostgreSQL with synthetic data.
# Rebuilds the schema from THIS repo's migrations (Supabase-style default privileges), so the
# audited catalog is the one the migrations actually create. Refuses non-local hosts/credentials.
# Optional integration variants need PR #31 / #44 migration directories:
#   PR31_DIR=<dir containing supabase/migrations>  PR44_DIR=<same>
# (CI fetches refs/pull/31/head and refs/pull/44/head when available.)
set -euo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
HM=20261020180000_prompter_billing_security_hardening_p0
P() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -v ON_ERROR_STOP=1 "$@"; }
PL() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }   # lenient (known-unavailable extensions)
fail=0; ERR="$(mktemp)"
# main schema template (storage / pg_cron do not exist locally: those statements are skipped, nothing else)
P -d postgres -c "drop database if exists hard_tpl" -c "create database hard_tpl" >/dev/null
P -d hard_tpl -f "$here/support/base.sql" >/dev/null
for f in "$root"/supabase/migrations/2026*.sql; do
  case "$(basename "$f")" in "$HM.sql") continue;; esac
  PL -d hard_tpl -f "$f" >/dev/null 2>&1 || true
done
P -d hard_tpl -c "select 1 from prompter_subscriptions limit 0" >/dev/null   # template sanity
list31="20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard 20261019100200_prompter_p0_plan_entitlements_lockdown 20261019110000_prompter_trial_abuse_protection 20261019120000_prompter_shared_tables_truncate_delete_hardening"
m44=20261020160000_prompter_billing_financial_safety
dir31="${PR31_DIR:-}"; dir44="${PR44_DIR:-}"
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1 template hard_tpl" >/dev/null; }
ap31() { for m in $list31; do P -d "$1" -f "$dir31/supabase/migrations/$m.sql" >/dev/null; done; }
ap44() { P -d "$1" -f "$dir44/supabase/migrations/$m44.sql" >/dev/null; }
aph() { P -d "$1" -c "set app.allow_close_txn_insert_without_v2='${2:-no}'" -f "$root/supabase/migrations/$HM.sql" >/dev/null; }
aph_ov() { PGOPTIONS="-c app.allow_close_txn_insert_without_v2=yes" P -d "$1" -f "$root/supabase/migrations/$HM.sql" >/dev/null; }
run() { # name; fixtures must be loaded before the hardening migration
  echo "== $1"; }
variant() { # name, prep-fn, harden-fn
  local db="hv_$1"; mk "$db"; $2 "$db"
  P -d "$db" -f "$here/support/fixtures.sql" >/dev/null
  echo "== variant $1"; $3 "$db"; $3 "$db"   # twice = idempotent
  if P -d "$db" -f "$here/hardening_after.sql" >"$ERR.out" 2>&1; then :; else echo "FAILED variant $1:"; grep -E "ASSERTION|ERROR" "$ERR.out" | head -3; fail=1; fi
  grep -E "PASS|SKIP" "$ERR.out" | sed 's/^psql:[^ ]* //; s/^NOTICE:  //'
}
prep_main() { :; }
prep_31_44() { ap31 "$1"; ap44 "$1"; }
prep_44_31() { ap44 "$1"; ap31 "$1"; }
prep_31() { ap31 "$1"; }
# BEFORE: prove the holes on main as-is
mk hv_before; P -d hv_before -f "$here/support/fixtures.sql" >/dev/null
echo "== before (main as-is)"
if P -d hv_before -f "$here/hardening_before.sql" >"$ERR.out" 2>&1; then grep -E "PASS" "$ERR.out" | sed 's/^psql:[^ ]* //; s/^NOTICE:  //'; else echo "FAILED before-proof"; grep -E "ASSERTION|ERROR" "$ERR.out" | head -3; fail=1; fi
variant main_only prep_main aph_ov
if [ -n "$dir31" ] && [ -n "$dir44" ]; then
  variant pr31_pr44 prep_31_44 aph_ov
  variant pr44_pr31 prep_44_31 aph_ov
  # guard: refuses without #44 unless overridden
  mk hv_guard; P -d hv_guard -f "$here/support/fixtures.sql" >/dev/null
  if P -d hv_guard -f "$root/supabase/migrations/$HM.sql" >/dev/null 2>&1; then echo "FAIL guard: applied without #44"; fail=1; else echo "PASS: guard refuses to run before PR #44 (no silent cut of the legacy checkout)"; fi
  # hardening first, #44 afterwards (override) -> #44 still applies and works
  mk hv_h_first; P -d hv_h_first -f "$here/support/fixtures.sql" >/dev/null; aph_ov hv_h_first; ap31 hv_h_first; ap44 hv_h_first
  P -d hv_h_first -c "drop table t_pre" -f "$here/support/snapshot.sql" >/dev/null   # #31/#44 legitimately change other ACLs; compare from here
  P -d hv_h_first -f "$here/hardening_after.sql" >/dev/null 2>"$ERR" && echo "PASS: hardening applied BEFORE #31/#44 (override) -> both still apply and all checks pass" || { echo "FAIL h_first"; grep -E "ASSERTION|ERROR" "$ERR" | head -3; fail=1; }
  # rollback + reapply on the full stack
  mk hv_rb; prep_31_44 hv_rb; P -d hv_rb -f "$here/support/fixtures.sql" >/dev/null; aph_ov hv_rb
  P -d hv_rb -f "$root/supabase/rollback/$HM.down.sql" >/dev/null && P -d hv_rb -f "$root/supabase/rollback/$HM.down.sql" >/dev/null
  P -d hv_rb -f "$here/hardening_rollback.sql" 2>&1 | grep -E "PASS" | sed 's/^psql:[^ ]* //'
  P -d hv_rb -f "$here/hardening_rollback.sql" >/dev/null 2>"$ERR" || { echo "FAIL rollback"; grep -E "ASSERTION|ERROR" "$ERR"|head -3; fail=1; }
  mk hv_rb2; prep_31_44 hv_rb2; P -d hv_rb2 -f "$here/support/fixtures.sql" >/dev/null; aph_ov hv_rb2
  P -d hv_rb2 -f "$root/supabase/rollback/$HM.down.sql" >/dev/null; aph_ov hv_rb2
  P -d hv_rb2 -f "$here/hardening_after.sql" >/dev/null 2>"$ERR" && echo "PASS: rollback then REAPPLY -> all checks pass again" || { echo "FAIL reapply"; grep -E "ASSERTION|ERROR" "$ERR"|head -3; fail=1; }
fi
# guard on main-only
mk hv_guard_main; if P -d hv_guard_main -f "$root/supabase/migrations/$HM.sql" >/dev/null 2>&1; then echo "FAIL guard(main)"; fail=1; else echo "PASS: main-only database: migration refuses without PR #44"; fi
rm -f "$ERR"
[ $fail = 0 ] && echo "ALL HARDENING TESTS PASSED" || { echo "HARDENING TESTS FAILED"; exit 1; }
