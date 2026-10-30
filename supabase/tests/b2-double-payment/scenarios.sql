-- LOCAL-ONLY Billing B2 sequential scenarios on a throw-away PostgreSQL. Synthetic data. Never run against Supabase.
\ir support/helpers.sql
create or replace function pg_temp.mk(n text, st text, plan_ text, startoff text, endoff text) returns void language plpgsql as $$
declare t uuid := ('00000000-0000-0000-0000-000000b2'||n)::uuid; u uuid := ('00000000-0000-0000-0000-000000b3'||n)::uuid;
begin
  insert into public.tenants(id,nama_usaha) values (t,'B2 '||n);
  insert into public.user_profiles values (u, t, 'owner '||n, 'owner');
  insert into public.prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end,billing_provider)
  values (t, plan_, st, now()+startoff::interval, now()+endoff::interval, case when st='TRIALING' then null else 'midtrans' end);
end $$;
create or replace function pg_temp.t(n text) returns text language sql as $$ select '00000000-0000-0000-0000-000000b2'||n $$;
create or replace function pg_temp.u(n text) returns text language sql as $$ select '00000000-0000-0000-0000-000000b3'||n $$;
create or replace function pg_temp.co(n text, plan_ text) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select out_outcome||':'||coalesce(out_transaction_id::text,'-') from public.fn_begin_checkout(%L::uuid,%L::uuid,%L,'midtrans')$q$, pg_temp.t(n), pg_temp.u(n), plan_)); end $$;
create or replace function pg_temp.cid(r text) returns uuid language sql as $$ select nullif(split_part(r,':',2),'-')::uuid $$;
create or replace function pg_temp.pay(txn uuid, tag text, amt numeric) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment(%L::uuid,%L,%L,%s,'IDR')$q$, txn, 'pay_'||tag, 'evt_'||tag, amt)); end $$;
create or replace function pg_temp.endat(n text) returns timestamptz language sql as $$ select current_period_end from public.prompter_subscriptions where tenant_id = pg_temp.t(n)::uuid $$;
create or replace function pg_temp.near(a timestamptz, b timestamptz) returns boolean language sql as $$ select abs(extract(epoch from (a-b))) < 300 $$;
create or replace function pg_temp.st(txn uuid) returns text language sql as $$ select status||'/'||coalesce(failure_reason,'') from public.prompter_payment_transactions where id = txn $$;
create or replace function pg_temp.npending(n text) returns bigint language sql as $$ select count(*) from public.prompter_payment_transactions where tenant_id = pg_temp.t(n)::uuid and status='PENDING' $$;

-- NOTE: helpers below are plpgsql (fresh snapshot) so a check can read state written by the pay() call in the SAME statement.
create or replace function pg_temp.ss(n text) returns text language plpgsql as $$ declare r text; begin select status into r from public.prompter_subscriptions where tenant_id = pg_temp.t(n)::uuid; return r; end $$;
create or replace function pg_temp.sp(n text) returns text language plpgsql as $$ declare r text; begin select plan into r from public.prompter_subscriptions where tenant_id = pg_temp.t(n)::uuid; return r; end $$;
create or replace function pg_temp.sps(n text) returns text language plpgsql as $$ declare r text; begin select plan||'/'||status into r from public.prompter_subscriptions where tenant_id = pg_temp.t(n)::uuid; return r; end $$;

-- ===== A. checkout: one open invoice per tenant =====
select pg_temp.mk('0001','TRIALING','FREE','-1 day','13 days');
create temp table a1 as select pg_temp.co('0001','STARTER') r;
create temp table a2 as select pg_temp.co('0001','STARTER') r;
select pg_temp.chk('A1 first checkout CREATED', (select r from a1) like 'CREATED:%');
select pg_temp.chk('A1 identical checkout returns the SAME invoice (EXISTING)', (select r from a2) = 'EXISTING:' || pg_temp.cid((select r from a1)));
select pg_temp.chk('A1 exactly one PENDING', pg_temp.npending('0001') = 1);
create temp table a3 as select pg_temp.co('0001','GROWTH') r;
select pg_temp.chk('A2 different plan supersedes: new invoice CREATED', (select r from a3) like 'CREATED:%');
select pg_temp.chk('A2 old invoice CANCELLED/SUPERSEDED, still exactly one PENDING', pg_temp.st(pg_temp.cid((select r from a1))) = 'CANCELLED/SUPERSEDED_BY_NEWER_CHECKOUT' and pg_temp.npending('0001') = 1);
select pg_temp.chk('A3 DB itself refuses a second PENDING (unique index, even for the table owner)',
  (select (pg_temp.dml_as(null, format($q$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values (%L,%L,'midtrans','GROWTH',199000,'IDR')$q$, pg_temp.t('0001'), pg_temp.u('0001')), 'postgres')) like '23505:%'));
create temp table a4 as select pg_temp.co('0001','STARTER') r;
select pg_temp.chk('A4 provider/plan switching never leaves two PENDING', pg_temp.npending('0001') = 1);
do $$ declare i int; r text; last_ text; begin
  for i in 1..30 loop r := pg_temp.co('0001', case when i % 2 = 0 then 'STARTER' else 'GROWTH' end); last_ := split_part(r,':',1); exit when last_ = 'TOO_MANY_PENDING'; end loop;
  perform pg_temp.chk('A5 creation churn is capped (TOO_MANY_PENDING)', last_ = 'TOO_MANY_PENDING');
end $$;
select pg_temp.chk('A5 a refused request changed nothing: still exactly one PENDING', pg_temp.npending('0001') = 1);

-- ===== B. two paid invoices: periods add up, trial bonus exactly once =====
select pg_temp.mk('0002','TRIALING','FREE','-1 day','13 days');
create temp table b1 as select pg_temp.co('0002','STARTER') r;
select pg_temp.chk('B1 first payment accepted', pg_temp.pay(pg_temp.cid((select r from b1)),'b1',99000) = 'true:');
create temp table b1e as select pg_temp.endat('0002') e;
select pg_temp.chk('B1 first period = 1 month + remaining trial (13 days)', pg_temp.near((select e from b1e), now() + interval '1 month' + interval '13 days'));
create temp table b2 as select pg_temp.co('0002','STARTER') r;
select pg_temp.chk('B2 second payment accepted', pg_temp.pay(pg_temp.cid((select r from b2)),'b2',99000) = 'true:');
select pg_temp.chk('B2 second period ADDED exactly one month, no second trial bonus, nothing overwritten', pg_temp.endat('0002') = (select e from b1e) + interval '1 month');
create temp table b3 as select pg_temp.co('0002','STARTER') r;
select pg_temp.chk('B3 third payment adds exactly one more month', pg_temp.pay(pg_temp.cid((select r from b3)),'b3',99000) = 'true:' and pg_temp.endat('0002') = (select e from b1e) + interval '2 months');
select pg_temp.chk('B3 3 PAID transactions, 3 audit rows, plan unchanged', (select count(*) from public.prompter_payment_transactions where tenant_id=pg_temp.t('0002')::uuid and status='PAID') = 3
  and (select count(*) from public.prompter_audit_logs where tenant_id=pg_temp.t('0002')::uuid and action='payment.succeeded') = 3
  and pg_temp.sp('0002') = 'STARTER');
-- expired / past-due: restart from the activation time
select pg_temp.mk('0003','ACTIVE','STARTER','-40 days','-3 days');
create temp table b4 as select pg_temp.co('0003','STARTER') r;
select pg_temp.chk('B4 ACTIVE but expired period: restarts from now, no stacking on the past', pg_temp.pay(pg_temp.cid((select r from b4)),'b4',99000) = 'true:' and pg_temp.near(pg_temp.endat('0003'), now() + interval '1 month'));
select pg_temp.mk('0004','PAST_DUE','PRO','-70 days','-10 days');
create temp table b5 as select pg_temp.co('0004','PRO') r;
select pg_temp.chk('B5 PAST_DUE pays: ACTIVE from now, 1 month, no bonus', pg_temp.pay(pg_temp.cid((select r from b5)),'b5',399000) = 'true:' and pg_temp.near(pg_temp.endat('0004'), now() + interval '1 month')
  and pg_temp.ss('0004') = 'ACTIVE');

-- ===== C. same webhook many times =====
select pg_temp.mk('0005','TRIALING','FREE','-1 day','13 days');
create temp table c0 as select pg_temp.co('0005','GROWTH') r;
create temp table c1 as select i, pg_temp.pay(pg_temp.cid((select r from c0)),'c1',199000) r from generate_series(1,10) i;
select pg_temp.chk('C 10 deliveries of one webhook: 1 applied + 9 ALREADY_PROCESSED', (select count(*) from c1 where r='true:') = 1 and (select count(*) from c1 where r='true:ALREADY_PROCESSED') = 9);
select pg_temp.chk('C one PAID, one audit row, period not extended by replays', (select count(*) from public.prompter_audit_logs where tenant_id=pg_temp.t('0005')::uuid and action='payment.succeeded') = 1
  and pg_temp.near(pg_temp.endat('0005'), now() + interval '1 month' + interval '13 days'));

-- ===== E. activation failures =====
select pg_temp.mk('0006','TRIALING','FREE','-1 day','13 days');
create temp table e0 as select pg_temp.co('0006','STARTER') r;
create or replace function public.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
create trigger zz_boom before update on public.prompter_subscriptions for each row execute function public.zz_boom();
create or replace function pg_temp.try_pay(txn uuid, tag text, amt numeric) returns text language plpgsql as $$
begin return pg_temp.pay(txn,tag,amt); exception when others then return 'EXC:'||sqlerrm; end $$;
select pg_temp.chk('E1 error inside activation surfaces as an error (gateway retries)', pg_temp.pay(pg_temp.cid((select r from e0)),'e1',99000) like 'P0001:%injected failure%');
select pg_temp.chk('E1 nothing half-applied: txn still PENDING, subscription untouched', pg_temp.st(pg_temp.cid((select r from e0))) = 'PENDING/' and pg_temp.ss('0006') = 'TRIALING');
drop trigger zz_boom on public.prompter_subscriptions; drop function public.zz_boom();
select pg_temp.chk('E1 retry after the fault is cleared activates once', pg_temp.pay(pg_temp.cid((select r from e0)),'e1',99000) = 'true:' and pg_temp.ss('0006') = 'ACTIVE');
-- UPDATE that silently matches 0 rows (a BEFORE UPDATE trigger returning NULL cancels the row update)
select pg_temp.mk('0007','TRIALING','FREE','-1 day','13 days');
create temp table e2 as select pg_temp.co('0007','STARTER') r;
create or replace function public.zz_skip() returns trigger language plpgsql as $$ begin return null; end $$;
create trigger zz_skip before update on public.prompter_subscriptions for each row execute function public.zz_skip();
select pg_temp.chk('E2 subscription UPDATE affecting 0 rows is an ERROR, not a success', pg_temp.pay(pg_temp.cid((select r from e2)),'e2',99000) like 'P0001:SUBSCRIPTION_UPDATE_AFFECTED_0%');
select pg_temp.chk('E2 the PAID mark was rolled back (no PAID without activation)', pg_temp.st(pg_temp.cid((select r from e2))) = 'PENDING/');
drop trigger zz_skip on public.prompter_subscriptions; drop function public.zz_skip();
-- subscription row missing
select pg_temp.mk('0008','TRIALING','FREE','-1 day','13 days');
create temp table e3 as select pg_temp.co('0008','STARTER') r;
alter table public.prompter_subscriptions disable trigger user;
delete from public.prompter_subscriptions where tenant_id = pg_temp.t('0008')::uuid;
alter table public.prompter_subscriptions enable trigger user;
select pg_temp.chk('E3 payment with no subscription row: NOT success, recorded as REVIEW', pg_temp.pay(pg_temp.cid((select r from e3)),'e3',99000) = 'false:NEEDS_REVIEW' and pg_temp.st(pg_temp.cid((select r from e3))) = 'REVIEW/NO_SUBSCRIPTION');
select pg_temp.chk('E3 evidence kept: provider ids + reported amount + audit row', (select provider_payment_id = 'pay_e3' and provider_event_id = 'evt_e3' and (metadata->'review'->>'reported_amount')::numeric = 99000 from public.prompter_payment_transactions where id = pg_temp.cid((select r from e3)))
  and (select count(*) from public.prompter_audit_logs where resource_id = pg_temp.cid((select r from e3)) and action='payment.needs_review') = 1);

-- ===== late payment on EXPIRED / CANCELLED / FAILED invoices =====
select pg_temp.mk('0009','TRIALING','FREE','-1 day','13 days');
create temp table l0 as select pg_temp.co('0009','STARTER') r;
update public.prompter_payment_transactions set created_at = now() - interval '25 hours' where id = pg_temp.cid((select r from l0));
select pg_temp.chk('L0 stale sweep expires the invoice', pg_temp.as_service('select public.fn_expire_stale_payment_transactions()::text') = '1' and pg_temp.st(pg_temp.cid((select r from l0))) like 'EXPIRED/%');
select pg_temp.chk('L1 paid after expiry: REVIEW (not ignored, not auto-activated)', pg_temp.pay(pg_temp.cid((select r from l0)),'l1',99000) = 'false:NEEDS_REVIEW'
  and pg_temp.st(pg_temp.cid((select r from l0))) = 'REVIEW/LATE_PAYMENT_EXPIRED'
  and pg_temp.ss('0009') = 'TRIALING');
select pg_temp.chk('L2 replay of the same late webhook: still NEEDS_REVIEW, one audit row, no change', pg_temp.pay(pg_temp.cid((select r from l0)),'l1',99000) = 'false:NEEDS_REVIEW'
  and (select count(*) from public.prompter_audit_logs where resource_id = pg_temp.cid((select r from l0)) and action='payment.needs_review') = 1);
select pg_temp.chk('L3 resolver refuses a gateway amount that differs', pg_temp.as_service(format($q$select reason from public.fn_resolve_review_payment(%L::uuid, 1000, 'IDR')$q$, pg_temp.cid((select r from l0)))) = 'AMOUNT_OR_CURRENCY_MISMATCH' and pg_temp.st(pg_temp.cid((select r from l0))) like 'REVIEW/%');
select pg_temp.chk('L4 an authenticated user cannot call the resolver', pg_temp.q_as(pg_temp.u('0009'), format($q$select reason from public.fn_resolve_review_payment(%L::uuid, 99000, 'IDR')$q$, pg_temp.cid((select r from l0)))) like '42501:%');
select pg_temp.chk('L5 resolver after gateway verification applies it through the normal guarded path', pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_resolve_review_payment(%L::uuid, 99000, 'IDR')$q$, pg_temp.cid((select r from l0)))) = 'true:'
  and pg_temp.st(pg_temp.cid((select r from l0))) = 'PAID/' and pg_temp.ss('0009') = 'ACTIVE'
  and pg_temp.near(pg_temp.endat('0009'), now() + interval '1 month' + interval '13 days'));
select pg_temp.chk('L6 resolver is not re-usable (NOT_IN_REVIEW) and never doubles the period', pg_temp.as_service(format($q$select reason from public.fn_resolve_review_payment(%L::uuid, 99000, 'IDR')$q$, pg_temp.cid((select r from l0)))) = 'NOT_IN_REVIEW'
  and pg_temp.near(pg_temp.endat('0009'), now() + interval '1 month' + interval '13 days'));
-- superseded (CANCELLED) invoice paid in addition to the current one
select pg_temp.mk('0010','TRIALING','FREE','-1 day','13 days');
create temp table l1 as select pg_temp.co('0010','STARTER') r;
create temp table l2 as select pg_temp.co('0010','GROWTH') r;
select pg_temp.chk('L7 current invoice paid: activates GROWTH once', pg_temp.pay(pg_temp.cid((select r from l2)),'l7',199000) = 'true:' and pg_temp.sp('0010') = 'GROWTH');
select pg_temp.chk('L8 the superseded old invoice is also paid: REVIEW, plan and period NOT touched', pg_temp.pay(pg_temp.cid((select r from l1)),'l8',99000) = 'false:NEEDS_REVIEW'
  and pg_temp.st(pg_temp.cid((select r from l1))) = 'REVIEW/LATE_PAYMENT_CANCELLED'
  and pg_temp.sp('0010') = 'GROWTH' and pg_temp.near(pg_temp.endat('0010'), now() + interval '1 month' + interval '13 days'));
-- wrong amount reported by the gateway
select pg_temp.mk('0011','TRIALING','FREE','-1 day','13 days');
create temp table m0 as select pg_temp.co('0011','STARTER') r;
select pg_temp.chk('M1 wrong amount: REVIEW with reason, subscription unchanged', pg_temp.pay(pg_temp.cid((select r from m0)),'m1',1000) = 'false:NEEDS_REVIEW'
  and pg_temp.st(pg_temp.cid((select r from m0))) = 'REVIEW/AMOUNT_OR_CURRENCY_MISMATCH' and pg_temp.ss('0011') = 'TRIALING');

-- ===== F. plan rules during a paid period =====
select pg_temp.mk('0012','TRIALING','FREE','-1 day','13 days');
create temp table f0 as select pg_temp.co('0012','PRO') r;      -- legacy-style open invoice for PRO
select pg_temp.mk('0013','ACTIVE','STARTER','-5 days','25 days');
select pg_temp.chk('F1 other plan while a paid period runs: checkout refused', pg_temp.co('0013','PRO') = 'PLAN_CHANGE_NOT_ALLOWED:-');
select pg_temp.chk('F1 same plan while ACTIVE: allowed', pg_temp.co('0013','STARTER') like 'CREATED:%');
-- an invoice for another plan that was opened BEFORE the tenant became ACTIVE with a different plan, then gets paid
update public.prompter_subscriptions set plan='STARTER', status='ACTIVE', current_period_start=now(), current_period_end=now()+interval '20 days' where tenant_id = pg_temp.t('0012')::uuid;
create temp table f2e as select pg_temp.endat('0012') e, pg_temp.sp('0012') p;
select pg_temp.chk('F2 old PRO invoice paid while STARTER is paid-active: REVIEW, plan NOT silently changed, period untouched', pg_temp.pay(pg_temp.cid((select r from f0)),'f2',399000) = 'false:NEEDS_REVIEW'
  and pg_temp.st(pg_temp.cid((select r from f0))) = 'REVIEW/PLAN_CONFLICT_ACTIVE_PERIOD'
  and pg_temp.sp('0012') = 'STARTER' and pg_temp.sp('0012') = (select p from f2e) and pg_temp.endat('0012') = (select e from f2e));
select pg_temp.mk('0014','ACTIVE','STARTER','-40 days','-2 days');
create temp table f3 as select pg_temp.co('0014','PRO') r;
select pg_temp.chk('F3 other plan after the period expired: allowed (CREATED)', (select r from f3) like 'CREATED:%');
select pg_temp.chk('F3 ...and applied from now', pg_temp.pay(pg_temp.cid((select r from f3)),'f3',399000) = 'true:' and pg_temp.sp('0014') = 'PRO' and pg_temp.near(pg_temp.endat('0014'), now() + interval '1 month'));
-- trial plan preference (#74) still composes
select pg_temp.mk('0015','TRIALING','FREE','-1 day','13 days');
select pg_temp.chk('F4 #74 trial plan preference still works', pg_temp.q_as(pg_temp.u('0015'), $$select out_ok::text from public.fn_set_trial_plan_preference('GROWTH')$$) = 'true');
create temp table f4 as select pg_temp.co('0015','GROWTH') r;
select pg_temp.chk('F4 then paying GROWTH during the trial: ACTIVE GROWTH + 13 day bonus once', pg_temp.pay(pg_temp.cid((select r from f4)),'f4',199000) = 'true:'
  and pg_temp.sps('0015') = 'GROWTH/ACTIVE' and pg_temp.near(pg_temp.endat('0015'), now() + interval '1 month' + interval '13 days'));

-- ===== isolation, privileges, #74 / #75 compatibility =====
select pg_temp.chk('X1 owner of another tenant cannot open a checkout for this tenant', pg_temp.as_service(format($q$select out_outcome from public.fn_begin_checkout(%L::uuid,%L::uuid,'STARTER','midtrans')$q$, pg_temp.t('0002'), pg_temp.u('0001'))) = 'NOT_MEMBER');
select pg_temp.chk('X2 unknown transaction id', pg_temp.pay(gen_random_uuid(),'x2',99000) = 'false:TRANSACTION_NOT_FOUND');
select pg_temp.chk('X3 paying tenant 0002 transaction never touched tenant 0003/0001', pg_temp.near(pg_temp.endat('0003'), now() + interval '1 month') and pg_temp.ss('0001') = 'TRIALING');
select pg_temp.chk('P1 anon / authenticated cannot execute apply, resolve or begin_checkout', not has_function_privilege('anon','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')
  and not has_function_privilege('authenticated','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')
  and not has_function_privilege('anon','public.fn_resolve_review_payment(uuid,numeric,text)','execute') and not has_function_privilege('authenticated','public.fn_resolve_review_payment(uuid,numeric,text)','execute')
  and not has_function_privilege('anon','public.fn_begin_checkout(uuid,uuid,text,text)','execute') and not has_function_privilege('authenticated','public.fn_begin_checkout(uuid,uuid,text,text)','execute')
  and has_function_privilege('service_role','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute') and has_function_privilege('service_role','public.fn_resolve_review_payment(uuid,numeric,text)','execute') and has_function_privilege('service_role','public.fn_begin_checkout(uuid,uuid,text,text)','execute'));
select pg_temp.chk('P2 #75 intact: a signed-in Owner still cannot INSERT / UPDATE a transaction', pg_temp.dml_as(pg_temp.u('0002'), format($q$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values (%L,%L,'midtrans','STARTER',1,'IDR')$q$, pg_temp.t('0002'), pg_temp.u('0002'))) like '42501:%'
  and pg_temp.dml_as(pg_temp.u('0002'), $$update public.prompter_payment_transactions set status='PAID'$$) like '42501:%');
select pg_temp.chk('P3 #74 intact: a signed-in Owner still cannot UPDATE the subscription', pg_temp.dml_as(pg_temp.u('0002'), $$update public.prompter_subscriptions set status='ACTIVE', current_period_end=now()+interval '5 years'$$) like '42501:%');
select pg_temp.chk('P4 a tenant member can still READ only its own transactions', (select pg_temp.q_as(pg_temp.u('0002'), $$select count(*)::text from public.prompter_payment_transactions where tenant_id <> '$$ || pg_temp.t('0002') || $$'$$)) = '0');

-- ===== global invariants over the B2 test tenants =====
select pg_temp.chk('I1 no PAID transaction whose tenant is not ACTIVE', not exists (select 1 from public.prompter_payment_transactions x join public.prompter_subscriptions s using (tenant_id) where x.status='PAID' and x.tenant_id::text like '00000000-0000-0000-0000-000000b2%' and s.status <> 'ACTIVE'));
select pg_temp.chk('I2 no ACTIVE test subscription without a PAID transaction (0012 / 0013 were set ACTIVE by the test itself)', not exists (select 1 from public.prompter_subscriptions s where s.tenant_id::text like '00000000-0000-0000-0000-000000b2%' and s.tenant_id::text not like '%b20012' and s.tenant_id::text not like '%b20013' and s.status='ACTIVE'
  and not exists (select 1 from public.prompter_payment_transactions x where x.tenant_id = s.tenant_id and x.status='PAID')));
select pg_temp.chk('I3 every REVIEW row carries a reason and the reported amount', not exists (select 1 from public.prompter_payment_transactions where status='REVIEW' and (failure_reason is null or metadata->'review'->>'reported_amount' is null)));
select pg_temp.chk('I4 no tenant has more than one PENDING', not exists (select 1 from public.prompter_payment_transactions where status='PENDING' group by tenant_id having count(*) > 1));
