#!/usr/bin/env bash
# LOCAL-ONLY Billing B4.2 (notification outbox) tests on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. REQUIRE_PG_MAJOR=17 (set in CI) refuses any other major.
# Chain under test: B10 txn table + fn_apply v1 -> #74 -> B1 -> carryover -> B2 -> (real webhook-events table, real audit policies) -> B4.
# Chain under test: ... -> B4.1 -> B4.2. Proves: derive / dedupe / replay / reopen, parallel claims (SKIP LOCKED + advisory lock), crash + lease retry
# with the same idempotency key, backoff, 23h stop, daily budget + CRITICAL reserve, RLS / privileges, rollback, B4.1 objects untouched.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"; b2s="$root/supabase/tests/b2-double-payment"
MIG="$root/supabase/migrations"
M74="$MIG/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql"
M1="$MIG/20261030100000_prompter_b1_server_only_checkout.sql"
M1b="$MIG/20261030100100_prompter_b1_trial_remainder_carryover.sql"
M2="$MIG/20261030140000_prompter_b2_double_payment_safety.sql"
M4="$MIG/20261031100000_prompter_b4_payment_alerts.sql"
D4="$root/supabase/rollback/20261031100000_prompter_b4_payment_alerts.down.sql"
M42="$MIG/20261101100000_prompter_b4_2_alert_notifications.sql"
D42="$root/supabase/rollback/20261101100000_prompter_b4_2_alert_notifications.down.sql"
export PGOPTIONS="-c client_min_messages=warning"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
P() { PS -v ON_ERROR_STOP=1 "$@"; }
PA() { PS -At "$@"; }
W="$(mktemp -d)"; fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi

# real B10 table + fn_apply v1 + lifecycle sweeps (same extraction as the B2 suite), then the REAL webhook-events table and the REAL audit policies
python3 - "$root" "$W/real_b10.sql" "$W/real_webhook_audit.sql" <<'PY'
import re, sys
root, out, out2 = sys.argv[1], sys.argv[2], sys.argv[3]
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
p4 = open(f"{root}/supabase/migrations/20260829104743_prompter_phase4_schema.sql").read()
wa = p4.index("create table if not exists public.prompter_webhook_events")
wb = p4.index('using (tenant_id = public.fn_current_tenant_id());', p4.index('create policy "Lihat webhook event tenant sendiri"')) + len('using (tenant_id = public.fn_current_tenant_id());')
f = open(f"{root}/supabase/migrations/20260829080127_prompter_foundation_schema.sql").read()
fa = f.index("alter table public.prompter_audit_logs enable row level security;")
fb = f.index("actor_user_id = auth.uid())\n  );", fa) + len("actor_user_id = auth.uid())\n  );")
open(out2, "w").write(p4[wa:wb] + "\n" + f[fa:fb] + "\n")
PY
[ -s "$W/real_b10.sql" ] && [ -s "$W/real_webhook_audit.sql" ] && pass "real B10 table, webhook-events table and audit policies extracted from the repository" || bad "extraction failed"
# Supabase grants ALL on new public objects to anon / authenticated / service_role by default; reproduce that so the B4 revokes are really tested
cat > "$W/default_privs.sql" <<'SQL'
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
SQL

mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null \
  && P -d "$1" -f "$here/../s1-trial-quota/support/prod_snapshot.sql" >/dev/null \
  && P -d "$1" -f "$b2s/support/audit_stub.sql" >/dev/null && P -d "$1" -f "$W/real_b10.sql" >/dev/null \
  && P -d "$1" -f "$b2s/support/seed.sql" >/dev/null && P -1 -d "$1" -f "$M74" >/dev/null \
  && P -1 -d "$1" -f "$M1" >/dev/null && P -1 -d "$1" -f "$M1b" >/dev/null && P -1 -d "$1" -f "$M2" >/dev/null \
  && P -d "$1" -f "$W/real_webhook_audit.sql" >/dev/null && P -d "$1" -f "$W/default_privs.sql" >/dev/null && P -d "$1" -f "$here/auth_users_stub.sql" >/dev/null; }
m4() { P -1 -d "$1" -f "$M4" >/dev/null; }
m42() { P -1 -d "$1" -f "$M42" >/dev/null; }
LEG="select md5(coalesce(string_agg(t::text,'|' order by id),'')) from prompter_payment_transactions t"
SUBS="select md5(coalesce(string_agg(t::text,'|' order by tenant_id),'')) from prompter_subscriptions t"
B41DEF="select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fn_sync_payment_alerts','fn_record_payment_alarm','fn_ack_payment_alert','fn_resolve_payment_alert','fn_is_payment_operator','fn_note_payment_alert_sync_failure')"
B41TAB="select md5(string_agg(table_name||'.'||column_name||':'||data_type, '|' order by table_name, ordinal_position)) from information_schema.columns where table_schema='public' and table_name like 'prompter_payment_alert%' and table_name not like 'prompter_payment_alert_notif%' and table_name <> 'prompter_payment_alert_notify_state'"

# 1) apply on top of B4.1; B4.1 objects and money tables untouched; idempotent; one transaction
mk b42_main || bad "mk b42_main"
m4 b42_main || bad "B4.1 apply"
D0=$(PA -d b42_main -c "$B41DEF"); T0=$(PA -d b42_main -c "$B41TAB"); L0=$(PA -d b42_main -c "$LEG"); S0=$(PA -d b42_main -c "$SUBS")
m42 b42_main && pass "B4.2 migration applies in one transaction on top of B4.1" || bad "B4.2 migration failed"
m42 b42_main && pass "B4.2 migration re-applies cleanly (idempotent)" || bad "B4.2 re-apply failed"
[ "$D0" = "$(PA -d b42_main -c "$B41DEF")" ] && pass "every B4.1 function definition is byte-identical after B4.2 (webhook / alarm path untouched)" || bad "B4.2 changed a B4.1 function"
[ "$T0" = "$(PA -d b42_main -c "$B41TAB")" ] && pass "every B4.1 table definition is identical after B4.2" || bad "B4.2 changed a B4.1 table"
[ "$L0" = "$(PA -d b42_main -c "$LEG")" ] && [ "$S0" = "$(PA -d b42_main -c "$SUBS")" ] && pass "transactions and subscriptions byte-identical after B4.2" || bad "B4.2 modified existing rows"
OBJ=$(PA -d b42_main -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'prompter_payment_alert_notif%' and c.relkind='r'")
[ "$OBJ" = 4 ] && pass "B4.2 adds exactly 4 tables (notifications, batches, attempts, notify_state), all prompter_payment_alert_*" || bad "unexpected table count $OBJ"
NEWF=$(PA -d b42_main -c "select string_agg(proname, ',' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname ~ 'notification'")
echo "  new functions: $NEWF"

# 2) sequential scenarios
if (cd "$here" && PGOPTIONS="-c client_min_messages=notice" P -d b42_main -f scenarios.sql >"$W/o.txt" 2>&1); then pass "sequential scenarios: $(grep -c 'PASS:' "$W/o.txt") checks"; else bad "sequential scenarios"; grep -E "FAIL|ERROR|DETAIL|CONTEXT" "$W/o.txt" | head -12; fi

# 3) concurrency, separate DB
mk b42_conc && m4 b42_conc && m42 b42_conc || bad "mk b42_conc"
TX() { PA -d "$1" -c "insert into prompter_payment_transactions(id,tenant_id,user_id,provider,plan,amount,currency) values ('$2','$3','$4','midtrans','STARTER',99000,'IDR')" \
     -c "update prompter_payment_transactions set status='$5', provider_payment_id='$6', failure_reason=nullif('$7',''), paid_at=case when '$5'='PAID' then now() end where id='$2'" >/dev/null; }
SVC() { PA -d "$1" -c "set role service_role; $2" 2>&1 | grep -v '^SET$' | tail -1; }
T="00000000-0000-0000-0000-0000000d4001"; U="00000000-0000-0000-0000-0000000d4002"; OP="00000000-0000-0000-0000-0000000d4003"
PA -d b42_conc -c "insert into tenants(id,nama_usaha) values ('$T','C')" -c "insert into user_profiles values ('$U','$T','o','owner')" \
  -c "insert into auth.users(id,email,email_confirmed_at) values ('$OP','founder@example.test',now())" \
  -c "insert into prompter_payment_operators(user_id,label) values ('$OP','op')" >/dev/null
for i in 1 2 3; do TX b42_conc "00000000-0000-0000-0000-0000000d40a$i" "$T" "$U" REVIEW "mid-d$i" NO_SUBSCRIPTION; done
TX b42_conc 00000000-0000-0000-0000-0000000d40b1 "$T" "$U" PAID mid-db1 ""
SVC b42_conc "select skipped::text from public.fn_sync_payment_alerts()" >/dev/null
SVC b42_conc "select public.fn_record_payment_alarm('00000000-0000-0000-0000-0000000d40b1','CHARGEBACK','{}'::jsonb,'gw:x')" >/dev/null
FP0=$(PA -d b42_conc -c "$LEG")$(PA -d b42_conc -c "$SUBS")
CLAIM="select public.fn_claim_payment_notification_batch(20,5,20,interval '5 minutes','https://app.example.test/ops')::text"
# 3a. 12 parallel claims -> exactly one batch for the 4 alerts
rm -f "$W"/c_*; for i in $(seq 1 12); do ( SVC b42_conc "$CLAIM" > "$W/c_$i" ) & done; wait
CL=$(cat "$W"/c_* | grep -c '"result": "CLAIMED"'); BS=$(cat "$W"/c_* | grep -c '"result": "BUSY"'); NO=$(cat "$W"/c_* | grep -c '"result": "NOTHING"'); ER=$(cat "$W"/c_* | grep -ci 'error\|deadlock')
[ "$CL" = 1 ] && [ "$ER" = 0 ] && [ "$((CL+BS+NO))" = 12 ] && [ "$(PA -d b42_conc -c "select count(*) from prompter_payment_alert_notification_batches")" = 1 ] \
  && [ "$(PA -d b42_conc -c "select count(*) from prompter_payment_alert_notifications")" = 4 ] \
  && pass "3a: 12 parallel claims -> exactly 1 CLAIMED ($BS BUSY, $NO NOTHING), 1 batch, 4 notifications, no error / deadlock" || bad "3a parallel claims (claimed=$CL busy=$BS nothing=$NO err=$ER)"
BID=$(PA -d b42_conc -c "select id from prompter_payment_alert_notification_batches")
# 3b. a claim that finds another claimer inside its transaction returns BUSY and writes nothing
( PA -d b42_conc -c "select pg_advisory_lock(hashtextextended('linoe:b42:notification-claim',0)); select pg_sleep(4)" >/dev/null 2>&1 ) & HOLD=$!
sleep 1; r=$(SVC b42_conc "$CLAIM"); wait $HOLD
echo "$r" | grep -q '"result": "BUSY"' && pass "3b: a claim that cannot get the claimer lock returns BUSY" || bad "3b busy (got: $r)"
# 3c. crash: lease expires, 10 parallel claims -> exactly ONE retry of the SAME batch / key
PA -d b42_conc -c "update prompter_payment_alert_notification_batches set lease_until = now() - interval '1 second'" >/dev/null
rm -f "$W"/c_*; for i in $(seq 1 10); do ( SVC b42_conc "$CLAIM" > "$W/c_$i" ) & done; wait
CL=$(cat "$W"/c_* | grep -c '"result": "CLAIMED"')
[ "$CL" = 1 ] && cat "$W"/c_* | grep -q "\"idempotency_key\": \"$BID-1\"" && [ "$(PA -d b42_conc -c "select attempts from prompter_payment_alert_notification_batches")" = 2 ] \
  && [ "$(PA -d b42_conc -c "select count(*) from prompter_payment_alert_notification_attempts where outcome='LEASE_EXPIRED'")" = 1 ] \
  && pass "3c: after a crash 10 parallel claims -> exactly one retry, same batch + same idempotency key, attempts=2, one LEASE_EXPIRED row" || bad "3c crash retry (claimed=$CL)"
# 3d. parallel complete / fail racing: exactly one SENT, no error
rm -f "$W"/d_*; for i in $(seq 1 8); do ( SVC b42_conc "select public.fn_complete_payment_notification_batch('$BID','msg_$i')" > "$W/d_$i" ) & done; wait
[ "$(cat "$W"/d_* | grep -c '^SENT$')" = 1 ] && [ "$(cat "$W"/d_* | grep -c '^ALREADY_SENT$')" = 7 ] && [ "$(PA -d b42_conc -c "select count(*) from prompter_payment_alert_notification_attempts where outcome='SENT'")" = 1 ] \
  && pass "3d: 8 parallel completes -> 1 SENT + 7 ALREADY_SENT, one SENT audit row" || bad "3d parallel complete ($(cat "$W"/d_* | sort | uniq -c | tr '\n' ' '))"
# 3e. parallel alarm recording + claim while the alert path keeps running: no deadlock, no lost alert
rm -f "$W"/e_*
for i in 1 2 3 4 5 6; do ( SVC b42_conc "select public.fn_record_payment_alarm('00000000-0000-0000-0000-0000000d40b1','REFUND','{}'::jsonb,'gw:r$i')" > "$W/e_r$i" ) & ( SVC b42_conc "$CLAIM" > "$W/e_c$i" ) & done; wait
! grep -qiE "error|deadlock" "$W"/e_* && [ "$(PA -d b42_conc -c "select count(*) from prompter_payment_alerts where kind='REFUND'")" = 1 ] \
  && pass "3e: alarm recording racing 6 claims -> no error / deadlock, one REFUND alert" || bad "3e record vs claim race ($(cat "$W"/e_* | head -3))"
SVC b42_conc "$CLAIM" >/dev/null; SVC b42_conc "$CLAIM" >/dev/null
[ "$(PA -d b42_conc -c "select count(*) from prompter_payment_alert_notifications n join prompter_payment_alerts a on a.id=n.alert_id where a.kind='REFUND'")" = 1 ] \
  && pass "3f: the REFUND alert has exactly one notification after the race (self-healing derive, no duplicate)" || bad "3f refund notification count"
# 3g. the outbox being unusable must not affect the payment path: with the notification tables locked / dropped functions the alert path still works
PA -d b42_conc -c "begin; lock table prompter_payment_alert_notifications in access exclusive mode; select pg_sleep(3); commit" >/dev/null 2>&1 & HOLD=$!
sleep 1; r=$(SVC b42_conc "select public.fn_record_payment_alarm('00000000-0000-0000-0000-0000000d40b1','REVERSAL','{}'::jsonb,'gw:lock')"); wait $HOLD
[ "$r" = CREATED ] && pass "3g: while the whole outbox table is exclusively locked the alarm path still answers CREATED (no coupling to the outbox)" || bad "3g outbox lock blocked the alarm path (got: $r)"
[ "$FP0" = "$(PA -d b42_conc -c "$LEG")$(PA -d b42_conc -c "$SUBS")" ] && pass "money tables unchanged by the whole concurrency run" || bad "money tables changed"

# 4) rollback: refused while rows exist; clean when empty; re-migrate; B4.1 intact
if P -1 -d b42_conc -f "$D42" >/dev/null 2>"$W/rb.txt"; then bad "rollback should refuse while notification rows exist"; else grep -q "rollback refused" "$W/rb.txt" && pass "rollback refuses while notification rows (audit trail) exist" || bad "rollback refused for the wrong reason"; fi
mk b42_rb && m4 b42_rb && m42 b42_rb || bad "mk b42_rb"
P -1 -d b42_rb -f "$D42" >/dev/null && pass "rollback runs on an empty outbox" || bad "rollback failed"
[ "$(PA -d b42_rb -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'prompter_payment_alert_notif%'")" = 0 ] \
  && [ "$(PA -d b42_rb -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname ~ 'notification'")" = 0 ] \
  && [ "$D0" = "$(PA -d b42_rb -c "$B41DEF")" ] && pass "rollback removes every B4.2 object and leaves B4.1 functions identical" || bad "rollback left objects / changed B4.1"
m42 b42_rb && pass "B4.2 re-applies after a rollback" || bad "re-apply after rollback"
PA -d b42_rb -c "set role service_role; select public.fn_preview_payment_notifications()" >/dev/null 2>&1 && pass "functions work after rollback + re-apply" || bad "post re-apply call failed"

rm -rf "$W"
if [ "$fail" = 0 ]; then echo "ALL B4.2 LOCAL TESTS PASSED"; else echo "SOME B4.2 TESTS FAILED"; exit 1; fi
