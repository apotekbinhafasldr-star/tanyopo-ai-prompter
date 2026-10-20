#!/usr/bin/env bash
# Real parallel sessions against a throw-away local PostgreSQL (synthetic data only).
set -euo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "REFUSED: non-local PGHOST" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
P() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -v ON_ERROR_STOP=1 "$@"; }
db=billing_conc
P -d postgres -c "drop database if exists $db" -c "create database $db"
P -d $db -f "$here/support/schema.sql"
python3 "$here/support/load_v1.py" "$root" | P -d $db
P -d $db -f "$root/supabase/migrations/20261020160000_prompter_billing_financial_safety.sql"
Q() { P -d $db -At "$@"; }
T=$(Q -c "select gen_random_uuid()"); 
Q -c "insert into tenants(id) values ('$T'); insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end) values ('$T','TRIALING','FREE',now(),now()+interval '14 days')" >/dev/null
ok=0; bad=0
chk() { if [ "$1" = "$2" ]; then echo "PASS: $3"; else echo "FAIL: $3 (got '$1', want '$2')"; bad=1; fi; }
bad=0

# 1) 20 parallel checkouts, same intent
for i in $(seq 1 20); do
  Q -c "select out_outcome from fn_begin_checkout('$T',null,'STARTER',99000,'IDR','xendit','intent-parallel1')" > /tmp/conc_co_$i.out &
done; wait
n=$(Q -c "select count(*) from prompter_payment_transactions where tenant_id='$T' and plan='STARTER'")
chk "$n" "1" "20 parallel checkouts, same intent -> exactly 1 transaction"
created=$(cat /tmp/conc_co_*.out | grep -c '^CREATED$' || true)
chk "$created" "1" "exactly one caller got CREATED"
# 20 parallel, DIFFERENT intents, same purchase
for i in $(seq 1 20); do
  Q -c "select out_outcome from fn_begin_checkout('$T',null,'GROWTH',199000,'IDR','xendit','intent-diff-$i-aaaa')" > /dev/null &
done; wait
n=$(Q -c "select count(*) from prompter_payment_transactions where tenant_id='$T' and plan='GROWTH' and status='PENDING'")
chk "$n" "1" "20 parallel checkouts, different intents, same purchase -> 1 PENDING"
rm -f /tmp/conc_co_*.out

# 2) 16 identical webhooks in parallel
X=$(Q -c "select out_transaction_id from fn_begin_checkout('$T',null,'STARTER',99000,'IDR','xendit','intent-parallel1')")
for i in $(seq 1 16); do
  Q -c "select * from fn_apply_payment_event('xendit','$X','inv-conc','inv-conc','PAID',99000,'IDR','WEBHOOK')" >/dev/null &
done; wait
chk "$(Q -c "select count(*) from prompter_audit_logs where resource_id='$X' and action='payment.succeeded'")" "1" "16 parallel identical webhooks -> exactly 1 activation"
chk "$(Q -c "select count(*) from prompter_payment_ledger where transaction_id='$X' and outcome='APPLIED'")" "1" "exactly 1 APPLIED ledger row"

# 3) webhook + reconciliation racing, new transaction
T2=$(Q -c "select gen_random_uuid()")
Q -c "insert into tenants(id) values ('$T2'); insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end) values ('$T2','ACTIVE','STARTER',now()-interval '5 days',now()+interval '25 days')" >/dev/null
X2=$(Q -c "select out_transaction_id from fn_begin_checkout('$T2',null,'STARTER',99000,'IDR','xendit',null)")
for i in 1 2 3 4 5 6; do
  Q -c "select * from fn_apply_payment_event('xendit','$X2','inv-race','ev-$i','PAID',99000,'IDR','$( [ $((i%2)) = 0 ] && echo WEBHOOK || echo RECONCILIATION)')" >/dev/null &
done; wait
chk "$(Q -c "select count(*) from prompter_audit_logs where resource_id='$X2' and action='payment.succeeded'")" "1" "webhook + reconciliation race -> exactly 1 activation"
chk "$(Q -c "select (current_period_end > now()+interval '53 days' and current_period_end < now()+interval '57 days') from prompter_subscriptions where tenant_id='$T2'")" "t" "renewal in race extends once from period end (25d + 1 month)"

# 4) two REAL payments (different gateway refs) racing for one tenant
T3=$(Q -c "select gen_random_uuid()")
Q -c "insert into tenants(id) values ('$T3'); insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end) values ('$T3','TRIALING','FREE',now(),now()+interval '14 days')" >/dev/null
A=$(Q -c "insert into prompter_payment_transactions(tenant_id,provider,plan,amount,created_at) values ('$T3','xendit','STARTER',99000,now()-interval '1 minute') returning id")
B=$(Q -c "insert into prompter_payment_transactions(tenant_id,provider,plan,amount,created_at) values ('$T3','xendit','STARTER',99000,now()-interval '1 minute') returning id")
Q -c "select * from fn_apply_payment_event('xendit','$A','inv-A1','e1','PAID',99000,'IDR','WEBHOOK')" >/dev/null &
Q -c "select * from fn_apply_payment_event('xendit','$B','inv-B1','e2','PAID',99000,'IDR','WEBHOOK')" >/dev/null &
wait
chk "$(Q -c "select count(*) from prompter_audit_logs where resource_id in ('$A','$B') and action='payment.succeeded'")" "1" "two real payments racing -> only one activation"
chk "$(Q -c "select count(*) from prompter_payment_exceptions where transaction_id in ('$A','$B') and code='DUPLICATE_PAYMENT' and status='OPEN'")" "1" "the other payment is an OPEN DUPLICATE_PAYMENT exception"
chk "$(Q -c "select count(*) from prompter_payment_transactions where id in ('$A','$B') and status='PAID'")" "2" "both payments remain recorded as PAID (no money dropped)"

# 5) reconciliation claim: parallel workers never claim the same row
for i in $(seq 1 10); do
  Q -c "insert into prompter_payment_transactions(tenant_id,provider,plan,amount,provider_payment_id,created_at) values ('$T','xendit','PRO',399000,'inv-claim-$i',now()-interval '10 minutes')" >/dev/null
done
for w in 1 2 3 4; do Q -c "select out_transaction_id from fn_claim_reconciliation_batch(10, interval '1 minute')" > /tmp/conc_claim_$w.out & done; wait
tot=$(cat /tmp/conc_claim_*.out | grep -c . || true); uniq_=$(cat /tmp/conc_claim_*.out | sort -u | grep -c . || true)
chk "$tot" "$uniq_" "4 parallel reconciliation workers never claim the same transaction twice"
rm -f /tmp/conc_claim_*.out
[ "$bad" = 0 ] && echo "CONCURRENCY OK" || { echo "CONCURRENCY FAILED"; exit 1; }
