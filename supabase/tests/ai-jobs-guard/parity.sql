-- Billing-behaviour parity: for OWNER callers the guarded RPC must return exactly what the live B10 body returns
-- (reason, allowed, used_count, allowance) in every subscription state. Run BEFORE and AFTER the guard; the outputs
-- (lines starting with PARITY) must be identical. Everything happens inside a transaction that is rolled back.
-- Synthetic data only. This is the proof that the guard does not remove trial / entitlement / billing behaviour.
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
begin;
create function pg_temp.mk(p_n int, p_status text, p_plan text, p_start interval, p_end interval, p_jobs int, p_jobs_age interval default interval '0')
returns text language plpgsql as $$
declare t uuid := ('f000000' || p_n || '-0000-4000-8000-00000000000' || p_n)::uuid;
        u uuid := ('f100000' || p_n || '-0000-4000-8000-00000000001' || p_n)::uuid;
begin
  insert into public.tenants(id,nama_usaha) values (t,'Parity '||p_n);
  insert into auth.users(id,email) values (u,'parity'||p_n||'@example.invalid');
  insert into public.user_profiles(id,tenant_id,nama,role) values (u,t,'Owner '||p_n,'owner');
  insert into public.prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end)
    values (t,p_status,p_plan,now()+p_start,now()+p_end);
  insert into public.prompter_ai_jobs(tenant_id,job_type,status,created_at)
    select t,'CONTENT_GENERATION','COMPLETED',now()+p_jobs_age from generate_series(1,p_jobs);
  return u::text;
end $$;
create function pg_temp.call(p_u text, p_n int) returns text language plpgsql as $$
declare r text := ''; x record; i int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_u,'role','authenticated')::text, true);
  set local role authenticated;
  for i in 1..p_n loop
    select * into x from public.fn_create_ai_job_if_entitled('CONTENT_GENERATION','{"k":1}'::jsonb);
    r := r || coalesce(x.reason,'OK') || '/' || x.allowed || '/' || x.used_count || '/' || x.allowance || ' ';
  end loop;
  reset role;
  return r;
end $$;
select 'PARITY trial fresh (3 calls)          ' || pg_temp.call(pg_temp.mk(1,'TRIALING','FREE','-1 day','13 days',0),3);
select 'PARITY trial at limit 29/30 (3 calls) ' || pg_temp.call(pg_temp.mk(2,'TRIALING','FREE','-1 day','13 days',29),3);
select 'PARITY trial expired                  ' || pg_temp.call(pg_temp.mk(3,'TRIALING','FREE','-20 days','-1 day',0),1);
select 'PARITY trial with plan=GROWTH (FREE nr)' || pg_temp.call(pg_temp.mk(4,'TRIALING','GROWTH','-1 day','13 days',29),2);
select 'PARITY active STARTER near limit      ' || pg_temp.call(pg_temp.mk(5,'ACTIVE','STARTER','-5 days','25 days',149),3);
select 'PARITY active GROWTH fresh            ' || pg_temp.call(pg_temp.mk(6,'ACTIVE','GROWTH','-5 days','25 days',0),2);
select 'PARITY past_due                       ' || pg_temp.call(pg_temp.mk(7,'PAST_DUE','STARTER','-5 days','25 days',0),1);
select 'PARITY canceled                       ' || pg_temp.call(pg_temp.mk(8,'CANCELED','STARTER','-5 days','25 days',0),1);
-- trial carry-over shape: ACTIVE right after a trial, period_start earlier than month start, old jobs from the trial
select 'PARITY active after trial carryover   ' || pg_temp.call(pg_temp.mk(9,'ACTIVE','STARTER','-40 days','20 days',40,interval '-35 days'),2);
rollback;
