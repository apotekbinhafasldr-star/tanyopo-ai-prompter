-- LOCAL-ONLY: S1 + PR #48 guard integration (role check, release path, retry accounting, tenant isolation).
-- Run after support/prod_snapshot.sql + the S1 migrations + the PR #48 migrations (any order that keeps the guard).
-- Variables: none. Raises on the first failure; prints PASS lines.
\set ON_ERROR_STOP on
create temp table results(name text, ok boolean);
grant all on results to public;
insert into tenants(id,nama_usaha) values ('00000000-0000-0000-0000-0000000000a1','A'),('00000000-0000-0000-0000-0000000000b1','B');
insert into user_profiles values
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','owner A','owner'),
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','mkt A','marketing'),
  ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a1','kasir A','kasir'),
  ('00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000a1','apoteker A','apoteker'),
  ('00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-0000000000a1','gudang A','admin_gudang'),
  ('00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000a1','hr A','hr'),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b1','owner B','owner');
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, false); end $$;
create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlstate||':'||sqlerrm; end $$;
create or replace function pg_temp.rpc(t text default 'CONTENT_GENERATION') returns table(job_id uuid, allowed boolean, reason text, used_count int, allowance int)
language plpgsql as $$ begin return query select * from fn_create_ai_job_if_entitled(t,'{}'::jsonb); end $$;
grant execute on function pg_temp.as_user(text), pg_temp.try(text), pg_temp.rpc(text) to public;

-- trials through the app-normal path (server-timed by the S1 trigger)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into prompter_subscriptions(tenant_id,status,plan) values ('00000000-0000-0000-0000-0000000000a1','TRIALING','FREE');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
insert into prompter_subscriptions(tenant_id,status,plan) values ('00000000-0000-0000-0000-0000000000b1','TRIALING','FREE');
reset role;
insert into results select 'I0 trial is 14 days from the server clock',
  (select count(*) from prompter_subscriptions where current_period_end - current_period_start between interval '13 days 23 hours' and interval '14 days 1 hour')=2;

-- role policy of PR #48 survives S1 (S1 never redefines the RPC)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select reason as r into temp table i1 from pg_temp.rpc();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select allowed as o, job_id as oid into temp table i2 from pg_temp.rpc();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select allowed as m into temp table i3 from pg_temp.rpc();
reset role;
insert into results select 'I1 kasir -> ROLE_NOT_ALLOWED, owner and marketing allowed (PR #48 guard intact next to S1)',
  (select r from i1)='ROLE_NOT_ALLOWED' and (select o from i2) and (select m from i3);

-- LINOE interim role policy: owner + marketing allowed, EVERY other user_profiles role refused with ROLE_NOT_ALLOWED
-- and nothing is created or counted for them (the other roles belong to the sibling products sharing the project).
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select reason as r into temp table i1b_apoteker from pg_temp.rpc();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
select reason as r into temp table i1b_gudang from pg_temp.rpc();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select reason as r into temp table i1b_hr from pg_temp.rpc();
reset role;
insert into results select 'I1b apoteker / admin_gudang / hr -> ROLE_NOT_ALLOWED too (every role except owner+marketing)',
  (select r from i1b_apoteker)='ROLE_NOT_ALLOWED' and (select r from i1b_gudang)='ROLE_NOT_ALLOWED' and (select r from i1b_hr)='ROLE_NOT_ALLOWED';
insert into results select 'I1c refused roles consume no quota: no job row has an actor outside owner/marketing',
  (select count(*) from prompter_ai_jobs where actor_user_id in ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-0000000000a7'))=0;

-- client can neither delete nor backdate (privilege layer of S1 + trigger layer of #48)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.try($q$delete from prompter_ai_jobs$q$) as d into temp table i4a;
select pg_temp.try($q$update prompter_ai_jobs set created_at=now()-interval '400 days'$q$) as b into temp table i4b;
select pg_temp.try($q$truncate prompter_ai_jobs$q$) as t into temp table i4c;
reset role;
insert into results select 'I2 client DELETE / backdate / TRUNCATE all refused with 42501',
  (select d from i4a) like '42501%' and (select b from i4b) like '42501%' and (select t from i4c) like '42501%';
insert into results select 'I2b both layers exist: ai_jobs column UPDATE grants (S1) and guard triggers (#48)',
  not has_table_privilege('authenticated','public.prompter_ai_jobs','DELETE')
  and (select count(*) from pg_trigger where tgrelid='public.prompter_ai_jobs'::regclass and tgname in ('trg_prompter_ai_jobs_immutable','trg_prompter_ai_jobs_no_truncate','trg_prompter_ai_jobs_no_delete'))=3;

-- bookkeeping completion still works for the legitimate owner
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.try(format($q$update prompter_ai_jobs set status='COMPLETED', provider='p', model='m', tokens_input=1, tokens_output=1, completed_at=now() where id=%L$q$, (select oid from i2))) as c into temp table i5;
reset role;
insert into results select 'I3 owner completes its own job (bookkeeping columns only)', (select c from i5)='ok';

-- retry accounting: a FAILED job still counts; a new attempt consumes a NEW unit; release by service_role returns exactly that unit
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select job_id as jf, used_count as u1 into temp table i6 from pg_temp.rpc();
select pg_temp.try(format($q$update prompter_ai_jobs set status='FAILED', error='x', error_category='UNKNOWN', completed_at=now() where id=%L$q$, (select jf from i6))) as f into temp table i6f;
select job_id as jr, used_count as u2 into temp table i7 from pg_temp.rpc();
grant all on i7 to public;
reset role;
insert into results select 'I4 failed job still counts and a retry consumes a new unit (no silent refund, no double count)',
  (select f from i6f)='ok' and (select u2 from i7) = (select u1 from i6)+1;
set role service_role;
select pg_temp.try(format($q$delete from prompter_ai_jobs where id=%L and tenant_id='00000000-0000-0000-0000-0000000000a1' and status='PROCESSING'$q$, (select jr from i7))) as rel into temp table i8;
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select used_count as u3 into temp table i9 from pg_temp.rpc();
reset role;
insert into results select 'I5 server-side release (service_role, tenant+id+PROCESSING) returns the unit; next call reuses the slot',
  (select rel from i8)='ok' and (select u3 from i9) = (select u2 from i7);
-- the release filter must not touch another tenant's PROCESSING job
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select job_id as jx into temp table i10a from pg_temp.rpc();
select jx::text as jxid from i10a \gset
reset role;
set role service_role;
delete from prompter_ai_jobs where id=:'jxid' and tenant_id='00000000-0000-0000-0000-0000000000b1' and status='PROCESSING';
reset role;
insert into results select 'I6 release scoped to the wrong tenant deletes nothing', (select count(*) from prompter_ai_jobs where id=(select jx from i10a))=1;

-- tenant isolation: B's quota is independent from A's
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select used_count as ub into temp table i11 from pg_temp.rpc();
select count(*) as seen into temp table i12 from prompter_ai_jobs;
reset role;
insert into results select 'I7 tenant B starts at 1 and sees only its own rows', (select ub from i11)=1 and (select seen from i12)=1;

select name, case when ok then 'PASS' else 'FAIL' end result from results order by name;
do $$ begin if exists (select 1 from results where not coalesce(ok,false)) then raise exception 'S1 integration: FAILURES PRESENT'; end if; end $$;
