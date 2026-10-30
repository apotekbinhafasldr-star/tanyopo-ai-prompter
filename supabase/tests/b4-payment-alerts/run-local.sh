#!/usr/bin/env bash
# LOCAL-ONLY Billing B4.1 tests on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. REQUIRE_PG_MAJOR=17 (set in CI) refuses any other major.
# Chain under test: B10 txn table + fn_apply v1 -> #74 -> B1 -> carryover -> B2 -> (real webhook-events table, real audit policies) -> B4.
# Proves: duplicate alarms, parallel sync, failed job then retry, tenant isolation, unauthorized operator, forged audit log,
# auto-resolve of REVIEW, and that the queue never changes a transaction or a subscription.
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
  && P -d "$1" -f "$W/real_webhook_audit.sql" >/dev/null && P -d "$1" -f "$W/default_privs.sql" >/dev/null; }
m4() { P -1 -d "$1" -f "$M4" >/dev/null; }

# 1) apply on top of B2, existing rows untouched, idempotent
mk b4_main || bad "mk b4_main"
LEG="select md5(coalesce(string_agg(t::text,'|' order by id),'')) from prompter_payment_transactions t"
SUBS="select md5(coalesce(string_agg(t::text,'|' order by tenant_id),'')) from prompter_subscriptions t"
L0=$(PA -d b4_main -c "$LEG"); S0=$(PA -d b4_main -c "$SUBS")
m4 b4_main && pass "B4 migration applies in one transaction" || bad "B4 migration failed"
m4 b4_main && pass "B4 migration re-applies cleanly (idempotent)" || bad "B4 re-apply failed"
[ "$L0" = "$(PA -d b4_main -c "$LEG")" ] && [ "$S0" = "$(PA -d b4_main -c "$SUBS")" ] && pass "existing transactions and subscriptions byte-identical after B4" || bad "B4 modified existing rows"

# 2) sequential scenarios
if (cd "$here" && PGOPTIONS="-c client_min_messages=notice" P -d b4_main -f scenarios.sql >"$W/o.txt" 2>&1); then pass "sequential scenarios: $(grep -c 'PASS:' "$W/o.txt") checks"; else bad "sequential scenarios"; grep -E "FAIL|ERROR" "$W/o.txt" | head -8; fi

# 3) concurrency + failure / retry, separate DB
mk b4_conc && m4 b4_conc || bad "mk b4_conc"
TX() { # <db> <id> <tenant> <user> <status> <payment_id> <reason|''>  (insert PENDING, then promote: the B1 insert guard)
  PA -d "$1" -c "insert into prompter_payment_transactions(id,tenant_id,user_id,provider,plan,amount,currency) values ('$2','$3','$4','midtrans','STARTER',99000,'IDR')" \
     -c "update prompter_payment_transactions set status='$5', provider_payment_id='$6', failure_reason=nullif('$7',''), paid_at=case when '$5'='PAID' then now() end where id='$2'" >/dev/null; }
SVC() { PA -d "$1" -c "set role service_role; $2" 2>&1 | grep -v '^SET$' | tail -1; }
T="00000000-0000-0000-0000-0000000c4001"; U="00000000-0000-0000-0000-0000000c4002"; OP="00000000-0000-0000-0000-0000000c4003"
PA -d b4_conc -c "insert into tenants(id,nama_usaha) values ('$T','C')" -c "insert into user_profiles values ('$U','$T','o','owner')" \
  -c "insert into prompter_payment_operators(user_id,label) values ('$OP','op')" >/dev/null
for i in 1 2 3; do TX b4_conc "00000000-0000-0000-0000-0000000c40a$i" "$T" "$U" REVIEW "mid-c$i" NO_SUBSCRIPTION; done
TX b4_conc 00000000-0000-0000-0000-0000000c40b1 "$T" "$U" PAID mid-cb1 ""
FP0=$(PA -d b4_conc -c "$LEG")$(PA -d b4_conc -c "$SUBS")

# 3a. 12 parallel syncs
rm -f "$W"/s_*; for i in $(seq 1 12); do ( SVC b4_conc "select skipped::text||':'||review_created||':'||alarm_created||':'||auto_resolved from public.fn_sync_payment_alerts()" > "$W/s_$i" ) & done; wait
err=$(cat "$W"/s_* | grep -vcE '^(true|false):[0-9]+:[0-9]+:[0-9]+$'); made=$(cat "$W"/s_* | awk -F: '{s+=$2} END{print s+0}')
[ "$err" = 0 ] && [ "$made" = 3 ] && [ "$(PA -d b4_conc -c "select count(*) from prompter_payment_alerts")" = 3 ] \
  && pass "3a: 12 parallel syncs -> no error, 3 REVIEW alerts created exactly once (created=$made)" || bad "3a parallel sync (err=$err created=$made alerts=$(PA -d b4_conc -c "select count(*) from prompter_payment_alerts"))"
# 3b. a sync that cannot get the lock returns skipped (another run holds it) and changes nothing
( PA -d b4_conc -c "select pg_advisory_lock(hashtextextended('prompter_payment_alert_sync',0)); select pg_sleep(5)" >/dev/null 2>&1 ) & HOLD=$!
sleep 1; r=$(SVC b4_conc "select skipped::text from public.fn_sync_payment_alerts()"); wait $HOLD
[ "$r" = true ] && pass "3b: a run that finds another sync in progress returns skipped=true" || bad "3b lock (got: $r)"
# 3c. 15 parallel identical direct records -> 1 CREATED + 14 EXISTING
rm -f "$W"/r_*; for i in $(seq 1 15); do ( SVC b4_conc "select public.fn_record_payment_alarm('00000000-0000-0000-0000-0000000c40b1','CHARGEBACK','{}'::jsonb,'gw:p')" > "$W/r_$i" ) & done; wait
[ "$(cat "$W"/r_* | grep -c '^CREATED$')" = 1 ] && [ "$(cat "$W"/r_* | grep -c '^EXISTING$')" = 14 ] && [ "$(PA -d b4_conc -c "select count(*) from prompter_payment_alerts where kind='CHARGEBACK'")" = 1 ] \
  && pass "3c: 15 parallel identical alarm records -> 1 CREATED + 14 EXISTING, one alert" || bad "3c parallel record ($(cat "$W"/r_* | sort | uniq -c | tr '\n' ' '))"
# 3d. record racing a sync for the same alarm (webhook event + direct call) -> still one alert
PA -d b4_conc -c "insert into prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error) values ('midtrans','mid-cb1:refund','payment.refunded','{\"orderId\":\"00000000-0000-0000-0000-0000000c40b1\"}','FAILED','ALARM_REFUND')" >/dev/null
rm -f "$W"/m_*; for i in $(seq 1 6); do ( SVC b4_conc "select public.fn_record_payment_alarm('00000000-0000-0000-0000-0000000c40b1','REFUND','{}'::jsonb,'gw:p')" > "$W/m_r$i" ) & ( SVC b4_conc "select skipped::text from public.fn_sync_payment_alerts()" > "$W/m_s$i" ) & done; wait
[ "$(PA -d b4_conc -c "select count(*) from prompter_payment_alerts where kind='REFUND'")" = 1 ] && ! grep -qiE "error|deadlock" "$W"/m_* \
  && pass "3d: direct record racing syncs for the same refund -> exactly one alert, no error / deadlock" || bad "3d record vs sync race"
# 3e. ACK / RESOLVE races
A1=$(PA -d b4_conc -c "select id from prompter_payment_alerts where kind='REVIEW' order by transaction_id limit 1")
rm -f "$W"/k_*; for i in $(seq 1 10); do ( SVC b4_conc "select public.fn_ack_payment_alert('$A1','$OP','x')" > "$W/k_$i" ) & done; wait
[ "$(cat "$W"/k_* | grep -c '^ACKED$')" = 1 ] && [ "$(cat "$W"/k_* | grep -c '^INVALID_STATE$')" = 9 ] && [ "$(PA -d b4_conc -c "select count(*) from prompter_payment_alert_actions where alert_id='$A1' and action='ACK'")" = 1 ] \
  && pass "3e: 10 parallel ACKs -> 1 ACKED + 9 INVALID_STATE, one history row" || bad "3e parallel ack"
rm -f "$W"/k_*; for i in $(seq 1 10); do ( SVC b4_conc "select public.fn_resolve_payment_alert('$A1','$OP','selesai dicek manual')" > "$W/k_$i" ) & ( SVC b4_conc "select public.fn_ack_payment_alert('$A1','$OP')" > "$W/ka_$i" ) & done; wait
[ "$(cat "$W"/k_* | grep -c '^RESOLVED$')" = 1 ] && [ "$(PA -d b4_conc -c "select state from prompter_payment_alerts where id='$A1'")" = RESOLVED ] && [ "$(PA -d b4_conc -c "select count(*) from prompter_payment_alert_actions where alert_id='$A1' and action='RESOLVE'")" = 1 ] \
  && pass "3e: parallel RESOLVE (+ late ACKs) -> exactly one RESOLVE, final state RESOLVED" || bad "3e parallel resolve"

# 3h. reopening under parallelism (alert from 3d is OPEN with ref gw:p): resolve it, then race NEW and REPLAYED events
RA=$(PA -d b4_conc -c "select id from prompter_payment_alerts where kind='REFUND' and transaction_id='00000000-0000-0000-0000-0000000c40b1'")
SVC b4_conc "select public.fn_resolve_payment_alert('$RA','$OP','refund pertama dicek')" >/dev/null
REC() { SVC b4_conc "select public.fn_record_payment_alarm('00000000-0000-0000-0000-0000000c40b1','REFUND','{}'::jsonb,'$1')"; }
rm -f "$W"/o_*; for i in $(seq 1 10); do ( REC gw:n1 > "$W/o_$i" ) & done; wait
[ "$(cat "$W"/o_* | grep -c '^REOPENED$')" = 1 ] && [ "$(cat "$W"/o_* | grep -c '^EXISTING$')" = 9 ] \
  && [ "$(PA -d b4_conc -c "select reopened_count||'/'||state||'/'||(select count(*) from prompter_payment_alerts where kind='REFUND' and transaction_id='00000000-0000-0000-0000-0000000c40b1') from prompter_payment_alerts where id='$RA'")" = "1/OPEN/1" ] \
  && pass "3h: 10 parallel identical NEW refunds on a RESOLVED alert -> exactly 1 REOPENED, 9 EXISTING, one alert, reopened_count=1" || bad "3h identical new event ($(cat "$W"/o_* | sort | uniq -c | tr '\n' ' '))"
SVC b4_conc "select public.fn_resolve_payment_alert('$RA','$OP','refund kedua dicek')" >/dev/null
rm -f "$W"/o_*; for i in $(seq 1 4); do ( REC gw:n2 > "$W/o_a$i" ) & ( REC gw:n3 > "$W/o_b$i" ) & done; wait
[ "$(cat "$W"/o_* | grep -c '^REOPENED$')" = 1 ] && [ "$(cat "$W"/o_* | grep -c '^EXISTING$')" = 7 ] \
  && [ "$(PA -d b4_conc -c "select reopened_count||'/'||state from prompter_payment_alerts where id='$RA'")" = "2/OPEN" ] \
  && [ "$(PA -d b4_conc -c "select count(*) from prompter_payment_alerts where kind='REFUND' and transaction_id='00000000-0000-0000-0000-0000000c40b1'")" = 1 ] \
  && [ "$(PA -d b4_conc -c "select count(*) from prompter_payment_alert_evidence where alert_id='$RA'")" = 5 ] \
  && pass "3h: two different parallel refunds -> one alert, one reopen, BOTH event identities registered (nothing lost)" || bad "3h two different new events ($(cat "$W"/o_* | sort | uniq -c | tr '\n' ' '))"
SVC b4_conc "select public.fn_resolve_payment_alert('$RA','$OP','refund ketiga dicek')" >/dev/null
rm -f "$W"/o_*; for i in $(seq 1 10); do ( REC gw:n2 > "$W/o_$i" ) & done; wait
[ "$(cat "$W"/o_* | grep -c '^REPEAT$')" = 10 ] && [ "$(PA -d b4_conc -c "select state||'/'||reopened_count||'/'||repeat_count from prompter_payment_alerts where id='$RA'")" = "RESOLVED/2/10" ] \
  && pass "3h: 10 parallel replays of an old refund on a RESOLVED alert -> all REPEAT, still RESOLVED, nothing reopened" || bad "3h replay storm"

# 3f. job fails midway, then retries: nothing lost, nothing duplicated, failure visible
mk b4_fail && m4 b4_fail || bad "mk b4_fail"
PA -d b4_fail -c "insert into tenants(id,nama_usaha) values ('$T','C')" -c "insert into user_profiles values ('$U','$T','o','owner')" >/dev/null
TX b4_fail 00000000-0000-0000-0000-0000000c40a1 "$T" "$U" REVIEW mid-f1 NO_SUBSCRIPTION; TX b4_fail 00000000-0000-0000-0000-0000000c40b1 "$T" "$U" PAID mid-fb ""
PA -d b4_fail -c "insert into prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error) values ('midtrans','mid-fb:refund','payment.refunded','{\"orderId\":\"00000000-0000-0000-0000-0000000c40b1\"}','FAILED','ALARM_REFUND')" >/dev/null
# the alarm insert (step b, after step a already inserted the REVIEW alert) is made to fail
PA -d b4_fail -c "create function pg_temp_boom() returns trigger language plpgsql as \$\$ begin if new.kind='REFUND' then raise exception 'simulated outage'; end if; return new; end \$\$" \
  -c "create trigger t_boom before insert on prompter_payment_alerts for each row execute function pg_temp_boom()" >/dev/null
r=$(PA -d b4_fail -c "set role service_role; select count(*) from public.fn_sync_payment_alerts()" 2>&1)
SVC b4_fail "select public.fn_note_payment_alert_sync_failure('simulated outage')" >/dev/null
[ "$(PA -d b4_fail -c "select count(*) from prompter_payment_alerts")" = 0 ] && echo "$r" | grep -q "simulated outage" \
  && [ "$(PA -d b4_fail -c "select consecutive_failures||':'||last_error from prompter_payment_alert_sync_state")" = "1:simulated outage" ] \
  && pass "3f: a failing sync rolls back as a whole (no half-written queue) and the failure is recorded" || bad "3f failure phase (r=$r)"
PA -d b4_fail -c "drop trigger t_boom on prompter_payment_alerts" >/dev/null
r=$(SVC b4_fail "select skipped::text||':'||review_created||':'||alarm_created from public.fn_sync_payment_alerts()")
[ "$r" = "false:1:1" ] && [ "$(PA -d b4_fail -c "select count(*) from prompter_payment_alerts")" = 2 ] \
  && [ "$(PA -d b4_fail -c "select consecutive_failures||':'||coalesce(last_error,'none') from prompter_payment_alert_sync_state")" = "0:none" ] \
  && pass "3f: the retry re-derives everything from the trusted sources: both alerts exist, failure counter reset" || bad "3f retry phase (r=$r)"
r=$(SVC b4_fail "select skipped::text||':'||review_created||':'||alarm_created from public.fn_sync_payment_alerts()")
[ "$r" = "false:0:0" ] && pass "3f: a further retry is a no-op" || bad "3f idempotent retry ($r)"

# 3g. concurrency did not move money
[ "$FP0" = "$(PA -d b4_conc -c "$LEG")$(PA -d b4_conc -c "$SUBS")" ] && pass "3g: transactions and subscriptions unchanged by all parallel operations" || bad "3g parallel operations changed financial rows"

# 4) composition with the S1 trial migrations
S1="20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard 20261019100200_prompter_p0_plan_entitlements_lockdown"
mk b4_s1 || bad "mk b4_s1"; for m in $S1; do P -1 -d b4_s1 -f "$MIG/$m.sql" >/dev/null || bad "S1 $m"; done; m4 b4_s1 && pass "B4 applies after the S1 trial migrations too" || bad "B4 after S1"

# 5) rollback: refuses while evidence exists; clean when empty; keeps financial tables
if PS -d b4_main -v ON_ERROR_STOP=1 -f "$D4" >"$W/rb.txt" 2>&1; then bad "rollback ran while alerts exist"; else grep -q "rollback refused" "$W/rb.txt" && pass "rollback refuses while alert evidence exists" || bad "rollback failed for another reason"; fi
mk b4_rb && m4 b4_rb || bad "mk b4_rb"
if P -d b4_rb -f "$D4" >/dev/null 2>&1; then pass "rollback applies when the queue is empty"; else bad "rollback failed"; fi
[ "$(PA -d b4_rb -c "select count(*) from pg_class where relname like 'prompter_payment_alert%' or relname='prompter_payment_operators'")" = 0 ] \
  && [ "$(PA -d b4_rb -c "select count(*) from pg_proc where proname in ('fn_sync_payment_alerts','fn_record_payment_alarm','fn_ack_payment_alert','fn_resolve_payment_alert','fn_is_payment_operator','fn_note_payment_alert_sync_failure')")" = 0 ] \
  && [ "$(PA -d b4_rb -c "select count(*) from pg_proc where proname in ('fn_apply_verified_payment','fn_resolve_review_payment','fn_begin_checkout')")" -ge 3 ] \
  && pass "rollback removed only the B4 objects (B1 / B2 functions intact)" || bad "rollback left or removed the wrong objects"
m4 b4_rb && [ "$(PA -d b4_rb -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname like 'prompter_payment_alert%' and relkind='r'")" = 4 ] && [ "$(PA -d b4_rb -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('fn_sync_payment_alerts','fn_record_payment_alarm','fn_ack_payment_alert','fn_resolve_payment_alert','fn_is_payment_operator','fn_note_payment_alert_sync_failure')")" = 6 ] \
  && pass "migration re-applies cleanly after a rollback" || bad "re-migrate after rollback"
if (cd "$here" && PGOPTIONS="-c client_min_messages=notice" P -d b4_rb -f scenarios.sql >"$W/o2.txt" 2>&1); then pass "full scenarios pass after rollback + re-migrate: $(grep -c 'PASS:' "$W/o2.txt") checks"; else bad "scenarios after rollback + re-migrate"; grep -E "FAIL|ERROR" "$W/o2.txt" | head -5; fi
[ "$(grep -cE '^[[:space:]]*\\' "$D4")" = 0 ] && [ "$(grep -cE '^[[:space:]]*\\' "$M4")" = 0 ] && pass "migration and rollback are plain SQL" || bad "meta-commands in SQL files"
[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
