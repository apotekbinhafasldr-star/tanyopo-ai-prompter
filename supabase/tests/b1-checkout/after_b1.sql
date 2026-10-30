-- LOCAL-ONLY regression test for 20261030100000_prompter_b1_server_only_checkout.sql (applied on top of #74).
-- psql variables: legacy_txn_md5_before, subs_md5_before, others_md5_before. See run-local.sh.
\ir support/helpers.sql
\set oA '00000000-0000-0000-0000-0000000000a2'
\set mA '00000000-0000-0000-0000-0000000000a3'
\set oB '00000000-0000-0000-0000-0000000000b2'
\set tA '00000000-0000-0000-0000-0000000000a1'
\set tB '00000000-0000-0000-0000-0000000000b1'
\set tC '00000000-0000-0000-0000-0000000000d1'

-- 1. nothing outside the intended objects changed, no existing data rewritten
select pg_temp.chk('existing payment transactions are byte-identical (the migration rewrites no data)',
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.prompter_payment_transactions t where id::text like '00000000-0000-0000-0000-0000000e000%') = :'legacy_txn_md5_before');
select pg_temp.chk('existing subscription rows are identical',
  (select md5(coalesce(string_agg(t::text,'|' order by tenant_id),'')) from (select tenant_id,plan,status,billing_provider,current_period_end from public.prompter_subscriptions) t) = :'subs_md5_before');
select pg_temp.chk('policies and grants of every OTHER table are unchanged (PUBLOE / UMKMpro / subscriptions untouched)',
  (select md5(coalesce(string_agg(x,'|' order by x),'')) from (
     select 'pol:'||tablename||':'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') x from pg_policies where tablename not in ('prompter_payment_transactions','prompter_plan_prices')
     union all select 'grant:'||table_name||':'||grantee||':'||privilege_type from information_schema.role_table_grants where table_schema='public' and table_name not in ('prompter_payment_transactions','prompter_plan_prices')) z) = :'others_md5_before');

-- 2. the catalog
select pg_temp.chk('catalog holds exactly the four sellable plans with the lib/billing/plans.ts prices',
  (select string_agg(plan||'='||price_idr, ',' order by plan) from public.prompter_plan_prices) = 'BUSINESS=799000,GROWTH=199000,PRO=399000,STARTER=99000');
select pg_temp.chk('catalog is not readable or writable by authenticated',
  pg_temp.q_as(:'oA', 'select count(*)::text from public.prompter_plan_prices') like '42501:%'
  and pg_temp.dml_as(:'oA', $$update public.prompter_plan_prices set price_idr = 1$$) like '42501:%'
  and pg_temp.dml_as(:'oA', $$insert into public.prompter_plan_prices(plan,price_idr) values ('STARTER',1)$$) like '42501:%');
select pg_temp.chk('catalog is not accessible by anon',
  pg_temp.q_as(null, 'select count(*)::text from public.prompter_plan_prices', 'anon') like '42501:%'
  and pg_temp.dml_as(null, $$update public.prompter_plan_prices set price_idr = 1$$, 'anon') like '42501:%');

-- 3. the client write path is closed
select pg_temp.chk('the client INSERT policy is gone; only the SELECT policy remains on the evidence table',
  (select string_agg(cmd, ',' order by cmd) from pg_policies where tablename='prompter_payment_transactions') = 'SELECT');
select pg_temp.chk('authenticated holds only SELECT on the evidence table; anon holds nothing',
  (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_name='prompter_payment_transactions' and grantee='authenticated') = 'SELECT'
  and not exists (select 1 from information_schema.role_table_grants where table_name='prompter_payment_transactions' and grantee in ('anon','PUBLIC')));
select pg_temp.chk('Owner direct INSERT with amount 1 is rejected',
  pg_temp.dml_as(:'oA', $$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','evil','BUSINESS',1,'IDR')$$) like '42501:%');
select pg_temp.chk('Owner direct INSERT even with the CORRECT catalog price is rejected (no client creation at all)',
  pg_temp.dml_as(:'oA', $$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','midtrans','STARTER',99000,'IDR')$$) like '42501:%');
select pg_temp.chk('non-owner member and anon direct INSERT are rejected',
  pg_temp.dml_as(:'mA', $$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','x','STARTER',99000,'IDR')$$) like '42501:%'
  and pg_temp.dml_as(null, $$insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','x','STARTER',99000,'IDR')$$, 'anon') like '42501:%');
select pg_temp.chk('Owner cannot UPDATE, DELETE or TRUNCATE the evidence table',
  pg_temp.dml_as(:'oB', $$update public.prompter_payment_transactions set status='PAID', amount=1$$) like '42501:%'
  and pg_temp.dml_as(:'oB', $$delete from public.prompter_payment_transactions$$) like '42501:%'
  and pg_temp.dml_as(:'oB', $$truncate public.prompter_payment_transactions$$) like '42501:%'
  and pg_temp.dml_as(null, $$truncate public.prompter_payment_transactions$$, 'anon') like '42501:%');

-- 4. tenant isolation of reads
select pg_temp.chk('Owner sees only their own tenant''s transactions (RLS SELECT unchanged)',
  pg_temp.q_as(:'oB', $$select count(*)::text||':'||count(*) filter (where tenant_id <> '00000000-0000-0000-0000-0000000000b1')::text from public.prompter_payment_transactions$$) = '1:0'
  and pg_temp.q_as(:'oA', $$select count(*) filter (where tenant_id <> '00000000-0000-0000-0000-0000000000a1')::text from public.prompter_payment_transactions$$) = '0');

-- 5. the RPC: not callable by clients, no amount parameter
select pg_temp.chk('authenticated and anon cannot call fn_begin_checkout',
  pg_temp.q_as(:'oA', $$select out_outcome from public.fn_begin_checkout('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-0000000000a2'::uuid,'STARTER','midtrans')$$) like '42501:%'
  and pg_temp.q_as(null, $$select out_outcome from public.fn_begin_checkout('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-0000000000a2'::uuid,'STARTER','midtrans')$$, 'anon') like '42501:%');
select pg_temp.chk('fn_begin_checkout has NO amount / currency parameter (nothing to tamper with)',
  (select pg_get_function_arguments(p.oid) from pg_proc p where proname='fn_begin_checkout') !~* 'amount|price|currency');
select pg_temp.chk('fn_begin_checkout is SECURITY DEFINER with a pinned search_path',
  (select prosecdef and proconfig::text like '%search_path=public%' from pg_proc where proname='fn_begin_checkout'));

-- 6. server-side creation priced from the catalog
select pg_temp.chk('STARTER Owner checkout: CREATED at the catalog price', pg_temp.begin_co(:'tA', :'oA', 'STARTER') = 'CREATED:99000');
select pg_temp.chk('the stored row carries catalog plan / amount / currency / status / user',
  (select plan||amount||currency||status||(user_id = '00000000-0000-0000-0000-0000000000a2')::text||provider from public.prompter_payment_transactions where tenant_id = :'tA' and provider='midtrans' order by created_at desc limit 1) = 'STARTER99000.00IDRPENDINGtruemidtrans');
select pg_temp.chk('GROWTH / PRO / BUSINESS use their catalog prices',
  pg_temp.begin_co(:'tA', :'oA', 'GROWTH') = 'CREATED:199000' and pg_temp.begin_co(:'tA', :'oA', 'PRO') = 'CREATED:399000' and pg_temp.begin_co(:'tA', :'oA', 'BUSINESS') = 'CREATED:799000');
select pg_temp.chk('FREE, AGENCY (coming soon), UMKMPRO_BUNDLE and unknown plans are not purchasable',
  pg_temp.begin_co(:'tA', :'oA', 'FREE') = 'PLAN_NOT_PURCHASABLE:-' and pg_temp.begin_co(:'tA', :'oA', 'AGENCY') = 'PLAN_NOT_PURCHASABLE:-'
  and pg_temp.begin_co(:'tA', :'oA', 'UMKMPRO_BUNDLE') = 'PLAN_NOT_PURCHASABLE:-' and pg_temp.begin_co(:'tA', :'oA', 'BOGUS') = 'PLAN_NOT_PURCHASABLE:-');
update public.prompter_plan_entitlements set availability = 'COMING_SOON' where plan = 'GROWTH';
select pg_temp.chk('a plan that is COMING_SOON in entitlements is refused even with a catalog price',
  pg_temp.begin_co(:'tA', :'oA', 'GROWTH') = 'PLAN_NOT_AVAILABLE:-');
update public.prompter_plan_entitlements set availability = 'ACTIVE' where plan = 'GROWTH';
select pg_temp.chk('Owner membership is re-verified in SQL: marketing member, other tenant''s Owner, unknown user',
  pg_temp.begin_co(:'tA', :'mA', 'STARTER') = 'NOT_OWNER:-'
  and pg_temp.begin_co(:'tA', :'oB', 'STARTER') = 'NOT_MEMBER:-'
  and pg_temp.begin_co(:'tA', '00000000-0000-0000-0000-00000000ffff', 'STARTER') = 'NOT_MEMBER:-');
select pg_temp.chk('invalid input is rejected without raising (null tenant / bad provider / empty plan)',
  pg_temp.as_service($$select out_outcome from public.fn_begin_checkout(null,'00000000-0000-0000-0000-0000000000a2'::uuid,'STARTER','midtrans')$$) = 'INVALID'
  and pg_temp.begin_co(:'tA', :'oA', 'STARTER', 'a;b') = 'INVALID:-' and pg_temp.begin_co(:'tA', :'oA', '') = 'INVALID:-');
select pg_temp.chk('a tenant without a subscription cannot start a checkout',
  pg_temp.begin_co('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'STARTER') = 'NO_SUBSCRIPTION:-');
select pg_temp.chk('a CANCELED tenant may resubscribe (not blocked)', pg_temp.begin_co(:'tC', '00000000-0000-0000-0000-0000000000d2', 'PRO') = 'CREATED:399000');

-- 7. spam cap is per tenant
do $$ declare i int; r text; begin
  for i in 1..9 loop r := pg_temp.begin_co('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2','STARTER'); if r <> 'CREATED:99000' then raise exception 'FAIL: unexpected %', r; end if; end loop;
end $$;
select pg_temp.chk('the 11th open PENDING in an hour is refused for that tenant', pg_temp.begin_co(:'tC', '00000000-0000-0000-0000-0000000000d2', 'STARTER') = 'TOO_MANY_PENDING:-');
select pg_temp.chk('...and does not affect another tenant', pg_temp.begin_co(:'tB', :'oB', 'STARTER') = 'CREATED:99000');

-- 8. defense in depth: the table-level guard fires for every role, even a buggy server path
select pg_temp.chk('server-role insert with a WRONG amount is rejected by the guard',
  pg_temp.dml_as(null, $$insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','x','PRO',1,'IDR')$$, 'service_role') like '23514:%');
select pg_temp.chk('guard also rejects: wrong currency, unknown/FREE plan, pre-PAID row, preset provider_payment_id, even for the table owner',
  pg_temp.dml_as(null, $$insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','x','PRO',399000,'USD')$$, 'service_role') like '23514:%'
  and pg_temp.dml_as(null, $$insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','x','FREE',0,'IDR')$$, 'service_role') like '23514:%'
  and pg_temp.dml_as(null, $$insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency,status) values ('00000000-0000-0000-0000-0000000000a1','x','PRO',399000,'IDR','PAID')$$, 'service_role') like '23514:%'
  and pg_temp.dml_as(null, $$insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency,provider_payment_id) values ('00000000-0000-0000-0000-0000000000a1','x','PRO',399000,'IDR','inv_1')$$, 'service_role') like '23514:%');
do $$ begin
  begin insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','x','PRO',1,'IDR');
    raise exception 'FAIL: table owner insert with wrong amount was accepted';
  exception when check_violation then raise notice 'PASS: even the table owner cannot insert a wrong-amount transaction (guard is role-independent)'; end;
end $$;
select pg_temp.chk('server-role insert with the exact catalog price is accepted',
  pg_temp.dml_as(null, $$insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','x','PRO',399000,'IDR')$$, 'service_role') = 'ok:1');
delete from public.prompter_payment_transactions where provider = 'x';

-- 9. compatibility with PR #74
select pg_temp.chk('#74 intact: Owner still cannot UPDATE prompter_subscriptions.plan',
  pg_temp.dml_as(:'oA', $$update public.prompter_subscriptions set plan = 'BUSINESS'$$) like '42501:%');
select pg_temp.chk('#74 intact: trial Owner can still pick a plan preference via the RPC',
  pg_temp.q_as(:'oB', $$select out_ok::text||':'||coalesce(out_reason,'') from public.fn_set_trial_plan_preference('GROWTH')$$) = 'true:'
  and pg_temp.q_as(:'oB', $$select plan from public.prompter_subscriptions$$) = 'GROWTH'
  and (select status from public.prompter_subscriptions where tenant_id = :'tB') = 'TRIALING');

-- 10. the webhook path still works end to end on a server-created transaction
-- (each volatile step runs in its own statement so every check sees the rows the previous step wrote)
create temp table t_pay as select id from public.prompter_payment_transactions
  where tenant_id = '00000000-0000-0000-0000-0000000000b1' and plan = 'STARTER' and status = 'PENDING' limit 1;
create temp table t_r1 as select pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment(%L::uuid,'inv_b1','evt_b1',99000,'IDR')$q$, (select id from t_pay))) r;
select pg_temp.chk('fn_apply_verified_payment activates a server-created transaction at the catalog amount',
  (select r from t_r1) = 'true:');
select pg_temp.chk('...the subscription is now STARTER / ACTIVE',
  (select plan||'/'||status from public.prompter_subscriptions where tenant_id = '00000000-0000-0000-0000-0000000000b1') = 'STARTER/ACTIVE');
create temp table t_r2 as select pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment(%L::uuid,'inv_b1','evt_b1',99000,'IDR')$q$, (select id from t_pay))) r;
select pg_temp.chk('replay is idempotent (ALREADY_PROCESSED, no second extension)', (select r from t_r2) = 'true:ALREADY_PROCESSED');
create temp table t_r3 as select pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment(%L::uuid,'inv_c','evt_c',1,'IDR')$q$,
    (select id from public.prompter_payment_transactions where tenant_id = '00000000-0000-0000-0000-0000000000d1' and status='PENDING' limit 1))) r;
select pg_temp.chk('a payment confirming a DIFFERENT amount than the server-priced transaction is refused',
  (select r from t_r3) = 'false:AMOUNT_OR_CURRENCY_MISMATCH');
select pg_temp.chk('without the carryover migration the first payment drops the unused trial days (documents the pre-fix behaviour)',
  (select current_period_end < now() + interval '1 month' + interval '1 hour' from public.prompter_subscriptions where tenant_id = '00000000-0000-0000-0000-0000000000b1'));
