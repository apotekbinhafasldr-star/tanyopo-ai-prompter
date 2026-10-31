-- LOCAL-ONLY Billing B4.1 sequential scenarios on a throw-away PostgreSQL. Synthetic data. Never run against Supabase.
\ir ../b2-double-payment/support/helpers.sql
create or replace function pg_temp.svc(stmt text) returns text language plpgsql as $$ begin return pg_temp.as_service(stmt); end $$;
create or replace function pg_temp.sc(q text) returns text language plpgsql as $$ declare r text; begin execute q into r; return r; end $$;
create or replace function pg_temp.sync() returns text language plpgsql as $$
begin return pg_temp.as_service('select skipped::text||'':''||review_created||'':''||alarm_created||'':''||auto_resolved from public.fn_sync_payment_alerts()'); end $$;
create or replace function pg_temp.nalerts(k text default null) returns bigint language plpgsql as $$
declare r bigint; begin select count(*) into r from public.prompter_payment_alerts where k is null or kind = k; return r; end $$;
create or replace function pg_temp.astate(txn uuid, k text) returns text language plpgsql as $$
declare r text; begin select state||'/'||coalesce(resolution,'-') into r from public.prompter_payment_alerts where transaction_id = txn and kind = k; return r; end $$;
create or replace function pg_temp.aid(txn uuid, k text) returns uuid language plpgsql as $$
declare r uuid; begin select id into r from public.prompter_payment_alerts where transaction_id = txn and kind = k; return r; end $$;
create or replace function pg_temp.ack(a uuid, op uuid, note text default null) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select public.fn_ack_payment_alert(%L::uuid,%L::uuid,%L)$q$, a, op, note)); end $$;
create or replace function pg_temp.res(a uuid, op uuid, note text) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select public.fn_resolve_payment_alert(%L::uuid,%L::uuid,%L)$q$, a, op, note)); end $$;
create or replace function pg_temp.rec(txn uuid, k text, ref text default 'gw:A') returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select public.fn_record_payment_alarm(%L::uuid,%L,'{"gateway_status":"refund"}'::jsonb,%L)$q$, txn, k, ref)); end $$;
create or replace function pg_temp.fingerprint() returns text language plpgsql as $$
declare a text; b text;
begin
  select md5(coalesce(string_agg(t::text,'|' order by id),'')) into a from public.prompter_payment_transactions t;
  select md5(coalesce(string_agg(s::text,'|' order by tenant_id),'')) into b from public.prompter_subscriptions s;
  return a||b;
end $$;

-- tenants / users: two paying tenants, one operator account that is ALSO a tenant owner, one outsider
insert into public.tenants(id,nama_usaha) values ('00000000-0000-0000-0000-0000000b4001','T1'),('00000000-0000-0000-0000-0000000b4002','T2');
insert into public.user_profiles values
  ('00000000-0000-0000-0000-0000000b4011','00000000-0000-0000-0000-0000000b4001','owner T1','owner'),
  ('00000000-0000-0000-0000-0000000b4012','00000000-0000-0000-0000-0000000b4002','owner T2','owner');
insert into public.prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end,billing_provider) values
  ('00000000-0000-0000-0000-0000000b4001','STARTER','ACTIVE',now()-interval '5 days',now()+interval '25 days','midtrans'),
  ('00000000-0000-0000-0000-0000000b4002','STARTER','ACTIVE',now()-interval '5 days',now()+interval '25 days','midtrans');
-- transactions: R1,R2 in REVIEW; P1,P2,P3 PAID (refund / chargeback / reversal candidates); X pending (no alert)
create temp table seed_txn(id uuid, tenant uuid, usr uuid, pid text, st text, reason text);
insert into seed_txn values
  ('00000000-0000-0000-0000-0000000b40a1','00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b4011','mid-r1','REVIEW','LATE_PAYMENT_EXPIRED'),
  ('00000000-0000-0000-0000-0000000b40a2','00000000-0000-0000-0000-0000000b4002','00000000-0000-0000-0000-0000000b4012','mid-r2','REVIEW','AMOUNT_OR_CURRENCY_MISMATCH'),
  ('00000000-0000-0000-0000-0000000b40b1','00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b4011','mid-p1','PAID',null),
  ('00000000-0000-0000-0000-0000000b40b2','00000000-0000-0000-0000-0000000b4002','00000000-0000-0000-0000-0000000b4012','mid-p2','PAID',null),
  ('00000000-0000-0000-0000-0000000b40b3','00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b4011','mid-p3','PAID',null),
  ('00000000-0000-0000-0000-0000000b40c1','00000000-0000-0000-0000-0000000b4002','00000000-0000-0000-0000-0000000b4012',null,'PENDING',null);
-- the B1 insert guard only allows PENDING without provider ids, so promote after inserting (one PENDING per tenant is allowed by the B2 index: promote each row immediately)
do $$ declare r record; begin
  for r in select * from seed_txn order by (st='PENDING') loop
    insert into public.prompter_payment_transactions(id,tenant_id,user_id,provider,plan,amount,currency) values (r.id,r.tenant,r.usr,'midtrans','STARTER',99000,'IDR');
    if r.st <> 'PENDING' then
      update public.prompter_payment_transactions set status=r.st, provider_payment_id=r.pid, failure_reason=r.reason, paid_at=case when r.st='PAID' then now() end where id=r.id;
    end if;
  end loop; end $$;
insert into public.prompter_payment_operators(user_id,label,active) values
  ('00000000-0000-0000-0000-0000000b4011','founder (also tenant owner T1)',true),
  ('00000000-0000-0000-0000-0000000b4099','former operator',false);

select pg_temp.chk('B4 objects exist and are service_role-only: no anon / authenticated table or function privilege',
  not exists (select 1 from information_schema.role_table_grants g where g.table_name in ('prompter_payment_alerts','prompter_payment_operators','prompter_payment_alert_actions','prompter_payment_alert_evidence','prompter_payment_alert_sync_state') and g.grantee in ('anon','authenticated','PUBLIC'))
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fn_sync_payment_alerts','fn_record_payment_alarm','fn_ack_payment_alert','fn_resolve_payment_alert','fn_is_payment_operator','fn_note_payment_alert_sync_failure')
        and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))));
select pg_temp.chk('RLS is enabled with no policy on every B4 table',
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('prompter_payment_alerts','prompter_payment_alert_actions','prompter_payment_alert_evidence','prompter_payment_alert_sync_state') and c.relkind='r' and c.relrowsecurity) = 4
  and (select relrowsecurity from pg_class where oid='public.prompter_payment_operators'::regclass)
  and not exists (select 1 from pg_policies where tablename in ('prompter_payment_alerts','prompter_payment_alert_actions','prompter_payment_alert_evidence','prompter_payment_alert_sync_state') or tablename='prompter_payment_operators'));

create temp table fp0 as select pg_temp.fingerprint() f;

-- ===== 1. sync: REVIEW detection, idempotent =====
select pg_temp.chk('sync #1 creates exactly the 2 REVIEW alerts', pg_temp.sync() = 'false:2:0:0' and pg_temp.nalerts() = 2);
select pg_temp.chk('sync #2 / #3 create nothing (idempotent)', pg_temp.sync() = 'false:0:0:0' and pg_temp.sync() = 'false:0:0:0' and pg_temp.nalerts() = 2);
select pg_temp.chk('PAID / PENDING transactions raise no alert; REVIEW alert carries the reason as evidence',
  pg_temp.nalerts('REVIEW') = 2 and pg_temp.sc($q$select reason from public.prompter_payment_alerts where transaction_id='00000000-0000-0000-0000-0000000b40a1'$q$) = 'LATE_PAYMENT_EXPIRED'
  and pg_temp.sc($q$select severity from public.prompter_payment_alerts where transaction_id='00000000-0000-0000-0000-0000000b40a1'$q$) = 'HIGH');

-- ===== 2. webhook-derived alarms =====
insert into public.prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error) values
  ('midtrans','mid-p1:refund:200:-','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000b40b1","externalPaymentId":"mid-p1","status":"REFUNDED"}','FAILED','ALARM_REFUND'),
  ('midtrans','mid-p1:refund:200:-:dup','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000b40b1","externalPaymentId":"mid-p1","status":"REFUNDED"}','FAILED','ALARM_REFUND'),
  ('midtrans','mid-p2:chargeback:200:-','payment.chargeback','{"externalPaymentId":"mid-p2","status":"CHARGEBACK"}','FAILED','ALARM_CHARGEBACK'),
  ('midtrans','bad-order','payment.refunded','{"orderId":"not-a-uuid","externalPaymentId":"nope"}','FAILED','ALARM_REFUND'),
  ('xendit','x-1','payment.refunded','{"orderId":"00000000-0000-0000-0000-0000000b40b3","externalPaymentId":"mid-p3"}','FAILED','ALARM_REFUND'),
  ('midtrans','not-an-alarm','payment.paid','{"orderId":"00000000-0000-0000-0000-0000000b40b3","externalPaymentId":"mid-p3"}','FAILED','NEEDS_REVIEW');
select pg_temp.chk('sync maps refund (by orderId) and chargeback (by recorded payment id, no orderId); duplicates, bad ids, other providers, non-alarm events are ignored',
  pg_temp.sync() = 'false:0:2:0' and pg_temp.nalerts('REFUND') = 1 and pg_temp.nalerts('CHARGEBACK') = 1
  and pg_temp.sc($q$select severity from public.prompter_payment_alerts where kind='CHARGEBACK'$q$) = 'CRITICAL'
  and pg_temp.sc($q$select tenant_id::text from public.prompter_payment_alerts where kind='REFUND'$q$) = '00000000-0000-0000-0000-0000000b4001'
  and pg_temp.sc($q$select tenant_id::text from public.prompter_payment_alerts where kind='CHARGEBACK'$q$) = '00000000-0000-0000-0000-0000000b4002');
select pg_temp.chk('re-running the sync with the same events creates nothing', pg_temp.sync() = 'false:0:0:0' and pg_temp.nalerts() = 4);
insert into public.prompter_webhook_events(source_system,external_event_id,event_type,payload,status,error,received_at) values
  ('midtrans','old-reversal','payment.reversal','{"orderId":"00000000-0000-0000-0000-0000000b40b3"}','FAILED','ALARM_REVERSAL', now()-interval '100 days');
select pg_temp.chk('an event older than the lookback window is not re-derived (direct record covers it)', pg_temp.sync() = 'false:0:0:0' and pg_temp.nalerts('REVERSAL') = 0);
select pg_temp.chk('invalid lookback is rejected', pg_temp.svc('select count(*) from public.fn_sync_payment_alerts(interval ''5 minutes'')') like '%lookback%');

-- ===== 3. direct record =====
select pg_temp.chk('direct record: CREATED once, then EXISTING; sync afterwards adds nothing',
  pg_temp.rec('00000000-0000-0000-0000-0000000b40b3','REVERSAL') = 'CREATED' and pg_temp.rec('00000000-0000-0000-0000-0000000b40b3','REVERSAL') = 'EXISTING'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND') = 'EXISTING' and pg_temp.sync() = 'false:0:0:0' and pg_temp.nalerts() = 5);
select pg_temp.chk('direct record rejects unknown kind, REVIEW kind, unknown transaction, oversized evidence',
  pg_temp.rec('00000000-0000-0000-0000-0000000b40b3','NOPE') = 'INVALID_KIND' and pg_temp.rec('00000000-0000-0000-0000-0000000b40b3','REVIEW') = 'INVALID_KIND'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b4fff','REFUND') = 'TRANSACTION_NOT_FOUND'
  and pg_temp.svc(format($q$select public.fn_record_payment_alarm('00000000-0000-0000-0000-0000000b40b3','REFUND',%L::jsonb,'gw:big')$q$, jsonb_build_object('x', repeat('a',5000)))) = 'EVIDENCE_TOO_LARGE');
select pg_temp.chk('a direct-record alert also keeps the verified evidence', (select evidence->>'gateway_status' from public.prompter_payment_alerts where kind='REVERSAL') = 'refund');

-- ===== 4. tenant isolation + forged audit log =====
select pg_temp.chk('tenant can read/insert/update/delete NONE of the B4 tables',
  pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select count(*)::text from public.prompter_payment_alerts') like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select count(*)::text from public.prompter_payment_operators') like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select count(*)::text from public.prompter_payment_alert_actions') like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select count(*)::text from public.prompter_payment_alert_evidence') like '42501%'
  and pg_temp.dml_as('00000000-0000-0000-0000-0000000b4011',$q$insert into public.prompter_payment_alert_evidence(alert_id,evidence_ref,source) values (gen_random_uuid(),'gw:forged','VERIFIED_CALL')$q$) like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select count(*)::text from public.prompter_payment_alert_sync_state') like '42501%'
  and pg_temp.dml_as('00000000-0000-0000-0000-0000000b4011',$q$insert into public.prompter_payment_alerts(kind,severity,transaction_id,tenant_id,source) values ('REFUND','HIGH','00000000-0000-0000-0000-0000000b40b3','00000000-0000-0000-0000-0000000b4001','VERIFIED_CALL')$q$) like '42501%'
  and pg_temp.dml_as('00000000-0000-0000-0000-0000000b4011',$q$update public.prompter_payment_alerts set state='RESOLVED'$q$) like '42501%'
  and pg_temp.dml_as('00000000-0000-0000-0000-0000000b4011',$q$delete from public.prompter_payment_alerts$q$) like '42501%'
  and pg_temp.dml_as('00000000-0000-0000-0000-0000000b4011',$q$insert into public.prompter_payment_operators(user_id,label) values ('00000000-0000-0000-0000-0000000b4011','me')$q$) like '42501%'
  and pg_temp.dml_as(null,$q$select 1 from public.prompter_payment_alerts$q$,'anon') like '42501%');
select pg_temp.chk('tenant and anon cannot call any B4 function (incl. fabricating an operator ack / resolve / sync / record)',
  pg_temp.q_as('00000000-0000-0000-0000-0000000b4011',format($q$select public.fn_resolve_payment_alert(%L::uuid,'00000000-0000-0000-0000-0000000b4011','self service resolve')$q$, pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'))) like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select public.fn_record_payment_alarm(''00000000-0000-0000-0000-0000000b40b3'',''REFUND'',''{}'',''gw:x'')') like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select count(*)::text from public.fn_sync_payment_alerts()') like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select public.fn_is_payment_operator(''00000000-0000-0000-0000-0000000b4011'')::text') like '42501%'
  and pg_temp.q_as(null,'select count(*)::text from public.fn_sync_payment_alerts()','anon') like '42501%');
select pg_temp.chk('webhook event insert by a tenant is rejected (RLS / privilege)',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000b4011',$q$insert into public.prompter_webhook_events(source_system,external_event_id,event_type,payload,error) values ('midtrans','forged2','x','{"orderId":"00000000-0000-0000-0000-0000000b40c1"}','ALARM_CHARGEBACK')$q$) ~ '^(42501|ok:0)');
select pg_temp.chk('a forged tenant audit row IS accepted by the audit table (proves it is untrusted) ...',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000b4012',$q$insert into public.prompter_audit_logs(tenant_id,actor_user_id,action,resource_type,resource_id,context) values ('00000000-0000-0000-0000-0000000b4002',null,'payment.refund_reported','prompter_payment_transactions','00000000-0000-0000-0000-0000000b40b2','{"alarm":"PENDING_B4","forged":true}')$q$) = 'ok:1');
select pg_temp.chk('... yet it creates no alert, and cannot suppress a real one (record still CREATED, sync unaffected)',
  pg_temp.sync() = 'false:0:0:0' and pg_temp.nalerts('REFUND') = 1
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b2','REFUND') = 'CREATED' and pg_temp.nalerts('REFUND') = 2);

-- ===== 5. operators =====
select pg_temp.chk('unauthorized callers are refused: random uuid, inactive operator, tenant owner that is not on the list',
  pg_temp.ack(pg_temp.aid('00000000-0000-0000-0000-0000000b40a2','REVIEW'),'00000000-0000-0000-0000-0000000b4fff') = 'NOT_OPERATOR'
  and pg_temp.ack(pg_temp.aid('00000000-0000-0000-0000-0000000b40a2','REVIEW'),'00000000-0000-0000-0000-0000000b4099') = 'NOT_OPERATOR'
  and pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40a2','REVIEW'),'00000000-0000-0000-0000-0000000b4012','looks fine to me') = 'NOT_OPERATOR'
  and pg_temp.astate('00000000-0000-0000-0000-0000000b40a2','REVIEW') = 'OPEN/-');
select pg_temp.chk('ACK: OPEN -> ACKED once; again -> INVALID_STATE; unknown id -> NOT_FOUND; history row written',
  pg_temp.ack(pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'),'00000000-0000-0000-0000-0000000b4011','sedang dicek') = 'ACKED'
  and pg_temp.ack(pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'),'00000000-0000-0000-0000-0000000b4011') = 'INVALID_STATE'
  and pg_temp.ack('00000000-0000-0000-0000-0000000b4eee','00000000-0000-0000-0000-0000000b4011') = 'NOT_FOUND'
  and pg_temp.sc($q$select count(*)::text from public.prompter_payment_alert_actions where action='ACK'$q$) = '1');
select pg_temp.chk('RESOLVE needs a real note (>=5 chars, <=1000) and a valid state',
  pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'),'00000000-0000-0000-0000-0000000b4011',null) = 'NOTE_REQUIRED'
  and pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'),'00000000-0000-0000-0000-0000000b4011','   ab ') = 'NOTE_REQUIRED'
  and pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'),'00000000-0000-0000-0000-0000000b4011',repeat('x',1001)) = 'NOTE_TOO_LONG'
  and pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'),'00000000-0000-0000-0000-0000000b4011','dibayar manual via transfer, dicek') = 'RESOLVED'
  and pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'),'00000000-0000-0000-0000-0000000b4011','sekali lagi') = 'INVALID_STATE'
  and pg_temp.ack(pg_temp.aid('00000000-0000-0000-0000-0000000b40a1','REVIEW'),'00000000-0000-0000-0000-0000000b4011') = 'INVALID_STATE'
  and pg_temp.astate('00000000-0000-0000-0000-0000000b40a1','REVIEW') = 'RESOLVED/OPERATOR');
select pg_temp.chk('an operator-resolved alert is not re-opened by later syncs (even though the transaction is still REVIEW)',
  pg_temp.sync() = 'false:0:0:0' and pg_temp.astate('00000000-0000-0000-0000-0000000b40a1','REVIEW') = 'RESOLVED/OPERATOR');
select pg_temp.chk('refund alert can be resolved straight from OPEN (no forced ACK)',
  pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40b1','REFUND'),'00000000-0000-0000-0000-0000000b4011','refund dikonfirmasi di dashboard Midtrans') = 'RESOLVED');

-- ===== 6. nothing financial moved =====
select pg_temp.chk('transactions and subscriptions are byte-identical after every sync / record / ACK / RESOLVE above',
  (select f from fp0) = pg_temp.fingerprint());
select pg_temp.chk('no B4 function body writes to transactions or subscriptions',
  not exists (select 1 from pg_proc p where p.proname in ('fn_sync_payment_alerts','fn_record_payment_alarm','fn_ack_payment_alert','fn_resolve_payment_alert','fn_note_payment_alert_sync_failure')
     and pg_get_functiondef(p.oid) ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(prompter_payment_transactions|prompter_subscriptions)'));
select pg_temp.chk('no B4 function calls fn_apply_verified_payment / fn_resolve_review_payment',
  not exists (select 1 from pg_proc p where p.proname in ('fn_sync_payment_alerts','fn_record_payment_alarm','fn_ack_payment_alert','fn_resolve_payment_alert')
     and pg_get_functiondef(p.oid) ~* 'fn_apply_verified_payment|fn_resolve_review_payment|fn_begin_checkout'));

-- ===== 7. evidence is protected =====
select pg_temp.chk('history is append-only; alerts cannot be deleted or truncated (even as the table owner)',
  pg_temp.dml_as(null,$q$update public.prompter_payment_alert_actions set note='x'$q$,session_user::text) like 'P0001%'
  and pg_temp.dml_as(null,$q$delete from public.prompter_payment_alert_actions$q$,session_user::text) like 'P0001%'
  and pg_temp.dml_as(null,$q$truncate public.prompter_payment_alert_actions$q$,session_user::text) like 'P0001%'
  and pg_temp.dml_as(null,$q$delete from public.prompter_payment_alerts$q$,session_user::text) like 'P0001%'
  and pg_temp.dml_as(null,$q$truncate public.prompter_payment_alerts$q$,session_user::text) ~ '^(P0001|0A000)');
select pg_temp.chk('unique (transaction_id, kind) and the check constraints back the application rules',
  pg_temp.dml_as(null,$q$insert into public.prompter_payment_alerts(kind,severity,transaction_id,tenant_id,source) values ('REFUND','HIGH','00000000-0000-0000-0000-0000000b40b1','00000000-0000-0000-0000-0000000b4001','VERIFIED_CALL')$q$,session_user::text) like '23505%'
  and pg_temp.dml_as(null,$q$update public.prompter_payment_alerts set state='RESOLVED' where kind='CHARGEBACK'$q$,session_user::text) like '23514%'
  and pg_temp.dml_as(null,$q$update public.prompter_payment_alerts set kind='OTHER' where kind='CHARGEBACK'$q$,session_user::text) like '23514%');

-- ===== 8. auto-resolve of REVIEW (last: this changes a transaction, simulating the gateway-verified resolver) =====
select pg_temp.chk('REVIEW -> PAID elsewhere: sync auto-resolves the OPEN REVIEW alert once, with history; a second sync does nothing',
  pg_temp.astate('00000000-0000-0000-0000-0000000b40a2','REVIEW') = 'OPEN/-'
  and pg_temp.svc($q$update public.prompter_payment_transactions set status='PAID', paid_at=now() where id='00000000-0000-0000-0000-0000000b40a2' returning 'ok'$q$) is not null
  and pg_temp.sync() = 'false:0:0:1' and pg_temp.astate('00000000-0000-0000-0000-0000000b40a2','REVIEW') = 'RESOLVED/AUTO'
  and pg_temp.sc($q$select count(*)::text from public.prompter_payment_alert_actions where action='AUTO_RESOLVE'$q$) = '1'
  and pg_temp.sync() = 'false:0:0:0');
select pg_temp.chk('auto-resolve never touches refund / chargeback alerts', pg_temp.astate('00000000-0000-0000-0000-0000000b40b2','CHARGEBACK') = 'OPEN/-');

-- ===== 8b. repeated events: a NEW verified event reopens, a replay never does =====
create temp table fp1 as select pg_temp.fingerprint() f;
select pg_temp.chk('replay of the first refund (our own gw ref and the sync-registered event ref) on the RESOLVED alert -> REPEAT, stays RESOLVED, counted, sync does not reopen',
  pg_temp.astate('00000000-0000-0000-0000-0000000b40b1','REFUND') = 'RESOLVED/OPERATOR'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','gw:A') = 'REPEAT'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','evt:mid-p1:refund:200:-') = 'REPEAT'
  and pg_temp.sync() = 'false:0:0:0'
  and pg_temp.astate('00000000-0000-0000-0000-0000000b40b1','REFUND') = 'RESOLVED/OPERATOR'
  and pg_temp.sc($q$select repeat_count||'/'||reopened_count from public.prompter_payment_alerts where kind='REFUND' and transaction_id='00000000-0000-0000-0000-0000000b40b1'$q$) = '2/0');
select pg_temp.chk('a second, DIFFERENT refund reopens the SAME alert once: OPEN, reopened_count 1, resolution cleared, REOPEN + earlier RESOLVE history kept, evidence registry grows',
  pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','gw:B') = 'REOPENED'
  and pg_temp.astate('00000000-0000-0000-0000-0000000b40b1','REFUND') = 'OPEN/-'
  and pg_temp.sc($q$select (reopened_count = 1 and last_reopened_at is not null and resolved_at is null and resolved_by is null and resolution_note is null and acked_at is null)::text from public.prompter_payment_alerts where kind='REFUND' and transaction_id='00000000-0000-0000-0000-0000000b40b1'$q$) = 'true'
  and pg_temp.sc($q$select count(*)::text from public.prompter_payment_alert_actions x join public.prompter_payment_alerts a on a.id=x.alert_id where a.kind='REFUND' and a.transaction_id='00000000-0000-0000-0000-0000000b40b1' and x.action in ('RESOLVE','REOPEN')$q$) = '2'
  and pg_temp.sc($q$select count(*)::text from public.prompter_payment_alert_evidence e join public.prompter_payment_alerts a on a.id=e.alert_id where a.kind='REFUND' and a.transaction_id='00000000-0000-0000-0000-0000000b40b1'$q$) = '3'
  and pg_temp.sc($q$select count(*)::text from public.prompter_payment_alerts where kind='REFUND' and transaction_id='00000000-0000-0000-0000-0000000b40b1'$q$) = '1');
select pg_temp.chk('replay of the second while OPEN is EXISTING; after the second RESOLVE, replaying the first or second is REPEAT; a third different refund reopens again (count 2)',
  pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','gw:B') = 'EXISTING'
  and pg_temp.ack(pg_temp.aid('00000000-0000-0000-0000-0000000b40b1','REFUND'),'00000000-0000-0000-0000-0000000b4011') = 'ACKED'
  and pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40b1','REFUND'),'00000000-0000-0000-0000-0000000b4011','refund kedua dicek di dashboard') = 'RESOLVED'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','gw:B') = 'REPEAT'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','gw:A') = 'REPEAT'
  and pg_temp.astate('00000000-0000-0000-0000-0000000b40b1','REFUND') = 'RESOLVED/OPERATOR'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','gw:C') = 'REOPENED'
  and pg_temp.sc($q$select reopened_count::text from public.prompter_payment_alerts where kind='REFUND' and transaction_id='00000000-0000-0000-0000-0000000b40b1'$q$) = '2');
select pg_temp.chk('a chargeback after a refund is a separate CHARGEBACK alert; the refund alert is not touched or merged',
  pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK','gw:cb1') = 'CREATED'
  and pg_temp.astate('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK') = 'OPEN/-'
  and pg_temp.astate('00000000-0000-0000-0000-0000000b40b1','REFUND') = 'OPEN/-'
  and pg_temp.sc($q$select count(*)::text from public.prompter_payment_alerts where transaction_id='00000000-0000-0000-0000-0000000b40b1'$q$) = '2');
select pg_temp.chk('a chargeback alert reopens by the same rule (resolve, replay -> REPEAT, new ref -> REOPENED)',
  pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK'),'00000000-0000-0000-0000-0000000b4011','chargeback ditangani via Midtrans') = 'RESOLVED'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK','gw:cb1') = 'REPEAT'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK','gw:cb2') = 'REOPENED');
select pg_temp.chk('a missing / blank / oversized evidence ref is refused (no alert is created or reopened without an event identity)',
  pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND',null) = 'INVALID_EVIDENCE_REF'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','   ') = 'INVALID_EVIDENCE_REF'
  and pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND',repeat('x',201)) = 'INVALID_EVIDENCE_REF');
select pg_temp.chk('reopening and replays never touched a transaction or a subscription',
  (select f from fp1) = pg_temp.fingerprint());
select pg_temp.chk('the evidence registry is append-only, unique per (alert, ref), and closed to clients',
  pg_temp.dml_as(null,$q$update public.prompter_payment_alert_evidence set source='WEBHOOK_EVENT'$q$,session_user::text) like 'P0001%'
  and pg_temp.dml_as(null,$q$delete from public.prompter_payment_alert_evidence$q$,session_user::text) like 'P0001%'
  and pg_temp.dml_as(null,$q$truncate public.prompter_payment_alert_evidence$q$,session_user::text) ~ '^(P0001|0A000)'
  and pg_temp.dml_as(null,$q$insert into public.prompter_payment_alert_evidence(alert_id,evidence_ref,source) select alert_id,evidence_ref,source from public.prompter_payment_alert_evidence limit 1$q$,session_user::text) like '23505%');

-- ===== 8c. SECURITY DEFINER hardening =====
select pg_temp.chk('all 8 B4 functions pin search_path = public, pg_temp',
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('fn_sync_payment_alerts','fn_record_payment_alarm','fn_ack_payment_alert','fn_resolve_payment_alert','fn_is_payment_operator','fn_note_payment_alert_sync_failure','fn_prompter_payment_alert_protect','fn_prompter_payment_alert_actions_immutable')
     and proconfig @> array['search_path=public, pg_temp']) = 8);
create temp table prompter_payment_operators(user_id uuid, label text, active boolean);
insert into pg_temp.prompter_payment_operators values ('00000000-0000-0000-0000-0000000b4bad','attacker',true);
grant select on pg_temp.prompter_payment_operators to service_role;
create function public.zz_ctl_is_op(u uuid) returns boolean language sql security definer set search_path = public as
  $$ select exists (select 1 from prompter_payment_operators where user_id = u and active) $$;
select pg_temp.chk('control: a definer function with a BARE search_path = public IS fooled by a temp-table shadow (the attack is real) ...',
  public.zz_ctl_is_op('00000000-0000-0000-0000-0000000b4bad') = true);
select pg_temp.chk('... but the B4 functions are not: the attacker is no operator, cannot ACK / RESOLVE, and the temp shadow is never read',
  pg_temp.as_service($q$select public.fn_is_payment_operator('00000000-0000-0000-0000-0000000b4bad')::text$q$) = 'false'
  and pg_temp.ack(pg_temp.aid('00000000-0000-0000-0000-0000000b40b3','REVERSAL'),'00000000-0000-0000-0000-0000000b4bad') = 'NOT_OPERATOR'
  and pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40b3','REVERSAL'),'00000000-0000-0000-0000-0000000b4bad','tidak berwenang sama sekali') = 'NOT_OPERATOR');
drop function public.zz_ctl_is_op(uuid);
drop table pg_temp.prompter_payment_operators;

-- ===== 9. sync state =====
select pg_temp.chk('sync state: success recorded; failure note increments and a later success resets it',
  pg_temp.sc($q$select (last_success_at is not null and consecutive_failures = 0 and last_error is null)::text from public.prompter_payment_alert_sync_state$q$) = 'true'
  and pg_temp.svc($q$select public.fn_note_payment_alert_sync_failure('boom') is null$q$) is not null
  and pg_temp.sc($q$select (consecutive_failures = 1 and last_error = 'boom')::text from public.prompter_payment_alert_sync_state$q$) = 'true'
  and pg_temp.sync() = 'false:0:0:0' and pg_temp.sc($q$select (consecutive_failures = 0 and last_error is null)::text from public.prompter_payment_alert_sync_state$q$) = 'true');
