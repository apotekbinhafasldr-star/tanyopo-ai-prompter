-- LOCAL-ONLY regression test for the P0 trial-security migrations.
-- Runs against a throwaway database after support/prod_snapshot.sql and
-- (for the "after" phase) the two migrations. See run-local.sh.
-- Each check raises on failure; a final NOTICE lists passes.
-- Expects psql variable :phase = before | after

\set ON_ERROR_STOP on
create temp table if not exists results(name text, ok boolean);
grant all on results to public;

-- fixtures (as postgres)
insert into tenants(id,nama_usaha) values
  ('00000000-0000-0000-0000-0000000000a1','A'),('00000000-0000-0000-0000-0000000000b1','B');
insert into user_profiles values
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','owner A','owner'),
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','mkt A','marketing'),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b1','owner B','owner'),
  ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a1','kasir A','kasir'),
  ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000b1','mkt B','marketing');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, false);
end $$;

-- helper: run a statement as `authenticated`, return 'ok' | sqlstate
create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin
  execute stmt; return 'ok';
exception when others then return sqlerrm;
end $$;
-- helper: number of rows a statement touched, or -1 if it raised (permission/RLS error)
create or replace function pg_temp.affected(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt; get diagnostics n = row_count; return n;
exception when others then return -1;
end $$;
-- call the RPC n times in separate invocations (a lateral call without
-- parameters would be hoisted by the planner and evaluated only once)
create or replace function pg_temp.grant_count(n int) returns int language plpgsql as $$
declare i int; granted int := 0; ok boolean;
begin
  for i in 1..n loop
    select allowed into ok from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb);
    if ok then granted := granted + 1; end if;
  end loop;
  return granted;
end $$;
grant execute on function pg_temp.try(text), pg_temp.as_user(text), pg_temp.grant_count(int), pg_temp.affected(text) to public;

\echo === phase :phase ===

-- Seed subscriptions through the app-normal path as owner A (trial row)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into prompter_subscriptions(tenant_id,status,current_period_start,current_period_end)
  values ('00000000-0000-0000-0000-0000000000a1','TRIALING', now(), now()+interval '14 days');
reset role;

-- N1: normal app insert is a 14-day server-timed trial
insert into results select 'N1 app-normal trial insert gives ~14 day period',
  (current_period_end - current_period_start) between interval '13 days 23 hours' and interval '14 days 1 hour'
  from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000a1';

-- N2: RPC still creates jobs, enforces 30-cap, as owner and as marketing
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.grant_count(30) as granted into temp table n2;
reset role;
insert into results select 'N2 RPC grants exactly 30 jobs', (select granted from n2)=30;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select reason as r31 into temp table n3 from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb);
reset role;
insert into results select 'N3 31st job rejected AI_USAGE_LIMIT_REACHED', (select r31 from n3)='AI_USAGE_LIMIT_REACHED';

-- N4: app bookkeeping UPDATE (the exact columns services/ai-jobs.ts writes) still works
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
create temp table jid as select id from prompter_ai_jobs order by created_at limit 1;
grant all on jid to public;
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.try($q$update prompter_ai_jobs set status='COMPLETED', provider='openai', model='m', tokens_input=1, tokens_output=2,
  fallback_provider=null, output_reference='{"a":1}', completed_at=now() where id=(select id from jid)$q$) as n4 into temp table n4;
select pg_temp.try($q$update prompter_ai_jobs set status='FAILED', error='x', error_category='UNKNOWN', completed_at=now() where id=(select id from jid)$q$) as n4b into temp table n4b;
reset role;
insert into results select 'N4 bookkeeping UPDATE (status/provider/model/tokens/output/error cols) allowed', (select n4 from n4)='ok' and (select n4b from n4b)='ok';

-- N5: tenant isolation: owner B sees none of A's jobs / subscription
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select (select count(*) from prompter_ai_jobs) as jobs_b, (select count(*) from prompter_subscriptions) as subs_b into temp table n5;
reset role;
insert into results select 'N5 tenant isolation: B sees 0 of A rows', (select jobs_b from n5)=0 and (select subs_b from n5)=0;

-- N6: plan UPDATE by owner still allowed; status UPDATE still denied
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.try($q$update prompter_subscriptions set plan='STARTER' where tenant_id='00000000-0000-0000-0000-0000000000a1'$q$) as n6a into temp table n6a;
select pg_temp.try($q$update prompter_subscriptions set status='ACTIVE' where tenant_id='00000000-0000-0000-0000-0000000000a1'$q$) as n6b into temp table n6b;
reset role;
insert into results select 'N6a owner can still change plan', (select n6a from n6a)='ok';
insert into results select 'N6b owner still cannot set status', (select n6b from n6b)<>'ok';

-- ===== P0-1 attack attempts (as marketing user A, JWT only) =====
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select pg_temp.try($q$delete from prompter_ai_jobs$q$) as del into temp table a1;
select pg_temp.try($q$update prompter_ai_jobs set created_at = now() - interval '400 days'$q$) as bd into temp table a2;
select pg_temp.try($q$insert into prompter_ai_jobs(tenant_id,job_type) values ('00000000-0000-0000-0000-0000000000a1','CONTENT_GENERATION')$q$) as ins into temp table a3;
select pg_temp.try($q$update prompter_ai_jobs set tenant_id='00000000-0000-0000-0000-0000000000b1'$q$) as mv into temp table a4;
select pg_temp.try($q$update prompter_ai_jobs set job_type='SEO_RECOMMENDATIONS'$q$) as jt into temp table a5;
select pg_temp.try($q$truncate prompter_ai_jobs$q$) as tr into temp table a6;
reset role;
select count(*) as remaining into temp table a_rem from prompter_ai_jobs;

\if :phase_after
  insert into results select 'P0-1 DELETE denied', (select del from a1)<>'ok' and (select remaining from a_rem)=30;
  insert into results select 'P0-1 backdating created_at denied', (select bd from a2)<>'ok';
  insert into results select 'P0-1 client INSERT denied', (select ins from a3)<>'ok';
  insert into results select 'P0-1 re-assigning tenant_id denied', (select mv from a4)<>'ok';
  insert into results select 'P0-1 changing job_type denied', (select jt from a5)<>'ok';
  insert into results select 'P0-1 TRUNCATE denied', (select tr from a6)<>'ok';
  set role authenticated;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
  select reason as r into temp table a_q from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb);
  reset role;
  insert into results select 'P0-1 quota still exhausted after the attack (next RPC rejected)', (select r from a_q)='AI_USAGE_LIMIT_REACHED';
\else
  insert into results select 'P0-1 VULNERABLE before: DELETE/backdate succeeded', (select del from a1)='ok' or (select bd from a2)='ok';
\endif

-- ===== P0-2 / P0-2b attack attempts: brand-new tenant B inserts its own row =====
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.try($q$insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end,created_at,success_fee_rate_bps,cancel_at_period_end,provider_subscription_id,billing_country,tax_metadata)
  values ('00000000-0000-0000-0000-0000000000b1','TRIALING','FREE', now()+interval '3000 days', null, now()+interval '3000 days', 0, true, 'x','ID','{"a":1}')$q$) as ins into temp table s1;
reset role;
select current_period_start > now()+interval '1 day' as fut_start, current_period_end is null as null_end,
       created_at > now()+interval '1 day' as fut_created, success_fee_rate_bps, cancel_at_period_end,
       provider_subscription_id, billing_country, tax_metadata,
       (current_period_end - current_period_start) as dur
  into temp table s1row from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000b1';

\if :phase_after
  insert into results select 'P0-2 client insert now yields 14 day period', (select dur from s1row) between interval '13 days 23 hours' and interval '14 days 1 hour';
  insert into results select 'P0-2b future start/created_at neutralised', not (select fut_start from s1row) and not (select fut_created from s1row);
  insert into results select 'P0-2 null current_period_end neutralised', not (select null_end from s1row);
  insert into results select 'P0-2 commercial fields reset', (select success_fee_rate_bps from s1row) is null and not (select cancel_at_period_end from s1row) and (select provider_subscription_id from s1row) is null and (select billing_country from s1row) is null and (select tax_metadata from s1row)='{}'::jsonb;
  -- tenant B (fresh row) can use AI normally: 30-cap holds
  set role authenticated;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select pg_temp.grant_count(31) as g into temp table b30;
  reset role;
  insert into results select 'P0-2b fresh client-inserted trial still capped at 30', (select g from b30)=30;
\else
  insert into results select 'P0-2/2b VULNERABLE before: far-future start + NULL end accepted', (select fut_start from s1row) and (select null_end from s1row);
\endif

-- ===== paths that must NOT be affected =====
-- service_role may insert any period (billing/webhook/admin paths)
set role service_role;
insert into tenants(id,nama_usaha) values ('00000000-0000-0000-0000-0000000000c1','C');
insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end,success_fee_rate_bps,billing_provider)
  values ('00000000-0000-0000-0000-0000000000c1','ACTIVE','STARTER','2030-01-01','2030-02-01',500,'xendit');
reset role;
insert into results select 'SVC service_role insert keeps explicit paid values',
  (select count(*) from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000c1' and status='ACTIVE' and plan='STARTER' and success_fee_rate_bps=500 and current_period_end='2030-02-01')=1;

-- postgres-owner / definer-context insert is not modified (current_user is not anon/authenticated)
insert into tenants(id,nama_usaha) values ('00000000-0000-0000-0000-0000000000d1','D');
insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end)
  values ('00000000-0000-0000-0000-0000000000d1','ACTIVE','STARTER','2031-01-01','2031-02-01');
insert into results select 'OWNER postgres/definer-context insert unchanged',
  (select current_period_end from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000d1')='2031-02-01';

-- scheduled cancellation style UPDATE as service_role / postgres still works
set role service_role;
update prompter_subscriptions set status='CANCELED', cancel_at_period_end=false where tenant_id='00000000-0000-0000-0000-0000000000c1';
reset role;
insert into results select 'SVC service_role UPDATE (cancellation) unaffected',
  (select status from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000c1')='CANCELED';

-- service_role can still delete/update ai jobs (admin cleanup path used by the not-configured fallback)
set role service_role;
create temp table svcdel as select 1;
delete from prompter_ai_jobs where id=(select id from jid);
reset role;
insert into results select 'SVC service_role can still DELETE ai job', not exists (select 1 from prompter_ai_jobs where id=(select id from jid));


-- ===== P0-2c: no way to re-create / extend a trial by DELETE + INSERT, and no cross-tenant TRUNCATE =====
-- Capture tenant A's real trial window, then try to wipe and re-create it as A's owner.
select current_period_start as a_start, current_period_end as a_end into temp table a_trial
  from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.affected($q$delete from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000a1'$q$) as d into temp table r_del;
select pg_temp.affected($q$insert into prompter_subscriptions(tenant_id,status,plan) values ('00000000-0000-0000-0000-0000000000a1','TRIALING','FREE')$q$) as i into temp table r_reins;
reset role;
insert into results select 'P0-2c delete + re-insert cannot reset A''s trial window',
  (select count(*) from prompter_subscriptions s, a_trial t where s.tenant_id='00000000-0000-0000-0000-0000000000a1'
     and s.current_period_start = t.a_start and s.current_period_end = t.a_end)=1;
insert into results select 'P0-2c a second subscription row for the same tenant is refused', (select i from r_reins)<=0;
\if :phase_after
  insert into results select 'P0-2c DELETE is rejected outright (privilege revoked)', (select d from r_del)=-1;
\endif

-- Cross-tenant / wrong-tenant attempts must never touch the other tenant (both phases)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.affected($q$insert into prompter_subscriptions(tenant_id,status,plan) values ('00000000-0000-0000-0000-0000000000c9','TRIALING','FREE')$q$) as x1 into temp table iso1;
select pg_temp.affected($q$update prompter_subscriptions set plan='STARTER' where tenant_id='00000000-0000-0000-0000-0000000000a1'$q$) as x2 into temp table iso2;
select pg_temp.affected($q$update prompter_ai_jobs set status='FAILED' where tenant_id='00000000-0000-0000-0000-0000000000a1'$q$) as x3 into temp table iso3;
reset role;
insert into results select 'ISO owner B cannot insert a subscription for another tenant id', (select x1 from iso1)<=0;
insert into results select 'ISO owner B cannot change tenant A''s plan', (select x2 from iso2)<=0;
insert into results select 'ISO owner B cannot update tenant A''s ai jobs', (select x3 from iso3)<=0;

-- Staff roles (kasir A, marketing B) may not rewrite the quota ledger or subscription of anyone
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select pg_temp.affected($q$update prompter_subscriptions set plan='FREE' where tenant_id='00000000-0000-0000-0000-0000000000a1'$q$) as k1 into temp table st1;
select pg_temp.affected($q$update prompter_ai_jobs set status='FAILED'$q$) as k2 into temp table st2;
select pg_temp.affected($q$delete from prompter_ai_jobs$q$) as k3 into temp table st3;
select pg_temp.affected($q$insert into prompter_ai_jobs(tenant_id,job_type) values ('00000000-0000-0000-0000-0000000000a1','CONTENT_GENERATION')$q$) as k4 into temp table st4;
reset role;
insert into results select 'STAFF kasir cannot update subscription / ai jobs / delete / insert',
  (select k1 from st1)<=0 and (select k2 from st2)<=0 and (select k3 from st3)<=0 and (select k4 from st4)<=0;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select pg_temp.affected($q$delete from prompter_ai_jobs$q$) as m1 into temp table st5;
select pg_temp.affected($q$update prompter_ai_jobs set created_at = now() - interval '90 days'$q$) as m2 into temp table st6;
reset role;
\if :phase_after
  insert into results select 'STAFF marketing B cannot delete or backdate its own ai jobs', (select m1 from st5)<=0 and (select m2 from st6)<=0;
\endif

-- anon (no JWT) has no write path at all
set role anon;
select pg_temp.affected($q$insert into prompter_subscriptions(tenant_id) values ('00000000-0000-0000-0000-0000000000b1')$q$) as n1 into temp table an1;
select pg_temp.affected($q$update prompter_subscriptions set plan='FREE'$q$) as n2 into temp table an2;
select pg_temp.affected($q$delete from prompter_subscriptions$q$) as n3 into temp table an3;
select pg_temp.affected($q$insert into prompter_ai_jobs(tenant_id,job_type) values ('00000000-0000-0000-0000-0000000000a1','X')$q$) as n4 into temp table an4;
select pg_temp.affected($q$delete from prompter_ai_jobs$q$) as n5 into temp table an5;
reset role;
insert into results select 'ANON cannot write subscriptions or ai jobs',
  (select n1 from an1)<=0 and (select n2 from an2)<=0 and (select n3 from an3)<=0 and (select n4 from an4)<=0 and (select n5 from an5)<=0;

-- Legitimate users keep working after the attacks above (bookkeeping UPDATE on own job, own reads)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.affected($q$update prompter_ai_jobs set status='COMPLETED', completed_at=now()
  where id=(select id from prompter_ai_jobs order by created_at limit 1)$q$) as lb into temp table legit_b;
select (select count(*) from prompter_subscriptions) as subs_seen into temp table legit_b2;
reset role;
\if :phase_after
  insert into results select 'LEGIT owner B can still finish its own ai job (bookkeeping UPDATE) after the attacks', (select lb from legit_b)=1;
  insert into results select 'LEGIT owner B still sees exactly its own subscription', (select subs_seen from legit_b2)=1;
\endif

-- Service/backend paths: cascade delete from tenants and service_role deletes still work
set role service_role;
delete from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000c1';
reset role;
insert into results select 'SVC service_role can still DELETE a subscription row (admin path)',
  not exists (select 1 from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000c1');
delete from tenants where id='00000000-0000-0000-0000-0000000000d1';
insert into results select 'SVC ON DELETE CASCADE from tenants still removes subscription rows',
  not exists (select 1 from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000d1');

-- ===== TRUNCATE (ignores RLS: would wipe EVERY tenant's rows). Last, because in the "before" phase it succeeds. =====
select count(*) as subs_before into temp table cnt_subs from prompter_subscriptions;
select count(*) as jobs_before into temp table cnt_jobs from prompter_ai_jobs;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.try($q$truncate prompter_subscriptions$q$) as ts into temp table tr_s;
reset role;
set role anon;
select pg_temp.try($q$truncate prompter_subscriptions$q$) as ts into temp table tr_sa;
select pg_temp.try($q$truncate prompter_ai_jobs$q$) as tj into temp table tr_ja;
reset role;
\if :phase_after
  insert into results select 'P0-2c TRUNCATE of prompter_subscriptions denied for authenticated and anon; all rows intact',
    (select ts from tr_s)<>'ok' and (select ts from tr_sa)<>'ok' and (select count(*) from prompter_subscriptions)=(select subs_before from cnt_subs);
  insert into results select 'P0-1 anon TRUNCATE of prompter_ai_jobs denied; all rows intact',
    (select tj from tr_ja)<>'ok' and (select count(*) from prompter_ai_jobs)=(select jobs_before from cnt_jobs);
\else
  insert into results select 'P0-2c VULNERABLE before: authenticated TRUNCATE of subscriptions wipes every tenant',
    (select ts from tr_s)='ok' and (select count(*) from prompter_subscriptions)=0;
\endif

select name, case when ok then 'PASS' else 'FAIL' end as result from results order by name;
select case when bool_and(coalesce(ok,false)) then 'ALL PASS' else 'FAILURES PRESENT' end as summary from results;
-- make the script's exit status reflect the result (psql ON_ERROR_STOP -> non-zero)
do $$ begin
  if exists (select 1 from results where not coalesce(ok,false)) then
    raise exception 'P0 trial security: FAILURES PRESENT';
  end if;
end $$;
