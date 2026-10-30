#!/usr/bin/env bash
# LOCAL-ONLY Billing B1 tests on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. REQUIRE_PG_MAJOR=17 (set in CI) refuses any other major.
# Proves: BEFORE B1 an Owner can insert a PENDING transaction with any amount (the hole); AFTER it cannot (no client
# write at all), the only creation path is the service-role RPC priced from the DB catalog, tenant isolation and the
# webhook path are intact, #74 composes, the migration is idempotent, and the rollback is fail-closed.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
M74="$root/supabase/migrations/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql"
M1="$root/supabase/migrations/20261030100000_prompter_b1_server_only_checkout.sql"
M2="$root/supabase/migrations/20261030100100_prompter_b1_trial_remainder_carryover.sql"
D1="$root/supabase/rollback/20261030100000_prompter_b1_server_only_checkout.down.sql"
D2="$root/supabase/rollback/20261030100100_prompter_b1_trial_remainder_carryover.down.sql"
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

# the REAL B10 transaction table + RLS + policies and the REAL fn_apply_verified_payment, extracted verbatim from the repository
python3 - "$root" "$W/real_b10.sql" <<'PY'
import re, sys
root, out = sys.argv[1], sys.argv[2]
s = open(f"{root}/supabase/migrations/20260915051359_prompter_b10_payment_billing_core.sql").read()
a = s.index("create table if not exists public.prompter_payment_transactions")
endmark = "and paid_at is null\n  );"
b = s.index(endmark, s.index('create policy "Buat payment transaction tenant sendiri"')) + len(endmark)
parts = [s[a:b]]
n = "fn_apply_verified_payment"
m = re.search(r"create or replace function public\." + n + r"\(.*?\n\$\$;", s, re.S)
assert m
parts.append(m.group(0))
parts += re.findall(r"^(?:revoke|grant)[^;]*function public\." + n + r"\([^;]*;", s, re.M)
open(out, "w").write("\n".join(parts) + "\n")
PY
[ -s "$W/real_b10.sql" ] && pass "real B10 transaction table, policies and fn_apply_verified_payment extracted from the repository migration" || bad "extraction failed"

mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null \
  && P -d "$1" -f "$here/../s1-trial-quota/support/prod_snapshot.sql" >/dev/null \
  && P -d "$1" -f "$here/support/audit_stub.sql" >/dev/null && P -d "$1" -f "$W/real_b10.sql" >/dev/null \
  && P -d "$1" -f "$here/support/seed.sql" >/dev/null && P -1 -d "$1" -f "$M74" >/dev/null; }
OTHERS="select md5(coalesce(string_agg(x,'|' order by x),'')) from (select 'pol:'||tablename||':'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') x from pg_policies where tablename not in ('prompter_payment_transactions','prompter_plan_prices') union all select 'grant:'||table_name||':'||grantee||':'||privilege_type from information_schema.role_table_grants where table_schema='public' and table_name not in ('prompter_payment_transactions','prompter_plan_prices')) z"
SUBS="select md5(coalesce(string_agg(t::text,'|' order by tenant_id),'')) from (select tenant_id,plan,status,billing_provider,current_period_end from prompter_subscriptions) t"
LEG="select md5(coalesce(string_agg(t::text,'|' order by id),'')) from prompter_payment_transactions t where id::text like '00000000-0000-0000-0000-0000000e000%'"
m1() { P -1 -d "$1" -f "$M1" >/dev/null; }
m2() { P -1 -d "$1" -f "$M2" >/dev/null; }
s1() { for m in $S1; do P -1 -d "$1" -f "$root/supabase/migrations/$m.sql" >/dev/null || return 1; done; }
after() { # <db> <label> [subs] [others] [leg]
  local subs others leg; subs=$(PA -d "$1" -c "$SUBS"); others=$(PA -d "$1" -c "$OTHERS"); leg=$(PA -d "$1" -c "$LEG")
  [ -n "${3:-}" ] && { subs="$3"; others="$4"; leg="$5"; }
  if P -d "$1" -v subs_md5_before="$subs" -v others_md5_before="$others" -v legacy_txn_md5_before="$leg" -f "$here/after_b1.sql" >"$W/o.txt" 2>&1; then
    pass "$2: $(grep -c 'PASS:' "$W/o.txt") checks"
  else bad "$2"; grep -E "FAIL|ERROR" "$W/o.txt" | head -8; fi
}

# 1) BEFORE: the hole exists on the reconstructed production state (after #74)
mk b1_before && { P -d b1_before -f "$here/before_b1.sql" >"$W/o.txt" 2>&1 && pass "before B1 (hole reproduced): $(grep -c 'PASS:' "$W/o.txt") checks" || { bad "before B1"; grep -E "FAIL|ERROR" "$W/o.txt" | head -5; }; } || bad "mk b1_before"

# 2) AFTER part 1 only; idempotent
mk b1_after || bad "mk b1_after"
S0=$(PA -d b1_after -c "$SUBS"); O0=$(PA -d b1_after -c "$OTHERS"); L0=$(PA -d b1_after -c "$LEG")
m1 b1_after && pass "B1 migration applies in one transaction" || bad "B1 migration failed"
m1 b1_after && pass "B1 migration re-applies cleanly (idempotent)" || bad "B1 re-apply failed"
after b1_after "after B1" "$S0" "$O0" "$L0"
m2 b1_after && pass "carryover migration applies" || bad "carryover migration failed"
m2 b1_after && pass "carryover migration re-applies cleanly (idempotent)" || bad "carryover re-apply failed"
if P -d b1_after -f "$here/carryover.sql" >"$W/o.txt" 2>&1; then pass "trial-remainder carryover: $(grep -c 'PASS:' "$W/o.txt") checks"; else bad "carryover"; grep -E "FAIL|ERROR" "$W/o.txt" | head -8; fi

# 3) composition with the S1 trial migrations, both orders
mk b1_s1a || bad mk; Sa=$(PA -d b1_s1a -c "$SUBS"); La=$(PA -d b1_s1a -c "$LEG"); s1 b1_s1a && m1 b1_s1a && pass "S1 then B1 applies" || bad "S1 then B1 failed"
after b1_s1a "S1 first, then B1" "$Sa" "$(PA -d b1_s1a -c "$OTHERS")" "$La"
mk b1_s1b || bad mk; Sb=$(PA -d b1_s1b -c "$SUBS"); Lb=$(PA -d b1_s1b -c "$LEG"); m1 b1_s1b && s1 b1_s1b && pass "B1 then S1 applies" || bad "B1 then S1 failed"
after b1_s1b "B1 first, then S1" "$Sb" "$(PA -d b1_s1b -c "$OTHERS")" "$Lb"

# 4) rollbacks
mk b1_rb; m1 b1_rb
if PS -d b1_rb -v ON_ERROR_STOP=1 -f "$D1" >"$W/rb1.txt" 2>&1; then bad "rollback ran WITHOUT confirmation"; else grep -q "rollback refused" "$W/rb1.txt" && pass "rollback refuses to run without the explicit confirmation" || bad "rollback failed for another reason"; fi
[ "$(PA -d b1_rb -c "select count(*) from pg_proc where proname='fn_begin_checkout'")" = 1 ] && pass "...and changed nothing when refused" || bad "refused rollback changed state"
sed "s/REPLACE_WITH_CONFIRMATION/I_UNDERSTAND_THIS_REOPENS_CLIENT_TXN_INSERT/" "$D1" > "$W/rb_ok.sql"
if P -d b1_rb -f "$W/rb_ok.sql" >/dev/null 2>&1; then pass "confirmed rollback applies"; else bad "confirmed rollback failed"; fi
if P -d b1_rb -f "$here/after_rollback.sql" >"$W/o.txt" 2>&1; then pass "after the confirmed rollback the previous behaviour is restored (insert path back, UPDATE/DELETE stay closed)"; else bad "post-rollback state"; grep -E "FAIL|ERROR" "$W/o.txt" | head -5; fi
[ "$(PA -d b1_rb -c "select count(*) from pg_proc where proname in ('fn_begin_checkout','fn_payment_txn_insert_guard')")" = 0 ] && pass "rollback removed the RPC and the guard" || bad "rollback left objects"
[ "$(PA -d b1_rb -c "select count(*) from information_schema.role_table_grants where table_name='prompter_payment_transactions' and grantee='authenticated' and privilege_type in ('UPDATE','DELETE','TRUNCATE')")" = 0 ] && pass "rollback did NOT re-grant UPDATE / DELETE / TRUNCATE" || bad "rollback re-granted destructive privileges"
[ "$(grep -cE '^[[:space:]]*\\' "$D1" "$D2" | grep -vc ':0$')" = 0 ] && pass "rollback files are plain SQL (no psql meta-command)" || bad "rollback has meta-commands"
mk b1_rb2; m1 b1_rb2; m2 b1_rb2; P -d b1_rb2 -f "$D2" >/dev/null 2>&1 && [ "$(PA -d b1_rb2 -c "select count(*) from pg_trigger where tgname='trg_prompter_subscriptions_trial_carryover'")" = 0 ] && pass "carryover rollback removes the trigger" || bad "carryover rollback"

[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
