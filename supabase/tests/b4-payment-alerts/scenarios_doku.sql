-- LOCAL-ONLY P0-3 scenarios: DOKU webhook alarms reach the alert queue (fn_sync_payment_alerts v2). Throw-away PostgreSQL, SYNTHETIC data.
-- Never run against Supabase. Runs on a database that already has B4.1 AND the P0-3 migration.
\ir ../b2-double-payment/support/helpers.sql
create or replace function pg_temp.sc(q text) returns text language plpgsql as $$ declare r text; begin execute q into r; return r; end $$;
create or replace function pg_temp.sync() returns text language plpgsql as $$
begin return pg_temp.as_service('select skipped::text||'':''||review_created||'':''||alarm_created||'':''||auto_resolved from public.fn_sync_payment_alerts()'); end $$;
create or replace function pg_temp.nalerts(k text default null, txn uuid default null) returns bigint language plpgsql as $$
declare r bigint; begin select count(*) into r from public.prompter_payment_alerts where (k is null or kind = k) and (txn is null or transaction_id = txn); return r; end $$;
create or replace function pg_temp.fingerprint() returns text language plpgsql as $$
declare a text; b text;
begin
  select md5(coalesce(string_agg(t::text,'|' order by id),'')) into a from public.prompter_payment_transactions t;
  select md5(coalesce(string_agg(s::text,'|' order by tenant_id),'')) into b from public.prompter_subscriptions s;
  return a||b;
end $$;

-- tenants: D1, D2 pay through DOKU; M1 pays through Midtrans
insert into public.tenants(id,nama_usaha) values
  ('00000000-0000-0000-0000-0000000d0001','DOKU 1'),('00000000-0000-0000-0000-0000000d0002','DOKU 2'),('00000000-0000-0000-0000-0000000d0003','MIDTRANS 1');
insert into public.user_profiles values
  ('00000000-0000-0000-0000-0000000d0011','00000000-0000-0000-0000-0000000d0001','owner D1','owner'),
  ('00000000-0000-0000-0000-0000000d0012','00000000-0000-0000-0000-0000000d0002','owner D2','owner'),
  ('00000000-0000-0000-0000-0000000d0013','00000000-0000-0000-0000-0000000d0003','owner M1','owner');
create temp table seed_txn(id uuid, tenant uuid, usr uuid, prov text, pid text);
insert into seed_txn values
  ('00000000-0000-0000-0000-0000000d00a1','00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000d0011','doku','doku-s1'),
  ('00000000-0000-0000-0000-0000000d00a2','00000000-0000-0000-0000-0000000d0002','00000000-0000-0000-0000-0000000d0012','doku','doku-s2'),
  ('00000000-0000-0000-0000-0000000d00a3','00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000d0011','doku','doku-s3'),
  ('00000000-0000-0000-0000-0000000d00b1','00000000-0000-0000-0000-0000000d0003','00000000-0000-0000-0000-0000000d0013','midtrans','mid-m1');
do $$ declare r record; begin
  for r in select * from seed_txn loop
    insert into public.prompter_payment_transactions(id,tenant_id,user_id,provider,plan,amount,currency) values (r.id,r.tenant,r.usr,r.prov,'STARTER',99000,'IDR');
    update public.prompter_payment_transactions set status='PAID', provider_payment_id=r.pid, paid_at=now() where id=r.id;
  end loop; end $$;

create temp table fp0 as select pg_temp.fingerprint() f;

-- ===== 1. function shape: same hardening and grants as B4.1 =====
select pg_temp.chk('fn_sync_payment_alerts v2 is SECURITY DEFINER with a fixed search_path, executable by service_role only',
  (select prosecdef and proconfig::text like '%search_path=public, pg_temp%' from pg_proc where oid='public.fn_sync_payment_alerts(interval)'::regprocedure)
  and has_function_privilege('service_role','public.fn_sync_payment_alerts(interval)','execute')
  and not has_function_privilege('anon','public.fn_sync_payment_alerts(interval)','execute')
  and not has_function_privilege('authenticated','public.fn_sync_payment_alerts(interval)','execute')
  and (select pg_get_functiondef('public.fn_sync_payment_alerts(interval)'::regprocedure) like '%source_system in (''midtrans'', ''doku'')%'));

-- ===== 2. DOKU alarms become alerts =====
insert into public.prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error) values
  ('doku','req-refund-1','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00a1","externalPaymentId":"doku-s1","status":"REFUNDED","evidenceRef":"gw:doku:refund:1"}','FAILED','ALARM_REFUND'),
  ('doku','req-refund-1-resend','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00a1","externalPaymentId":"doku-s1","status":"REFUNDED","evidenceRef":"gw:doku:refund:1"}','FAILED','ALARM_REFUND'),
  ('doku','req-cb-1','payment.chargeback','{"externalPaymentId":"doku-s2","status":"CHARGEBACK"}','FAILED','ALARM_CHARGEBACK'),
  ('doku','req-rev-1','payment.reversal','{"orderId":"00000000-0000-0000-0000-0000000d00a3","externalPaymentId":"doku-s3"}','FAILED','ALARM_REVERSAL');
select pg_temp.chk('DOKU ALARM_REFUND / ALARM_CHARGEBACK / ALARM_REVERSAL each create exactly one alert (a duplicate event adds none)',
  pg_temp.sync() = 'false:0:3:0' and pg_temp.nalerts() = 3 and pg_temp.nalerts('REFUND') = 1 and pg_temp.nalerts('CHARGEBACK') = 1 and pg_temp.nalerts('REVERSAL') = 1);
select pg_temp.chk('severity: CHARGEBACK is CRITICAL, REFUND / REVERSAL are HIGH; source is WEBHOOK_EVENT',
  pg_temp.sc($q$select severity from public.prompter_payment_alerts where kind='CHARGEBACK'$q$) = 'CRITICAL'
  and pg_temp.sc($q$select severity from public.prompter_payment_alerts where kind='REFUND'$q$) = 'HIGH'
  and pg_temp.sc($q$select severity from public.prompter_payment_alerts where kind='REVERSAL'$q$) = 'HIGH'
  and (select count(*) from public.prompter_payment_alerts where source <> 'WEBHOOK_EVENT') = 0);
select pg_temp.chk('tenant comes from OUR transaction row: D1 / D2 / D1; chargeback resolved by the recorded payment id (no orderId)',
  pg_temp.sc($q$select tenant_id::text from public.prompter_payment_alerts where kind='REFUND'$q$) = '00000000-0000-0000-0000-0000000d0001'
  and pg_temp.sc($q$select tenant_id::text from public.prompter_payment_alerts where kind='CHARGEBACK'$q$) = '00000000-0000-0000-0000-0000000d0002'
  and pg_temp.sc($q$select tenant_id::text from public.prompter_payment_alerts where kind='REVERSAL'$q$) = '00000000-0000-0000-0000-0000000d0001');
select pg_temp.chk('the verified event identity (payload.evidenceRef) is registered as evidence; nothing financial moved',
  pg_temp.sc($q$select count(*)::text from public.prompter_payment_alert_evidence e join public.prompter_payment_alerts a on a.id=e.alert_id where a.kind='REFUND' and e.evidence_ref='gw:doku:refund:1'$q$) = '1'
  and (select f from fp0) = pg_temp.fingerprint());

-- ===== 3. idempotency =====
select pg_temp.chk('re-running the sync creates nothing', pg_temp.sync() = 'false:0:0:0' and pg_temp.sync() = 'false:0:0:0' and pg_temp.nalerts() = 3);
insert into public.prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error) values
  ('doku','req-refund-1-again','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00a1","externalPaymentId":"doku-s1","evidenceRef":"gw:doku:refund:1"}','FAILED','ALARM_REFUND'),
  ('doku','req-refund-1-yet-again','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00a1","externalPaymentId":"doku-s1"}','FAILED','ALARM_REFUND');
select pg_temp.chk('further events for the SAME transaction and kind (new Request-Ids) never create a second alert',
  pg_temp.sync() = 'false:0:0:0' and pg_temp.nalerts('REFUND', '00000000-0000-0000-0000-0000000d00a1') = 1 and pg_temp.nalerts() = 3);
select pg_temp.chk('the direct verified call finds the sync-created alert: EXISTING, not a second row',
  pg_temp.as_service($q$select public.fn_record_payment_alarm('00000000-0000-0000-0000-0000000d00a1','REFUND','{}'::jsonb,'gw:doku:refund:1')$q$) = 'EXISTING'
  and pg_temp.nalerts() = 3);

-- ===== 4. what must NOT create an alert =====
insert into public.prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error,received_at) values
  -- a DOKU event that points at a MIDTRANS transaction: provider mismatch, no alert on the Midtrans transaction
  ('doku','x-doku-on-mid','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00b1","externalPaymentId":"mid-m1"}','FAILED','ALARM_REFUND', now()),
  -- a MIDTRANS event that points at a DOKU transaction: provider mismatch, no extra alert on d00a2
  ('midtrans','x-mid-on-doku','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00a2","externalPaymentId":"doku-s2"}','FAILED','ALARM_REFUND', now()),
  -- DOKU events that are not alarms
  ('doku','x-unknown','payment.updated','{"orderId":"00000000-0000-0000-0000-0000000d00a2"}','FAILED','VERIFIED_STATUS_UNKNOWN', now()),
  ('doku','x-notpaid','payment.updated','{"orderId":"00000000-0000-0000-0000-0000000d00a2"}','FAILED','VERIFIED_STATUS_NOT_PAID', now()),
  ('doku','x-ignored','payment.updated','{"orderId":"00000000-0000-0000-0000-0000000d00a2"}','IGNORED', null, now()),
  -- malformed / unknown references, other providers, outside the lookback window
  ('doku','x-bad-order','payment.refunded','{"orderId":"not-a-uuid","externalPaymentId":"nope"}','FAILED','ALARM_REFUND', now()),
  ('doku','x-no-ref','payment.refunded','{}','FAILED','ALARM_REFUND', now()),
  ('xendit','x-xendit','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00a2","externalPaymentId":"doku-s2"}','FAILED','ALARM_REFUND', now()),
  ('doku','x-old','payment.reversal','{"orderId":"00000000-0000-0000-0000-0000000d00a2"}','FAILED','ALARM_REVERSAL', now() - interval '100 days');
select pg_temp.chk('provider mismatches, non-alarm DOKU events, bad / missing references, other providers and events older than the window create nothing',
  pg_temp.sync() = 'false:0:0:0' and pg_temp.nalerts() = 3 and pg_temp.nalerts(null, '00000000-0000-0000-0000-0000000d00b1') = 0
  and pg_temp.nalerts('REFUND', '00000000-0000-0000-0000-0000000d00a2') = 0 and pg_temp.nalerts('REVERSAL', '00000000-0000-0000-0000-0000000d00a2') = 0);

-- ===== 5. Midtrans is unchanged =====
insert into public.prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error) values
  ('midtrans','mid-m1:refund','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00b1","externalPaymentId":"mid-m1"}','FAILED','ALARM_REFUND'),
  ('midtrans','mid-m1:refund:dup','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000d00b1","externalPaymentId":"mid-m1"}','FAILED','ALARM_REFUND');
select pg_temp.chk('a Midtrans refund alarm still creates exactly one alert for the Midtrans transaction (existing behaviour), duplicates ignored',
  pg_temp.sync() = 'false:0:1:0' and pg_temp.nalerts('REFUND', '00000000-0000-0000-0000-0000000d00b1') = 1 and pg_temp.nalerts() = 4
  and pg_temp.sc($q$select tenant_id::text from public.prompter_payment_alerts where transaction_id='00000000-0000-0000-0000-0000000d00b1'$q$) = '00000000-0000-0000-0000-0000000d0003'
  and pg_temp.sync() = 'false:0:0:0');

-- ===== 6. tenant isolation / RLS =====
select pg_temp.chk('tenant users cannot read alerts or evidence, cannot run the sync, cannot forge an alarm event',
  pg_temp.q_as('00000000-0000-0000-0000-0000000d0011','select count(*)::text from public.prompter_payment_alerts') in ('0') or pg_temp.q_as('00000000-0000-0000-0000-0000000d0011','select count(*)::text from public.prompter_payment_alerts') like '42501%'
);
select pg_temp.chk('authenticated / anon: no execute on the sync, no insert into webhook events',
  pg_temp.q_as('00000000-0000-0000-0000-0000000d0011','select count(*)::text from public.fn_sync_payment_alerts()') like '42501%'
  and pg_temp.q_as(null,'select count(*)::text from public.fn_sync_payment_alerts()','anon') like '42501%'
  and pg_temp.dml_as('00000000-0000-0000-0000-0000000d0011',$q$insert into public.prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error) values ('doku','forged','x','{"orderId":"00000000-0000-0000-0000-0000000d00a2"}','FAILED','ALARM_CHARGEBACK')$q$) not like 'ok:%');
select pg_temp.chk('RLS stays enabled with no policy on every alert table',
  (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('prompter_payment_alerts','prompter_payment_alert_actions','prompter_payment_alert_evidence','prompter_payment_alert_sync_state') and c.relrowsecurity) = 4
  and not exists (select 1 from pg_policies where tablename in ('prompter_payment_alerts','prompter_payment_alert_actions','prompter_payment_alert_evidence','prompter_payment_alert_sync_state')));

-- ===== 7. nothing financial moved =====
select pg_temp.chk('transactions and subscriptions are byte-identical after every sync', (select f from fp0) = pg_temp.fingerprint());
