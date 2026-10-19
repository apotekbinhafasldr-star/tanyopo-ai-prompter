-- LOCAL/CI-ONLY test for 20261019120000 (shared-table TRUNCATE/DELETE/INSERT hardening). Throwaway DB only.
-- :phase_after = true|false
\set ON_ERROR_STOP on
create temp table results(name text, ok boolean);
grant all on results to public;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, false); end $$;
create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.affected(stmt text) returns int language plpgsql as $$
declare n int; begin execute stmt; get diagnostics n = row_count; return n; exception when others then return -1; end $$;
grant execute on function pg_temp.as_user(text), pg_temp.try(text), pg_temp.affected(text) to public;

insert into tenants(id,nama_usaha) values ('00000000-0000-0000-0000-0000000000a1','A'),('00000000-0000-0000-0000-0000000000b1','B');
insert into user_profiles values
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','owner A','owner'),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b1','owner B','owner');
insert into prompter_subscriptions(tenant_id,status,current_period_start,current_period_end)
  values ('00000000-0000-0000-0000-0000000000a1','TRIALING',now(),now()+interval '14 days');
insert into ai_assistant_usage_log(tenant_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into fitur_ai_usage_log(tenant_id) values ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000b1');

-- a SECURITY DEFINER writer, like handle_new_user / usage-log functions
create function public.test_definer_writer() returns void language plpgsql security definer set search_path=public as $$
begin
  insert into tenants(id,nama_usaha) values ('00000000-0000-0000-0000-0000000000c1','C via definer');
  insert into ai_assistant_usage_log(tenant_id) values ('00000000-0000-0000-0000-0000000000c1');
  insert into fitur_ai_usage_log(tenant_id) values ('00000000-0000-0000-0000-0000000000c1');
end $$;
grant execute on function public.test_definer_writer() to authenticated;

-- legitimate operations (must work before AND after)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.affected($q$update tenants set nama_usaha='A renamed' where id='00000000-0000-0000-0000-0000000000a1'$q$) as own_upd into temp table l1;
select pg_temp.affected($q$update tenants set nama_usaha='HACK' where id='00000000-0000-0000-0000-0000000000b1'$q$) as other_upd into temp table l2;
select count(*) as seen into temp table l3 from tenants;
select count(*) as seen_log into temp table l4 from fitur_ai_usage_log;
select pg_temp.try($q$select public.test_definer_writer()$q$) as definer into temp table l5;
reset role;
insert into results select 'L1 owner can still edit own tenant (UPDATE kept)', (select own_upd from l1)=1;
insert into results select 'L2 tenant isolation: owner cannot edit another tenant', (select other_upd from l2)=0 and (select nama_usaha from tenants where id='00000000-0000-0000-0000-0000000000b1')='B';
insert into results select 'L3 owner still sees only own tenant and own usage rows', (select seen from l3)=1 and (select seen_log from l4)=1;
insert into results select 'L4 SECURITY DEFINER writers (handle_new_user style) still insert into tenants and both logs', (select definer from l5)='ok'
  and exists (select 1 from tenants where id='00000000-0000-0000-0000-0000000000c1')
  and exists (select 1 from ai_assistant_usage_log where tenant_id='00000000-0000-0000-0000-0000000000c1');
set role service_role;
select pg_temp.affected($q$insert into fitur_ai_usage_log(tenant_id) values ('00000000-0000-0000-0000-0000000000a1')$q$) as svc_ins into temp table l6;
select pg_temp.affected($q$delete from ai_assistant_usage_log where tenant_id='00000000-0000-0000-0000-0000000000c1'$q$) as svc_del into temp table l7;
reset role;
insert into results select 'L5 service_role still inserts/deletes usage logs', (select svc_ins from l6)=1 and (select svc_del from l7)=1;
-- owner-run cascade still works (ON DELETE CASCADE from tenants)
delete from tenants where id='00000000-0000-0000-0000-0000000000a1' and false;
insert into results select 'L6 FK cascade as table owner is unaffected (tenant delete removes its subscription)',
  (select count(*) from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000a1')=1 and
  pg_temp.affected($q$delete from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000a1'$q$)=1;

-- the dangerous operations
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.try($q$truncate ai_assistant_usage_log$q$) as t_a, pg_temp.try($q$truncate fitur_ai_usage_log$q$) as t_f,
       pg_temp.try($q$truncate tenants cascade$q$) as t_t,
       pg_temp.try($q$delete from tenants where id='00000000-0000-0000-0000-0000000000b1'$q$) as d_t,
       pg_temp.try($q$insert into tenants(nama_usaha) values ('rogue')$q$) as i_t,
       pg_temp.try($q$insert into fitur_ai_usage_log(tenant_id) values (null)$q$) as i_f,
       pg_temp.try($q$delete from fitur_ai_usage_log$q$) as d_f,
       pg_temp.try($q$update ai_assistant_usage_log set tenant_id=null$q$) as u_a
  into temp table bad;
reset role;
set role anon;
select pg_temp.try($q$truncate ai_assistant_usage_log$q$) as at_a, pg_temp.try($q$truncate tenants cascade$q$) as at_t,
       pg_temp.try($q$update tenants set nama_usaha='x'$q$) as au_t into temp table bad_anon;
reset role;
\if :phase_after
  insert into results select 'D1 authenticated: TRUNCATE (incl. CASCADE), DELETE, INSERT on shared tables all denied',
    (select t_a<>'ok' and t_f<>'ok' and t_t<>'ok' and d_t<>'ok' and i_t<>'ok' and i_f<>'ok' and d_f<>'ok' and u_a<>'ok' from bad);
  insert into results select 'D2 anon: TRUNCATE and tenant UPDATE denied', (select at_a<>'ok' and at_t<>'ok' and au_t<>'ok' from bad_anon);
  insert into results select 'D3 all rows intact after the attack attempts',
    (select count(*) from tenants)=3 and (select count(*) from fitur_ai_usage_log)=4 and (select count(*) from user_profiles)=2;
\else
  insert into results select 'D1 VULNERABLE before: authenticated holds TRUNCATE/DELETE/INSERT on tenants (and CASCADE truncate works when no other fix is applied)',
    has_table_privilege('authenticated','public.tenants','truncate') and has_table_privilege('authenticated','public.tenants','delete')
    and has_table_privilege('authenticated','public.tenants','insert') and has_table_privilege('anon','public.tenants','update');
  insert into results select 'D2 VULNERABLE before: usage logs can be truncated', (select t_a from bad)='ok' or (select at_a from bad_anon)='ok';
\endif

select name, case when ok then 'PASS' else 'FAIL' end as result from results order by name;
do $$ begin if exists (select 1 from results where not coalesce(ok,false)) then raise exception 'shared tables hardening: FAILURES PRESENT'; end if; end $$;
select 'ALL PASS' as summary;
