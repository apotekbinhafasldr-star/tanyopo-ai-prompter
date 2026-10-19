-- Rollback proof for 20261019110000: tables/functions gone, PR #31 trigger restored, P0 fixes intact.
\set ON_ERROR_STOP on
create temp table results(name text, ok boolean);
insert into tenants(id,nama_usaha) values ('00000000-0000-0000-0000-0000000000f9','R');
insert into user_profiles values ('00000000-0000-0000-0000-0000000000f9','00000000-0000-0000-0000-0000000000f9','r','owner');
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, false); end $$;
grant execute on function pg_temp.as_user(text) to public;
-- hold something first so the rollback runs on realistic data
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f9');
\ir ../rollback/20261019110000_prompter_trial_abuse_protection.down.sql
insert into results select 'RB1 anti-abuse tables and functions are gone',
  not exists (select 1 from pg_class where relname in ('prompter_trial_signup_attempts','prompter_trial_rate_buckets'))
  and not exists (select 1 from pg_proc where proname like 'fn\_trial\_%');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f9');
insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end)
  values ('00000000-0000-0000-0000-0000000000f9','TRIALING','FREE',now(),now()+interval '99 days');
reset role;
insert into results select 'RB2 PR #31 trigger restored: client trial is clamped to 14 days',
  (select current_period_end - current_period_start < interval '14 days 1 hour' from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000f9');
create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.try(text) to public;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f9');
select pg_temp.try($q$truncate prompter_plan_entitlements$q$) as t1, pg_temp.try($q$truncate prompter_subscriptions$q$) as t2,
       pg_temp.try($q$truncate prompter_ai_jobs$q$) as t3 into temp table chk;
reset role;
insert into results select 'RB3 earlier P0 fixes untouched by the anti-abuse rollback (TRUNCATE still denied)',
  (select t1<>'ok' and t2<>'ok' and t3<>'ok' from chk);
select name, case when ok then 'PASS' else 'FAIL' end as result from results order by name;
do $$ begin if exists (select 1 from results where not ok) then raise exception 'abuse rollback: FAILURES PRESENT'; end if; end $$;
