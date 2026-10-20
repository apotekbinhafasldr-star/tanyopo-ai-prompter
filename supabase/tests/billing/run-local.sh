#!/usr/bin/env bash
# Local-only billing safety tests. Synthetic data, throw-away databases. Refuses non-local hosts.
set -euo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
case "${DATABASE_URL:-}${SUPABASE_URL:-}" in *supabase.co*|*supabase.com*) echo "REFUSED: remote Supabase env present" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
mig="$root/supabase/migrations/20261020160000_prompter_billing_financial_safety.sql"
down="$root/supabase/rollback/20261020160000_prompter_billing_financial_safety.down.sql"
P() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -v ON_ERROR_STOP=1 "$@"; }
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1"
  P -d "$1" -f "$here/support/schema.sql"
  python3 "$here/support/load_v1.py" "$root" | P -d "$1"; }
fail=0
echo "== before (v1 holes)"; mk billing_before; P -d billing_before -f "$here/billing_before.sql" || fail=1
echo "== after (v2)"; mk billing_after; P -d billing_after -f "$mig"; P -d billing_after -f "$mig"
P -d billing_after -f "$here/billing_after.sql" || fail=1
echo "== rollback"; mk billing_rb; P -d billing_rb -f "$mig"; P -d billing_rb -f "$down"; P -d billing_rb -f "$down"
P -d billing_rb -f "$here/billing_rollback.sql" || fail=1
if [ -x "$here/billing_concurrency.sh" ]; then echo "== concurrency"; bash "$here/billing_concurrency.sh" || fail=1; fi
[ $fail = 0 ] && echo "ALL BILLING TESTS PASSED" || { echo "FAILURES"; exit 1; }
