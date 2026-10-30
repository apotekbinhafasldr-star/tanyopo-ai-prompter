#!/usr/bin/env bash
# LOCAL-ONLY Billing B2 tests on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. REQUIRE_PG_MAJOR=17 (set in CI) refuses any other major.
# Chain under test: B10 txn table + fn_apply v1 -> #74 -> B1 -> carryover -> B2. Proves scenarios A-F of the B2 audit
# (parallel checkout, double payment, repeated / parallel webhooks, activation failure, second payment during trial),
# plus idempotent apply, legacy data untouched, S1 composition, and a fail-closed rollback.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"; b1="$root/supabase/tests/b1-checkout"
MIG="$root/supabase/migrations"
M74="$MIG/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql"
M1="$MIG/20261030100000_prompter_b1_server_only_checkout.sql"
M1b="$MIG/20261030100100_prompter_b1_trial_remainder_carryover.sql"
M2="$MIG/20261030140000_prompter_b2_double_payment_safety.sql"
D2="$root/supabase/rollback/20261030140000_prompter_b2_double_payment_safety.down.sql"
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

# the REAL B10 transaction table + RLS + policies, fn_apply_verified_payment v1 and the lifecycle sweeps, extracted verbatim
python3 - "$root" "$W/real_b10.sql" <<'PY'
import re, sys
root, out = sys.argv[1], sys.argv[2]
s = open(f"{root}/supabase/migrations/20260915051359_prompter_b10_payment_billing_core.sql").read()
a = s.index("create table if not exists public.prompter_payment_transactions")
endmark = "and paid_at is null\n  );"
b = s.index(endmark, s.index('create policy "Buat payment transaction tenant sendiri"')) + len(endmark)
parts = [s[a:b]]
n = "fn_apply_verified_payment"
m = re.search(r"create or replace function public\." + n + r"\(.*?\n\$\$;", s, re.S); assert m
parts.append(m.group(0))
parts += re.findall(r"^(?:revoke|grant)[^;]*function public\." + n + r"\([^;]*;", s, re.M)
l = open(f"{root}/supabase/migrations/20260926113000_prompter_payment_lifecycle_remediation.sql").read()
for fn in ("fn_apply_expired_subscriptions", "fn_expire_stale_payment_transactions"):
    mm = re.search(r"create or replace function public\." + fn + r"\(\).*?\n\$\$;", l, re.S); assert mm
    parts.append(mm.group(0))
open(out, "w").write("\n".join(parts) + "\n")
PY
[ -s "$W/real_b10.sql" ] && pass "real B10 table / fn_apply v1 / lifecycle sweeps extracted from the repository" || bad "extraction failed"

mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null \
  && P -d "$1" -f "$b1/../s1-trial-quota/support/prod_snapshot.sql" >/dev/null \
  && P -d "$1" -f "$here/support/audit_stub.sql" >/dev/null && P -d "$1" -f "$W/real_b10.sql" >/dev/null \
  && P -d "$1" -f "$here/support/seed.sql" >/dev/null && P -1 -d "$1" -f "$M74" >/dev/null \
  && P -1 -d "$1" -f "$M1" >/dev/null && P -1 -d "$1" -f "$M1b" >/dev/null; }
LEG="select md5(coalesce(string_agg(t::text,'|' order by id),'')) from prompter_payment_transactions t where id::text like '00000000-0000-0000-0000-0000000e000%'"
SUBS="select md5(coalesce(string_agg(t::text,'|' order by tenant_id),'')) from (select tenant_id,plan,status,billing_provider,current_period_start,current_period_end from prompter_subscriptions) t"
m2() { P -1 -d "$1" -f "$M2" >/dev/null; }

# 1) apply B2 on top of the B1 state; legacy rows and subscriptions are not modified; idempotent
mk b2_main || bad "mk b2_main"
L0=$(PA -d b2_main -c "$LEG"); S0=$(PA -d b2_main -c "$SUBS")
m2 b2_main && pass "B2 migration applies in one transaction" || bad "B2 migration failed"
m2 b2_main && pass "B2 migration re-applies cleanly (idempotent)" || bad "B2 re-apply failed"
[ "$L0" = "$(PA -d b2_main -c "$LEG")" ] && [ "$S0" = "$(PA -d b2_main -c "$SUBS")" ] && pass "legacy transactions and subscriptions byte-identical after B2" || bad "B2 modified existing rows"
[ "$(PA -d b2_main -c "select count(*) from pg_constraint where conrelid='public.prompter_payment_transactions'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%REVIEW%'")" = 1 ] && pass "exactly one status check constraint, now including REVIEW" || bad "status constraint"

# 2) sequential scenarios (A, B, C, E, F, privileges, invariants)
if (cd "$here" && P -d b2_main -f scenarios.sql >"$W/o.txt" 2>&1); then pass "sequential scenarios: $(grep -c 'PASS:' "$W/o.txt") checks"; else bad "sequential scenarios"; grep -E "FAIL|ERROR" "$W/o.txt" | head -8; fi

# 3) concurrency, separate DB so index manipulation cannot leak
conc_setup() { # <db> <tenant-suffix> <plan>
  local T="00000000-0000-0000-0000-0000000c$2" ; 
  PA -d "$1" -c "insert into tenants(id,nama_usaha) values ('$T','C$2')" -c "insert into user_profiles values ('$T','$T','o','owner')" -c "insert into prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end) values ('$T','FREE','TRIALING',now()-interval '1 day',now()+interval '13 days')" >/dev/null
  echo "$T"; }
SVC() { PA -d "$1" -c "set role service_role; $2" 2>&1 | grep -v '^SET$' | tail -1; }
mk b2_conc && m2 b2_conc || bad "mk b2_conc"

# A. 15 parallel identical checkouts -> 1 CREATED + 14 EXISTING, one PENDING
T=$(conc_setup b2_conc 0001 STARTER); rm -f "$W"/a_*; for i in $(seq 1 15); do ( SVC b2_conc "select out_outcome||':'||out_transaction_id from public.fn_begin_checkout('$T','$T','STARTER','midtrans')" > "$W/a_$i" ) & done; wait
nc=$(cat "$W"/a_* | grep -c '^CREATED'); ne=$(cat "$W"/a_* | grep -c '^EXISTING'); ids=$(cat "$W"/a_* | cut -d: -f2 | sort -u | wc -l)
[ "$nc" = 1 ] && [ "$ne" = 14 ] && [ "$ids" = 1 ] && [ "$(PA -d b2_conc -c "select count(*) from prompter_payment_transactions where tenant_id='$T' and status='PENDING'")" = 1 ] \
  && pass "A: 15 parallel identical checkouts -> 1 CREATED + 14 EXISTING, same invoice, 1 PENDING" || bad "A parallel identical checkout (created=$nc existing=$ne ids=$ids)"
# A'. 16 parallel checkouts alternating plans -> never an error, never two PENDING
T=$(conc_setup b2_conc 0002 STARTER); rm -f "$W"/a_*; for i in $(seq 1 16); do pl=STARTER; [ $((i%2)) = 0 ] && pl=GROWTH; ( SVC b2_conc "select out_outcome from public.fn_begin_checkout('$T','$T','$pl','midtrans')" > "$W/a_$i" ) & done; wait
bad_out=$(cat "$W"/a_* | grep -vcE '^(CREATED|EXISTING)$'); np=$(PA -d b2_conc -c "select count(*) from prompter_payment_transactions where tenant_id='$T' and status='PENDING'")
[ "$bad_out" = 0 ] && [ "$np" = 1 ] && pass "A: 16 parallel checkouts with alternating plans -> no error, exactly one PENDING" || bad "A alternating (bad=$bad_out pending=$np: $(cat "$W"/a_* | sort | uniq -c | tr '\n' ' '))"

# C. one webhook delivered 10x at once
T=$(conc_setup b2_conc 0003 STARTER); ID=$(SVC b2_conc "select out_transaction_id from public.fn_begin_checkout('$T','$T','STARTER','midtrans')"); rm -f "$W"/c_*
for i in $(seq 1 10); do ( SVC b2_conc "select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment('$ID','pay_c','evt_c',99000,'IDR')" > "$W/c_$i" ) & done; wait
a1=$(grep -c '^true:$' "$W"/c_*  | awk -F: '{s+=$2} END{print s}'); a9=$(cat "$W"/c_* | grep -c 'ALREADY_PROCESSED')
[ "$a1" = 1 ] && [ "$a9" = 9 ] && [ "$(PA -d b2_conc -c "select count(*) from prompter_audit_logs where tenant_id='$T' and action='payment.succeeded'")" = 1 ] \
  && [ "$(PA -d b2_conc -c "select (current_period_end between now()+interval '1 month'+interval '12 days 23 hours' and now()+interval '1 month'+interval '13 days 1 hour') from prompter_subscriptions where tenant_id='$T'")" = t ] \
  && pass "C: 10 parallel identical webhooks -> 1 applied + 9 ALREADY_PROCESSED, 1 audit row, period not extended" || bad "C parallel webhooks (applied=$a1 already=$a9)"

# D1. 6 different invoices of one tenant paid at once (1 current PENDING + 5 superseded): only the current one activates
T=$(conc_setup b2_conc 0004 STARTER); ids=""; for pl in STARTER GROWTH STARTER GROWTH STARTER GROWTH; do ids="$ids $(SVC b2_conc "select out_transaction_id from public.fn_begin_checkout('$T','$T','$pl','midtrans')")"; done
rm -f "$W"/d_*; n=0; for id in $ids; do n=$((n+1)); ( SVC b2_conc "select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment('$id','pay_d$n','evt_d$n',case when '$id' = (select id::text from prompter_payment_transactions where id='$id' and plan='GROWTH') then 199000 else 99000 end,'IDR')" > "$W/d_$n" ) & done; wait
paid=$(PA -d b2_conc -c "select count(*) from prompter_payment_transactions where tenant_id='$T' and status='PAID'"); rev=$(PA -d b2_conc -c "select count(*) from prompter_payment_transactions where tenant_id='$T' and status='REVIEW'")
[ "$paid" = 1 ] && [ "$rev" = 5 ] && [ "$(PA -d b2_conc -c "select count(*) from prompter_audit_logs where tenant_id='$T' and action='payment.succeeded'")" = 1 ] \
  && [ "$(PA -d b2_conc -c "select (current_period_end between now()+interval '1 month'+interval '12 days 23 hours' and now()+interval '1 month'+interval '13 days 1 hour') from prompter_subscriptions where tenant_id='$T'")" = t ] \
  && pass "D: 6 different invoices paid at the same instant -> exactly 1 activates, 5 go to REVIEW (money recorded), period = 1 month + bonus" || bad "D parallel different invoices (paid=$paid review=$rev)"

# D2. defence in depth: even if several PENDING rows of one tenant existed (legacy), concurrent payments STACK, none is lost
mk b2_leg && m2 b2_leg || bad "mk b2_leg"
PA -d b2_leg -c "drop index public.uq_prompter_payment_txn_one_pending_per_tenant" >/dev/null
T=$(conc_setup b2_leg 0005 STARTER); ids=""; for i in 1 2 3 4 5 6; do ids="$ids $(PA -d b2_leg -c "insert into prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('$T','$T','midtrans','STARTER',99000,'IDR') returning id")"; done
rm -f "$W"/e_*; n=0; for id in $ids; do n=$((n+1)); ( SVC b2_leg "select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment('$id','pay_e$n','evt_e$n',99000,'IDR')" > "$W/e_$n" ) & done; wait
okc=$(cat "$W"/e_* | grep -c '^true:$')
[ "$okc" = 6 ] && [ "$(PA -d b2_leg -c "select (current_period_end between now()+interval '6 months'+interval '12 days 23 hours' and now()+interval '6 months'+interval '13 days 1 hour') from prompter_subscriptions where tenant_id='$T'")" = t ] \
  && pass "D: 6 legacy PENDING invoices paid concurrently -> all 6 applied, periods stack to 6 months + one bonus (no lost update)" || bad "D legacy stacking (applied=$okc)"

# 4) composition with the S1 trial migrations, both orders: B2 then S1 / S1 then B2 still pass the scenarios
for ord in "s1_first" "b2_first"; do
  db="b2_${ord}"; mk "$db" || bad "mk $db"
  if [ "$ord" = s1_first ]; then for m in $S1; do P -1 -d "$db" -f "$MIG/$m.sql" >/dev/null || bad "S1 $m"; done; m2 "$db"; else m2 "$db"; for m in $S1; do P -1 -d "$db" -f "$MIG/$m.sql" >/dev/null || bad "S1 $m"; done; fi
  if (cd "$here" && P -d "$db" -f scenarios.sql >"$W/o.txt" 2>&1); then pass "S1 composition ($ord): $(grep -c 'PASS:' "$W/o.txt") scenario checks"; else bad "S1 composition ($ord)"; grep -E "FAIL|ERROR" "$W/o.txt" | head -5; fi
done

# 5) rollback: refuses while REVIEW rows exist; otherwise restores v1 and removes the B2 objects
if PS -d b2_main -v ON_ERROR_STOP=1 -f "$D2" >"$W/rb.txt" 2>&1; then bad "rollback ran while REVIEW rows exist"; else grep -q "rollback refused" "$W/rb.txt" && pass "rollback refuses while transactions are in REVIEW (no evidence can be lost)" || bad "rollback failed for another reason"; fi
mk b2_rb && m2 b2_rb || bad "mk b2_rb"
if P -d b2_rb -f "$D2" >/dev/null 2>&1; then pass "rollback applies when no REVIEW rows exist"; else bad "rollback failed"; fi
[ "$(PA -d b2_rb -c "select count(*) from pg_proc where proname='fn_resolve_review_payment'")" = 0 ] && [ "$(PA -d b2_rb -c "select count(*) from pg_indexes where indexname='uq_prompter_payment_txn_one_pending_per_tenant'")" = 0 ] \
  && [ "$(PA -d b2_rb -c "select count(*) from pg_constraint where conrelid='public.prompter_payment_transactions'::regclass and pg_get_constraintdef(oid) ilike '%REVIEW%'")" = 0 ] && pass "rollback removed resolver, index and the REVIEW status" || bad "rollback left B2 objects"
[ "$(PA -d b2_rb -c "select has_function_privilege('authenticated','public.fn_begin_checkout(uuid,uuid,text,text)','execute') or has_function_privilege('anon','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')")" = f ] && pass "rollback keeps the functions service_role-only" || bad "rollback grants"
[ "$(grep -cE '^[[:space:]]*\\' "$D2")" = 0 ] && pass "rollback file is plain SQL" || bad "rollback has meta-commands"
# B1 + carryover regression suites still pass on the pre-B2 chain (B2 is not part of that chain)
[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
