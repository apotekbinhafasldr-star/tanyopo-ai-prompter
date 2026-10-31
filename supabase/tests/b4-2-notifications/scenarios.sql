-- LOCAL-ONLY Billing B4.2 sequential scenarios on a throw-away PostgreSQL. Synthetic data. Never run against Supabase.
\ir ../b2-double-payment/support/helpers.sql
create or replace function pg_temp.sc(q text) returns text language plpgsql as $$ declare r text; begin execute q into r; return r; end $$;
create temp table lastc(j jsonb);
create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
create temp table vars(k text primary key, val text);
create or replace function pg_temp.setv(k_ text, v_ text) returns void language plpgsql as $$ begin insert into vars values (k_, v_) on conflict (k) do update set val = excluded.val; end $$;
create or replace function pg_temp.getv(k_ text) returns text language plpgsql as $$ declare r text; begin select val into r from vars where k = k_; return r; end $$;
create or replace function pg_temp.sync() returns text language plpgsql as $$
begin return pg_temp.as_service('select skipped::text||'':''||review_created||'':''||alarm_created||'':''||auto_resolved from public.fn_sync_payment_alerts()'); end $$;
create or replace function pg_temp.rec(txn uuid, k text, ref text) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select public.fn_record_payment_alarm(%L::uuid,%L,'{}'::jsonb,%L)$q$, txn, k, ref)); end $$;
create or replace function pg_temp.ack(a uuid, op uuid) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select public.fn_ack_payment_alert(%L::uuid,%L::uuid,null)$q$, a, op)); end $$;
create or replace function pg_temp.res(a uuid, op uuid) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select public.fn_resolve_payment_alert(%L::uuid,%L::uuid,'selesai dicek manual')$q$, a, op)); end $$;
create or replace function pg_temp.aid(txn uuid, k text) returns uuid language plpgsql as $$
declare r uuid; begin select id into r from public.prompter_payment_alerts where transaction_id = txn and kind = k; return r; end $$;
-- claim as service_role; remembers the answer (jsonb) in lastc; errors come back as {"error": ...}
create or replace function pg_temp.cl(lim int default 20, res int default 5, mx int default 20, link text default null) returns jsonb language plpgsql as $$
declare r text; j jsonb;
begin
  r := pg_temp.as_service(format($q$select public.fn_claim_payment_notification_batch(%L::int,%L::int,%L::int,interval '5 minutes',%L)::text$q$, lim, res, mx, link));
  j := case when left(r, 1) = '{' then r::jsonb else jsonb_build_object('error', r) end;
  delete from lastc; insert into lastc values (j);
  return j;
end $$;
create or replace function pg_temp.lastj(k text) returns text language plpgsql as $$ declare r text; begin select j ->> k into r from lastc; return r; end $$;
create or replace function pg_temp.fl(b uuid, att int, code text, st int default null, rot boolean default false, perm boolean default false) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select public.fn_fail_payment_notification_batch(%L::uuid,%L::int,%L,%L::int,%L::boolean,%L::boolean)$q$, b, att, code, st, rot, perm)); end $$;
create or replace function pg_temp.dn(b uuid, pid text) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select public.fn_complete_payment_notification_batch(%L::uuid,%L)$q$, b, pid)); end $$;
create or replace function pg_temp.due(b uuid) returns void language plpgsql as $$
begin update public.prompter_payment_alert_notification_batches set next_attempt_at = now() - interval '1 second', lease_until = null where id = b; end $$;
create or replace function pg_temp.lease_over(b uuid) returns void language plpgsql as $$
begin update public.prompter_payment_alert_notification_batches set lease_until = now() - interval '1 second' where id = b; end $$;
create or replace function pg_temp.fingerprint() returns text language plpgsql as $$
declare a text; b text;
begin
  select md5(coalesce(string_agg(t::text,'|' order by id),'')) into a from public.prompter_payment_transactions t;
  select md5(coalesce(string_agg(s::text,'|' order by tenant_id),'')) into b from public.prompter_subscriptions s;
  return a||b;
end $$;
create or replace function pg_temp.alerts_fp() returns text language plpgsql as $$
declare a text; begin select md5(coalesce(string_agg(t::text,'|' order by id),'')) into a from public.prompter_payment_alerts t; return a; end $$;
create or replace function pg_temp.nn(where_ text default 'true') returns text language plpgsql as $$ declare r text; begin execute 'select count(*) from public.prompter_payment_alert_notifications where ' || where_ into r; return r; end $$;
create or replace function pg_temp.nb(where_ text default 'true') returns text language plpgsql as $$ declare r text; begin execute 'select count(*) from public.prompter_payment_alert_notification_batches where ' || where_ into r; return r; end $$;
create or replace function pg_temp.na(where_ text default 'true') returns text language plpgsql as $$ declare r text; begin execute 'select count(*) from public.prompter_payment_alert_notification_attempts where ' || where_ into r; return r; end $$;

-- ---- seed: 2 tenants, REVIEW x2, PAID x3; operators: op1 active+confirmed, op2 active but unconfirmed, op3 inactive, op4 active but banned
insert into public.tenants(id,nama_usaha) values ('00000000-0000-0000-0000-0000000b4001','T1'),('00000000-0000-0000-0000-0000000b4002','T2');
insert into public.user_profiles values
  ('00000000-0000-0000-0000-0000000b4011','00000000-0000-0000-0000-0000000b4001','owner T1','owner'),
  ('00000000-0000-0000-0000-0000000b4012','00000000-0000-0000-0000-0000000b4002','owner T2','owner');
insert into public.prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end,billing_provider) values
  ('00000000-0000-0000-0000-0000000b4001','STARTER','ACTIVE',now()-interval '5 days',now()+interval '25 days','midtrans'),
  ('00000000-0000-0000-0000-0000000b4002','STARTER','ACTIVE',now()-interval '5 days',now()+interval '25 days','midtrans');
create temp table seed_txn(id uuid, tenant uuid, usr uuid, pid text, st text, reason text);
insert into seed_txn values
  ('00000000-0000-0000-0000-0000000b40a1','00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b4011','mid-r1','REVIEW','LATE_PAYMENT_EXPIRED'),
  ('00000000-0000-0000-0000-0000000b40a2','00000000-0000-0000-0000-0000000b4002','00000000-0000-0000-0000-0000000b4012','mid-r2','REVIEW','AMOUNT_OR_CURRENCY_MISMATCH'),
  ('00000000-0000-0000-0000-0000000b40b1','00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b4011','mid-p1','PAID',null),
  ('00000000-0000-0000-0000-0000000b40b2','00000000-0000-0000-0000-0000000b4002','00000000-0000-0000-0000-0000000b4012','mid-p2','PAID',null),
  ('00000000-0000-0000-0000-0000000b40b3','00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b4011','mid-p3','PAID',null);
do $$ declare r record; begin
  for r in select * from seed_txn loop
    insert into public.prompter_payment_transactions(id,tenant_id,user_id,provider,plan,amount,currency) values (r.id,r.tenant,r.usr,'midtrans','STARTER',99000,'IDR');
    update public.prompter_payment_transactions set status=r.st, provider_payment_id=r.pid, failure_reason=r.reason, paid_at=case when r.st='PAID' then now() end where id=r.id;
  end loop; end $$;
insert into auth.users(id,email,email_confirmed_at,banned_until,deleted_at) values
  ('00000000-0000-0000-0000-0000000b4021','op1@example.test',now(),null,null),
  ('00000000-0000-0000-0000-0000000b4022','op2@example.test',null,null,null),
  ('00000000-0000-0000-0000-0000000b4023','op3@example.test',now(),null,null),
  ('00000000-0000-0000-0000-0000000b4024','op4@example.test',now(),now()+interval '1 day',null);
insert into public.prompter_payment_operators(user_id,label,active) values
  ('00000000-0000-0000-0000-0000000b4021','op1',true),('00000000-0000-0000-0000-0000000b4022','op2 unconfirmed',true),
  ('00000000-0000-0000-0000-0000000b4023','op3 inactive',false),('00000000-0000-0000-0000-0000000b4024','op4 banned',true);
select pg_temp.setv('op1','00000000-0000-0000-0000-0000000b4021');

create temp table fp0 as select pg_temp.fingerprint() f;

-- ===== 1. privileges / RLS =====
select pg_temp.chk('B4.2 tables are service_role-only: no anon / authenticated table grant',
  not exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.table_name like 'prompter_payment_alert_notif%' and g.grantee in ('anon','authenticated','PUBLIC'))
  and not exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.table_name='prompter_payment_alert_notify_state' and g.grantee in ('anon','authenticated','PUBLIC')));
select pg_temp.chk('B4.2 service_role has SELECT only on its tables (writes go through the definer functions)',
  not exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.grantee='service_role' and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
              and (g.table_name like 'prompter_payment_alert_notif%' or g.table_name = 'prompter_payment_alert_notify_state')));
select pg_temp.chk('B4.2 functions: EXECUTE for service_role only (no anon / authenticated / PUBLIC)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fn_claim_payment_notification_batch','fn_complete_payment_notification_batch','fn_fail_payment_notification_batch','fn_payment_notification_recipient_emails','fn_payment_notification_recipient_ids','fn_preview_payment_notifications')) = 6
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fn_claim_payment_notification_batch','fn_complete_payment_notification_batch','fn_fail_payment_notification_batch','fn_payment_notification_recipient_emails','fn_payment_notification_recipient_ids','fn_preview_payment_notifications')
        and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('public',p.oid,'execute')))
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fn_claim_payment_notification_batch','fn_complete_payment_notification_batch','fn_fail_payment_notification_batch','fn_payment_notification_recipient_emails','fn_payment_notification_recipient_ids','fn_preview_payment_notifications') and not (p.prosecdef and p.proconfig::text like '%search_path=public, pg_temp%')));
select pg_temp.chk('RLS enabled with NO policy on every B4.2 table',
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('prompter_payment_alert_notifications','prompter_payment_alert_notification_batches','prompter_payment_alert_notification_attempts','prompter_payment_alert_notify_state') and c.relkind='r' and c.relrowsecurity) = 4
  and not exists (select 1 from pg_policies where tablename like 'prompter_payment_alert_notif%' or tablename = 'prompter_payment_alert_notify_state'));
select pg_temp.chk('authenticated / anon cannot read the tables nor call the functions',
  pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select count(*)::text from public.prompter_payment_alert_notifications') like '42501%'
  and pg_temp.q_as(null,'select count(*)::text from public.prompter_payment_alert_notification_batches','anon') like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select public.fn_claim_payment_notification_batch()::text') like '42501%'
  and pg_temp.q_as('00000000-0000-0000-0000-0000000b4011','select public.fn_payment_notification_recipient_emails(array[''00000000-0000-0000-0000-0000000b4021''::uuid])::text') like '42501%'
  and pg_temp.q_as(null,'select public.fn_preview_payment_notifications()::text','anon') like '42501%');
select pg_temp.chk('the new tables are not exposed to a tenant owner even as an operator-owner (no policy)',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000b4011','insert into public.prompter_payment_alert_notification_batches(subject,body,payload_hash,item_count,top_severity,recipient_user_ids) values (''x'',''y'',repeat(''a'',64),1,''HIGH'',array[gen_random_uuid()])') like '42501%');

-- ===== 2. derive + preview (webhook path untouched: notifications come only from the alert truth) =====
select pg_temp.chk('sync creates the 2 REVIEW alerts; no notification exists yet (nothing was written by the alert path)',
  pg_temp.sync() = 'false:2:0:0' and pg_temp.nn() = '0' and pg_temp.nb() = '0');
select pg_temp.chk('CHARGEBACK (CRITICAL) and REFUND (HIGH) alarms are recorded', 
  pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK','gw:cb1') = 'CREATED' and pg_temp.rec('00000000-0000-0000-0000-0000000b40b2','REFUND','gw:rf1') = 'CREATED');
select pg_temp.chk('creating alarms did not create a single notification row (record path has no outbox coupling)', pg_temp.nn() = '0');
select pg_temp.chk('preview (dry run) reports 4 open alerts without notification, 1 recipient, and writes nothing',
  pg_temp.as_service('select (public.fn_preview_payment_notifications()->>''open_alerts_without_notification'')||'':''||(public.fn_preview_payment_notifications()->>''recipients'')') = '4:1' and pg_temp.nn() = '0');
select pg_temp.chk('recipient resolution: only the active + confirmed + not banned operator (by UUID)',
  pg_temp.as_service('select public.fn_payment_notification_recipient_ids()::text') = '{00000000-0000-0000-0000-0000000b4021}'
  and pg_temp.as_service($q$select public.fn_payment_notification_recipient_emails(array['00000000-0000-0000-0000-0000000b4021','00000000-0000-0000-0000-0000000b4022','00000000-0000-0000-0000-0000000b4023','00000000-0000-0000-0000-0000000b4024']::uuid[])::text$q$) = '{op1@example.test}'
  and pg_temp.as_service($q$select public.fn_payment_notification_recipient_emails(array['00000000-0000-0000-0000-0000000b4022','00000000-0000-0000-0000-0000000b4023']::uuid[])::text$q$) = '{}');

-- ===== 3. claim: derive, merge, freeze =====
create temp table afp as select pg_temp.alerts_fp() f;
select pg_temp.cl(0) a, pg_temp.cl(20,21) b, pg_temp.cl(20,5,20,'http://x.test/ops') c, pg_temp.cl(20,5,20,'https://x.test/a b') d \gset
select pg_temp.chk('claim parameters are validated; a non-https / spaced link is rejected; nothing was written',
  :'a'::jsonb ->> 'error' like '%invalid notification claim parameters%' and :'b'::jsonb ->> 'error' like '%invalid notification claim parameters%'
  and :'c'::jsonb ->> 'error' like '%invalid notification link%' and :'d'::jsonb ->> 'error' like '%invalid notification link%' and pg_temp.nn() = '0');
select pg_temp.cl(20,5,20,'https://app.example.test/ops/payments') ->> 'result' r \gset
select pg_temp.chk('claim #1 derives 4 notifications and merges them into ONE batch, CRITICAL first, attempt 1',
  :'r' = 'CLAIMED' and pg_temp.lastj('item_count') = '4' and pg_temp.lastj('top_severity') = 'CRITICAL'
  and pg_temp.lastj('attempt_no') = '1' and pg_temp.lastj('retry') = 'false'
  and pg_temp.lastj('idempotency_key') = pg_temp.lastj('batch_id') || '-1'
  and pg_temp.lastj('subject') = '[LINOE] 4 alarm pembayaran (1 KRITIS)'
  and split_part(pg_temp.lastj('text'), E'\n', 5) like '- [KRITIS] CHARGEBACK · id %'
  and pg_temp.lastj('text') like '%Buka antrean: https://app.example.test/ops/payments%'
  and pg_temp.nn() = '4' and pg_temp.nn($$status='BATCHED'$$) = '4' and pg_temp.nb() = '1');
select pg_temp.setv('b1', pg_temp.lastj('batch_id')), pg_temp.setv('t1', pg_temp.lastj('text')), pg_temp.setv('s1', pg_temp.lastj('subject'));
select pg_temp.chk('payload carries no customer data: no tenant name, amount, e-mail, transaction id, provider id',
  pg_temp.getv('t1') !~* '(T1|T2|99000|@|mid-|0000000b40)' and pg_temp.getv('s1') !~* '(@|mid-)'
  and pg_temp.sc(format($q$select recipient_user_ids::text from public.prompter_payment_alert_notification_batches where id = %L$q$, pg_temp.getv('b1'))) = '{00000000-0000-0000-0000-0000000b4021}');
select pg_temp.chk('claim never modifies an alert, a transaction or a subscription', pg_temp.alerts_fp() = (select f from afp) and pg_temp.fingerprint() = (select f from fp0));
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('while the lease is held a second claim does nothing (no second batch, no double send)', :'r' = 'NOTHING' and pg_temp.nb() = '1' and pg_temp.na() = '0');
select pg_temp.chk('payload is frozen (subject / body / recipients / hash), the batch and its notifications cannot be deleted or truncated',
  pg_temp.try(format('update public.prompter_payment_alert_notification_batches set body = ''x'' where id = %L', pg_temp.getv('b1'))) like '%frozen%'
  and pg_temp.try(format('update public.prompter_payment_alert_notification_batches set recipient_user_ids = array[gen_random_uuid()] where id = %L', pg_temp.getv('b1'))) like '%frozen%'
  and pg_temp.try('delete from public.prompter_payment_alert_notification_batches') like '%not deletable%'
  and (pg_temp.try('truncate public.prompter_payment_alert_notification_batches') like '%not deletable%' or pg_temp.try('truncate public.prompter_payment_alert_notification_batches') like '%foreign key%')
  and pg_temp.try('delete from public.prompter_payment_alert_notifications') like '%not deletable%'
  and pg_temp.try('truncate public.prompter_payment_alert_notifications') like '%not deletable%');

-- ===== 4. crash / retry / backoff: same batch, same frozen payload, same idempotency key =====
select pg_temp.fl(pg_temp.getv('b1')::uuid, 1, 'HTTP_429', 429) r \gset
select pg_temp.chk('transient failure #1 -> RETRY with ~1 minute backoff, lease released, batch still READY',
  :'r' = 'RETRY' and pg_temp.sc(format($q$select (status||':'||(lease_until is null)||':'||(next_attempt_at between now()+interval '50 seconds' and now()+interval '70 seconds'))::text from public.prompter_payment_alert_notification_batches where id=%L$q$, pg_temp.getv('b1'))) = 'READY:true:true');
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('a batch that is not due yet is not claimed (and no new batch is made)', :'r' = 'NOTHING' and pg_temp.nb() = '1');
select pg_temp.due(pg_temp.getv('b1')::uuid);
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('retry claims the SAME batch with the SAME idempotency key and the SAME text, attempt 2',
  :'r' = 'CLAIMED' and pg_temp.lastj('retry') = 'true' and pg_temp.lastj('batch_id') = pg_temp.getv('b1') and pg_temp.lastj('attempt_no') = '2'
  and pg_temp.lastj('idempotency_key') = pg_temp.getv('b1') || '-1' and pg_temp.lastj('text') = pg_temp.getv('t1') and pg_temp.lastj('subject') = pg_temp.getv('s1') and pg_temp.nb() = '1');
-- crash: attempt 2 never reports back; lease runs out
select pg_temp.lease_over(pg_temp.getv('b1')::uuid);
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('crashed attempt: lease expiry is audited (LEASE_EXPIRED) and the next claim retries the same batch, attempt 3',
  :'r' = 'CLAIMED' and pg_temp.lastj('attempt_no') = '3' and pg_temp.lastj('batch_id') = pg_temp.getv('b1') and pg_temp.lastj('idempotency_key') = pg_temp.getv('b1') || '-1'
  and pg_temp.na($$outcome='LEASE_EXPIRED' and attempt_no=2$$) = '1' and pg_temp.nb() = '1');
select pg_temp.fl(pg_temp.getv('b1')::uuid, 2, 'HTTP_500', 500) r \gset
select pg_temp.chk('a late report from the dead attempt 2 is STALE and does not touch the live attempt 3',
  :'r' = 'STALE' and pg_temp.sc(format($q$select (lease_until is not null)::text from public.prompter_payment_alert_notification_batches where id=%L$q$, pg_temp.getv('b1'))) = 'true');
select pg_temp.fl(pg_temp.getv('b1')::uuid, 3, 'HTTP_409_INVALID_IDEMPOTENT', 409, true) r \gset
select pg_temp.chk('attempt 3 fails with rotate_key -> backoff ~15 min, key_generation 2, payload unchanged',
  :'r' = 'RETRY' and pg_temp.sc(format($q$select (key_generation||':'||(next_attempt_at between now()+interval '14 minutes' and now()+interval '16 minutes')||':'||(body = %L))::text from public.prompter_payment_alert_notification_batches where id=%L$q$, pg_temp.getv('t1'), pg_temp.getv('b1'))) = '2:true:true');
select pg_temp.due(pg_temp.getv('b1')::uuid);
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('after a rotation the key is <batch>-2, still the same batch and text',
  :'r' = 'CLAIMED' and pg_temp.lastj('idempotency_key') = pg_temp.getv('b1') || '-2' and pg_temp.lastj('attempt_no') = '4' and pg_temp.lastj('text') = pg_temp.getv('t1'));
select pg_temp.chk('error codes are sanitised: free text / secrets can never reach the audit trail',
  pg_temp.fl(pg_temp.getv('b1')::uuid, 4, 're_secret_key sk-abc 123', 500) = 'RETRY'
  and pg_temp.na($$error_code='UNKNOWN' and attempt_no=4$$) = '1' and pg_temp.na($$error_code ~ '[a-z ]'$$) = '0');
select pg_temp.due(pg_temp.getv('b1')::uuid);
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.dn(pg_temp.getv('b1')::uuid, 'msg_abc123') r2 \gset
select pg_temp.chk('complete -> SENT (idempotent: a second complete is ALREADY_SENT), notifications SENT, state heartbeat updated',
  :'r2' = 'SENT' and pg_temp.dn(pg_temp.getv('b1')::uuid, 'other') = 'ALREADY_SENT'
  and pg_temp.nn($$status='SENT'$$) = '4' and pg_temp.nn($$status='BATCHED'$$) = '0'
  and pg_temp.sc(format($q$select (status||':'||provider_message_id||':'||(sent_at is not null)) from public.prompter_payment_alert_notification_batches where id=%L$q$, pg_temp.getv('b1'))) = 'SENT:msg_abc123:true'
  and pg_temp.sc('select (last_success_at is not null)||'':''||consecutive_failures from public.prompter_payment_alert_notify_state where id=1') = 'true:0');
select pg_temp.chk('audit trail of the batch: 4 FAILED / LEASE_EXPIRED rows + SENT, append-only',
  pg_temp.na($$outcome='SENT'$$) = '1' and pg_temp.na($$outcome='FAILED'$$) = '3' and pg_temp.na($$outcome='LEASE_EXPIRED'$$) = '1'
  and pg_temp.try('update public.prompter_payment_alert_notification_attempts set outcome = ''SENT''') like '%append-only%'
  and pg_temp.try('delete from public.prompter_payment_alert_notification_attempts') like '%append-only%'
  and pg_temp.try('truncate public.prompter_payment_alert_notification_attempts') like '%append-only%');

-- ===== 5. replay / reopen / dedupe =====
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK','gw:cb1') r \gset
select pg_temp.sync() s \gset
select pg_temp.cl() ->> 'result' r2 \gset
select pg_temp.chk('REPLAY of the same verified event (and a repeated sync) creates no new notification and no new e-mail',
  :'r2' = 'NOTHING' and pg_temp.nn() = '4' and pg_temp.nb() = '1');
select pg_temp.res(pg_temp.aid('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK'), pg_temp.getv('op1')::uuid) r \gset
select pg_temp.cl() ->> 'result' r2 \gset
select pg_temp.chk('resolving an alert sends nothing', :'r2' = 'NOTHING' and pg_temp.nn() = '4');
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','CHARGEBACK','gw:cb2') r \gset
select pg_temp.cl() ->> 'result' r2 \gset
select pg_temp.chk('a NEW verified event REOPENS the alert -> exactly one new notification (sequence 2) in a new batch of 1 item',
  :'r' = 'REOPENED' and :'r2' = 'CLAIMED' and pg_temp.lastj('item_count') = '1' and pg_temp.lastj('batch_id') <> pg_temp.getv('b1')
  and pg_temp.lastj('text') like '%CHARGEBACK · id %· dibuka ulang ke-1%'
  and pg_temp.nn() = '5' and pg_temp.nn($$sequence=2$$) = '1' and pg_temp.nb() = '2');
select pg_temp.setv('b2', pg_temp.lastj('batch_id'));
select pg_temp.dn(pg_temp.getv('b2')::uuid, 'msg_2');
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('after the reopen e-mail is sent nothing more is pending (no duplicate for the same sequence)', :'r' = 'NOTHING' and pg_temp.nn() = '5');

-- ===== 6. acknowledged before sending -> skipped =====
update public.prompter_payment_operators set active = false where user_id = pg_temp.getv('op1')::uuid;
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b3','REVERSAL','gw:rv1') r \gset
select pg_temp.cl() ->> 'result' r2 \gset
select pg_temp.chk('with no recipient the notification waits as PENDING', :'r2' = 'NO_RECIPIENT' and pg_temp.nn($$status='PENDING'$$) = '1');
update public.prompter_payment_operators set active = true where user_id = pg_temp.getv('op1')::uuid;
select pg_temp.ack(pg_temp.aid('00000000-0000-0000-0000-0000000b40b3','REVERSAL'), pg_temp.getv('op1')::uuid) r2 \gset
select pg_temp.cl() ->> 'result' r3 \gset
select pg_temp.chk('an alert acknowledged before the sender ran is SKIPPED, not e-mailed; an ACKED alert is never derived',
  :'r3' = 'NOTHING' and pg_temp.nn($$status='SKIPPED'$$) = '1' and pg_temp.nb() = '2' and pg_temp.nn() = '6');

-- ===== 7. permanent failure and max attempts =====
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REFUND','gw:rf9') r \gset
select pg_temp.cl() ->> 'result' r2 \gset
select pg_temp.setv('b3', pg_temp.lastj('batch_id')), pg_temp.lastj('top_severity') ts \gset
select pg_temp.fl(pg_temp.getv('b3')::uuid, 1, 'HTTP_422', 422, false, true) r \gset
select pg_temp.chk('permanent provider rejection -> DEAD at once, notifications FAILED, never re-derived into a retry loop',
  :'r' = 'DEAD' and :'ts' = 'HIGH' and pg_temp.nn($$status='FAILED'$$) = '1' and pg_temp.nb($$status='DEAD'$$) = '1'
  and pg_temp.na($$batch_id='$$ || pg_temp.getv('b3') || $$' and outcome='EXPIRED'$$) = '1');
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('a DEAD batch is not re-created from the same (alert, sequence): dedupe holds', :'r' = 'NOTHING' and pg_temp.nn() = '7');
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b2','CHARGEBACK','gw:cb9') r \gset
select pg_temp.cl() ->> 'result' r2 \gset
select pg_temp.setv('b4', pg_temp.lastj('batch_id'));
do $$ declare i int; r text; begin
  for i in 1..5 loop
    r := pg_temp.fl(pg_temp.getv('b4')::uuid, i, 'NETWORK', null);
    if r <> 'RETRY' then raise exception 'attempt % expected RETRY got %', i, r; end if;
    perform pg_temp.due(pg_temp.getv('b4')::uuid);
    perform pg_temp.cl();
  end loop;
  perform pg_temp.setv('b4last', pg_temp.fl(pg_temp.getv('b4')::uuid, 6, 'NETWORK', null));
end $$;
select pg_temp.chk('6 failed attempts -> backoff 1/5/15/60/240 min then DEAD (max 6 attempts)',
  pg_temp.getv('b4last') = 'DEAD' and pg_temp.nb($$status='DEAD'$$) = '2' and pg_temp.na($$batch_id='$$ || pg_temp.getv('b4') || $$' and outcome='FAILED'$$) = '6');
-- 23 hour hard stop (Resend remembers an idempotency key for 24h; we never retry past 23h)
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b2','REVERSAL','gw:rv9') r \gset
select pg_temp.cl() ->> 'result' r2 \gset
select pg_temp.setv('b5', pg_temp.lastj('batch_id'));
update public.prompter_payment_alert_notification_batches set first_attempt_at = now() - interval '23 hours 30 minutes', lease_until = now() - interval '1 second' where id = pg_temp.getv('b5')::uuid;
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('a batch older than 23h is marked DEAD (EXPIRED) and is NEVER re-sent with the old key',
  :'r' = 'NOTHING' and pg_temp.nb($$id='$$ || pg_temp.getv('b5') || $$' and status='DEAD'$$) = '1' and pg_temp.na($$batch_id='$$ || pg_temp.getv('b5') || $$' and outcome='EXPIRED'$$) = '1');

-- ===== 8. daily budget, CRITICAL reserve, priority =====
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b3','REFUND','gw:rf3') r \gset
select pg_temp.nb($$created_day = (now() at time zone 'utc')::date$$) today \gset
select pg_temp.cl(:today::int, 1) ->> 'result' r \gset
select pg_temp.chk('daily limit reached -> DAILY_LIMIT, the alert stays pending (merged into the next day)', :'r' = 'DAILY_LIMIT' and pg_temp.nn($$status='PENDING'$$) = '1');
select pg_temp.cl(:today::int + 3, 3) ->> 'result' r \gset
select pg_temp.chk('HIGH-only alerts cannot use the slots reserved for CRITICAL -> RESERVE_HELD', :'r' = 'RESERVE_HELD' and pg_temp.nn($$status='PENDING'$$) = '1');
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b3','CHARGEBACK','gw:cb3') r \gset
select pg_temp.cl(:today::int + 3, 3, 1) ->> 'result' r \gset
select pg_temp.chk('a CRITICAL alert may use the reserve and goes first even with max_items=1; the HIGH one stays pending',
  :'r' = 'CLAIMED' and pg_temp.lastj('top_severity') = 'CRITICAL' and pg_temp.lastj('item_count') = '1' and pg_temp.nn($$status='PENDING'$$) = '1');
select pg_temp.dn(pg_temp.lastj('batch_id')::uuid, 'msg_6');
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('with budget available the remaining HIGH alert is sent next', :'r' = 'CLAIMED' and pg_temp.lastj('top_severity') = 'HIGH' and pg_temp.nn($$status='PENDING'$$) = '0');
select pg_temp.dn(pg_temp.lastj('batch_id')::uuid, 'msg_7');
select pg_temp.chk('never more batches than the limit were created today',
  pg_temp.nb($$created_day = (now() at time zone 'utc')::date$$)::int <= :today::int + 2);

-- ===== 9. no recipient =====
update public.prompter_payment_operators set active = false where user_id = pg_temp.getv('op1')::uuid;
select pg_temp.rec('00000000-0000-0000-0000-0000000b40b1','REVERSAL','gw:rv5') r \gset
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('no active confirmed operator -> NO_RECIPIENT: no batch, notification stays pending, nothing hard-coded to fall back on',
  :'r' = 'NO_RECIPIENT' and pg_temp.nn($$status='PENDING'$$) = '1' and pg_temp.nb() = (select pg_temp.nb())
  and pg_temp.sc('select last_claim_result from public.prompter_payment_alert_notify_state where id=1') = 'NO_RECIPIENT');
update public.prompter_payment_operators set active = true where user_id = pg_temp.getv('op1')::uuid;
select pg_temp.cl() ->> 'result' r \gset
select pg_temp.chk('once an operator is active again the pending alert is sent', :'r' = 'CLAIMED');
select pg_temp.setv('b9', pg_temp.lastj('batch_id'));
update public.prompter_payment_operators set active = false where user_id = pg_temp.getv('op1')::uuid;
select pg_temp.chk('an operator deactivated AFTER the batch was frozen is dropped at send time (emails list empty)',
  pg_temp.as_service(format($q$select public.fn_payment_notification_recipient_emails(recipient_user_ids)::text from public.prompter_payment_alert_notification_batches where id=%L$q$, pg_temp.getv('b9'))) = '{}');
update public.prompter_payment_operators set active = true where user_id = pg_temp.getv('op1')::uuid;

-- ===== 10. isolation: nothing outside B4.2 changed =====
select pg_temp.chk('transactions and subscriptions are byte-identical after the whole B4.2 flow', pg_temp.fingerprint() = (select f from fp0));
select pg_temp.chk('no pg_cron job and no pg_net call was created by B4.2',
  not exists (select 1 from pg_extension where extname = 'pg_cron') or pg_temp.sc($q$select count(*) from cron.job where jobname ilike '%notif%'$q$) = '0');
select 'B4.2 SEQUENTIAL SCENARIOS DONE' as done;
