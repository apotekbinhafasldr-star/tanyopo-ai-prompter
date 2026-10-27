#!/usr/bin/env bash
# LOCAL/CI-ONLY tests of the Phase E.1 approvals migration on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. REQUIRE_PG_MAJOR=17 (set in CI) refuses any other PostgreSQL major.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
M0=20261027100000_linoe_finance_foundation; M1=20261027110000_linoe_admin_center_access; M2=20261027130000_linoe_tax_optimization_approvals
DOWN="$root/supabase/rollback/$M2.down.sql"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
P() { PS -v ON_ERROR_STOP=1 "$@"; }
PA() { PS -At "$@"; }
fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null && P -d "$1" -f "$here/support.sql" >/dev/null; }
base() { for m in $M0 $M1; do P -d "$1" -f "$root/supabase/migrations/$m.sql" >/dev/null || return 1; done; }
mig() { P -d "$1" -f "$root/supabase/migrations/$M2.sql" >/dev/null; }

# 1) migrations apply in order, and the new one re-applies cleanly (idempotent)
mk tax_a; base tax_a && mig tax_a && mig tax_a && pass "migrations apply in order and the approvals migration re-applies cleanly" || bad "migration apply"

# 2) behaviour suite
if P -d tax_a -f "$here/tests.sql" >/tmp/tax_tests_$$.txt 2>&1; then
  n=$(grep -c 'PASS:' /tmp/tax_tests_$$.txt); pass "behaviour suite: $n checks passed (access, append-only, double submit, stale, RLS, grants, chain)"
else bad "behaviour suite"; grep -E "FAILED|ERROR" /tmp/tax_tests_$$.txt | head -5; fi

# 3) real parallel backends
mk tax_c; base tax_c && mig tax_c
if bash "$here/concurrency.sh" tax_c >/tmp/tax_conc_$$.txt 2>&1; then pass "$(grep 'concurrency:' /tmp/tax_conc_$$.txt)"; else bad "concurrency"; cat /tmp/tax_conc_$$.txt; fi

# 4) rollback: fail-closed with data, clean without
[ "$(grep -cE '^[[:space:]]*\\' "$DOWN")" = 0 ] && pass "rollback is plain SQL (no psql meta-command)" || bad "rollback has meta-commands"
if P -d tax_c -f "$DOWN" >/dev/null 2>/tmp/tax_rb_$$.txt; then bad "rollback must refuse while decisions exist"; else grep -q 'rollback refused' /tmp/tax_rb_$$.txt && pass "rollback refuses while decisions exist" || bad "rollback refused for the wrong reason"; fi
mk tax_r; base tax_r && mig tax_r
if P -d tax_r -f "$DOWN" >/dev/null 2>&1 && [ "$(PA -d tax_r -c "select to_regclass('public.tax_opt_decisions') is null and to_regprocedure('public.tax_opt_effective_status(text,text,text)') is null")" = t ]; then pass "rollback on an empty table removes everything it added"; else bad "rollback on empty"; fi
if [ "$(PA -d tax_r -c "select to_regclass('public.finance_platform_admins') is not null and to_regclass('public.finance_audit_logs') is not null")" = t ]; then pass "rollback leaves the earlier finance tables untouched"; else bad "rollback damaged earlier tables"; fi
P -d tax_r -f "$root/supabase/migrations/$M2.sql" >/dev/null 2>&1 && pass "migration can be re-applied after a rollback" || bad "re-apply after rollback"

# 4b) negative controls: the suite must FAIL when a guard is removed (so a green run means something)
for guard in "drop trigger trg_tax_opt_decision_guard on public.tax_opt_decisions" "drop trigger trg_finance_admins_no_escalation on public.finance_platform_admins" "drop trigger trg_tax_opt_decisions_immutable on public.tax_opt_decisions"; do
  mk tax_n; base tax_n && mig tax_n && P -d tax_n -c "$guard" >/dev/null
  if P -d tax_n -f "$here/tests.sql" >/dev/null 2>&1; then bad "negative control did not fail: $guard"; else pass "negative control fails the suite as it should: $guard"; fi
done

# 5) static properties of the migration
f="$root/supabase/migrations/$M2.sql"
grep -Eq '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$f" && bad "migration contains an email address" || pass "no email address is hard-coded"
grep -Eqi 'grant [^;]* to (anon|authenticated|public)' "$f" && bad "grants to anon/authenticated/public" || pass "nothing is granted to anon, authenticated or public"
grep -Eqi 'create policy' "$f" && bad "a policy exists" || pass "no RLS policy (default deny)"

[ "$fail" = 0 ] && echo "ALL TAX APPROVAL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
