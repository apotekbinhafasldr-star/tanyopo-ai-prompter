#!/usr/bin/env bash
# LOCAL-ONLY P0 plan-tampering tests on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. REQUIRE_PG_MAJOR=17 (set in CI) refuses any other major.
# Proves: BEFORE the migration an Owner can change `plan` by direct UPDATE (the hole); AFTER it cannot, at every
# status and from every tenant, while the trial preference RPC, the verified payment path, cancellation and the
# sweeps keep working; the S1 trial migrations compose with it in both orders; rollback is fail-closed.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
MIG="$root/supabase/migrations/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql"
DOWN="$root/supabase/rollback/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.down.sql"
S1="20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard 20261019100200_prompter_p0_plan_entitlements_lockdown"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
P() { PS -v ON_ERROR_STOP=1 "$@"; }
PA() { PS -At "$@"; }
W="$(mktemp -d)"; fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi

# the REAL billing functions, extracted verbatim from the repository migrations (no copy that could drift)
python3 - "$root" "$W/real_fns.sql" <<'PY'
import re, sys
root, out = sys.argv[1], sys.argv[2]
s = open(f"{root}/supabase/migrations/20260915051359_prompter_b10_payment_billing_core.sql").read()
parts = []
for n in ("fn_apply_verified_payment", "fn_schedule_cancellation", "fn_apply_scheduled_cancellations"):
    m = re.search(r"create or replace function public\." + n + r"\(.*?\n\$\$;", s, re.S)
    assert m, n
    parts.append(m.group(0))
    parts += re.findall(r"^(?:revoke|grant)[^;]*function public\." + n + r"\([^;]*;", s, re.M)
open(out, "w").write("\n".join(parts) + "\n")
PY
[ -s "$W/real_fns.sql" ] && pass "real B10 functions extracted from the repository migration" || bad "extraction failed"

mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null \
  && P -d "$1" -f "$here/../s1-trial-quota/support/prod_snapshot.sql" >/dev/null \
  && P -d "$1" -f "$here/support/billing_functions.sql" >/dev/null && P -d "$1" -f "$W/real_fns.sql" >/dev/null \
  && P -d "$1" -f "$here/support/seed.sql" >/dev/null; }
OTHERS="select md5(coalesce(string_agg(x, '|' order by x), '')) from (select 'pol:' || tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'') x from pg_policies where tablename <> 'prompter_subscriptions' union all select 'grant:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema='public' and table_name <> 'prompter_subscriptions') z"
ROWS="select md5(coalesce(string_agg(t::text, '|' order by tenant_id), '')) from (select tenant_id,plan,status,billing_provider,current_period_end from prompter_subscriptions) t"
mig() { P -1 -d "$1" -f "$MIG" >/dev/null; }
s1() { for m in $S1; do P -1 -d "$1" -f "$root/supabase/migrations/$m.sql" >/dev/null || return 1; done; }
suite() { # <db> <phase_after> <label>
  local rows others; rows=$(PA -d "$1" -c "$ROWS"); others=$(PA -d "$1" -c "$OTHERS")
  if [ "${4:-}" != "" ]; then rows="$4"; others="$5"; fi
  if P -d "$1" -v phase_after="$2" -v rows_md5_before="$rows" -v others_md5_before="$others" -f "$here/plan_tampering.sql" >"$W/o.txt" 2>&1; then
    pass "$3: $(grep -c 'PASS:' "$W/o.txt") checks ($(grep -E 'ALL PASS' "$W/o.txt" | tr -d ' ' | head -1))"
  else bad "$3"; grep -E "FAIL|ERROR" "$W/o.txt" | head -8; fi
}

# 1) BEFORE: the hole exists on the reconstructed production state
mk pt_before && suite pt_before false "before the migration (hole reproduced, legit paths work)" || bad "mk pt_before"

# 2) AFTER: only this migration (the real production state: S1 is not applied there yet); idempotent
mk pt_after || bad "mk pt_after"
R0=$(PA -d pt_after -c "$ROWS"); O0=$(PA -d pt_after -c "$OTHERS")
mig pt_after && pass "migration applies in one transaction" || bad "migration failed"
mig pt_after && pass "migration re-applies cleanly (idempotent)" || bad "re-apply failed"
suite pt_after true "after the migration" "$R0" "$O0"

# 3) composition with the S1 trial migrations, both orders
mk pt_s1a || bad mk; R1=$(PA -d pt_s1a -c "$ROWS"); O1=$(PA -d pt_s1a -c "$OTHERS"); s1 pt_s1a && mig pt_s1a && pass "S1 then plan-tampering applies" || bad "S1 then mig failed"
suite pt_s1a true "S1 first, then this migration" "$R1" "$(PA -d pt_s1a -c "$OTHERS")"
mk pt_s1b || bad mk; R2=$(PA -d pt_s1b -c "$ROWS"); mig pt_s1b && s1 pt_s1b && pass "plan-tampering then S1 applies" || bad "mig then S1 failed"
suite pt_s1b true "this migration first, then S1" "$R2" "$(PA -d pt_s1b -c "$OTHERS")"

# 4) rollback is fail-closed and, when explicitly confirmed, restores exactly the previous behaviour
mk pt_rb; mig pt_rb
if PS -d pt_rb -v ON_ERROR_STOP=1 -f "$DOWN" >"$W/rb1.txt" 2>&1; then bad "rollback ran WITHOUT confirmation"; else grep -q "rollback refused" "$W/rb1.txt" && pass "rollback refuses to run without the explicit confirmation" || bad "rollback failed for another reason"; fi
[ "$(PA -d pt_rb -c "select count(*) from pg_trigger where tgname='trg_prompter_subscriptions_block_client_update'")" = 1 ] && pass "...and changed nothing when refused" || bad "refused rollback changed state"
sed "s/REPLACE_WITH_CONFIRMATION/I_UNDERSTAND_THIS_REOPENS_PLAN_TAMPERING/" "$DOWN" > "$W/rb_ok.sql"
if P -d pt_rb -f "$W/rb_ok.sql" >/dev/null 2>&1; then pass "confirmed rollback applies"; else bad "confirmed rollback failed"; fi
suite pt_rb false "after the confirmed rollback (previous behaviour fully restored)" "$(PA -d pt_rb -c "$ROWS")" "$(PA -d pt_rb -c "$OTHERS")"
[ "$(grep -cE '^[[:space:]]*\\' "$DOWN")" = 0 ] && pass "rollback is plain SQL (no psql meta-command)" || bad "rollback has meta-commands"

[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
