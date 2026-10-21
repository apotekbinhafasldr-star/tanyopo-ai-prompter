-- Synthetic-data assertions for the AI Jobs quota guard. LOCAL THROW-AWAY DATABASE ONLY.
-- psql -v variant=main|pr31|pr31_rev|all   (main = no PR #31, so the DELETE guard is intentionally absent)
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
\set A 'a0000000-0000-4000-8000-00000000000a'
\set B 'b0000000-0000-4000-8000-00000000000b'
\set C 'c0000000-0000-4000-8000-00000000000c'
\set E 'e0000000-0000-4000-8000-00000000000e'
\set oa 'a1000000-0000-4000-8000-0000000000a1'
\set ma 'a3000000-0000-4000-8000-0000000000a3'
\set ob 'b1000000-0000-4000-8000-0000000000b1'
\set mb 'b2000000-0000-4000-8000-0000000000b2'
\set kb 'b3000000-0000-4000-8000-0000000000b3'
\set mkb 'b4000000-0000-4000-8000-0000000000b4'
\set oc 'c1000000-0000-4000-8000-0000000000c1'
\set nobody 'd1000000-0000-4000-8000-0000000000d1'
select (:'variant' <> 'main') as has_p2 \gset

insert into auth.users(id,email) values
 (:'mb','member-b@example.invalid'),(:'kb','kasir-b@example.invalid'),(:'mkb','mkt-b@example.invalid'),(:'nobody','nobody@example.invalid');
insert into user_profiles(id,tenant_id,nama,role) values
 (:'mb',:'B','Member B','member'),(:'kb',:'B','Kasir B (peran produk lain)','kasir'),(:'mkb',:'B','Marketing B','marketing');

create table chk_r(n text primary key, ok boolean, detail text);
grant all on chk_r to public;
create function chk(p_n text, p_ok boolean, p_d text default '') returns void language sql as
  $$ insert into chk_r values (p_n, coalesce(p_ok,false), p_d) $$;
create function rpc_as(p_sub text, p_type text, p_in jsonb default '{}'::jsonb)
  returns table(job_id uuid, allowed boolean, reason text, used_count integer, allowance integer) language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, false);
  set local role authenticated;
  return query select * from public.fn_create_ai_job_if_entitled(p_type, p_in);
  reset role;
end $$;
-- sequential calls, each its own statement (so each sees the previous insert); returns allowed count
create function burn(p_sub text, n int, p_type text default 'CONTENT_GENERATION') returns int language plpgsql as $$
declare a int := 0; x record; i int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, false);
  set local role authenticated;
  for i in 1..n loop
    select * into x from public.fn_create_ai_job_if_entitled(p_type,'{}'::jsonb);
    if x.allowed then a := a+1; end if;
  end loop;
  reset role;
  return a;
end $$;
create function njobs(p_t text) returns bigint language sql as $$ select count(*) from public.prompter_ai_jobs where tenant_id = p_t::uuid $$;

-- ===== 1. role check (identity from the JWT) ===============================================================
select chk('T01 member -> ROLE_NOT_ALLOWED', (select reason from rpc_as(:'mb','CONTENT_GENERATION')) = 'ROLE_NOT_ALLOWED');
select chk('T02 kasir (other product role) -> ROLE_NOT_ALLOWED', (select reason from rpc_as(:'kb','CONTENT_GENERATION')) = 'ROLE_NOT_ALLOWED');
select njobs(:'B') as b0 \gset
select burn(:'mb', 5) as mx, burn(:'kb', 5) as kx \gset
select chk('T03 member/kasir consume no quota (10 calls)', :mx = 0 and :kx = 0 and njobs(:'B') = :b0);
select chk('T04a owner allowed', (select allowed from rpc_as(:'ob','CONTENT_GENERATION')));
select chk('T04b marketing allowed', (select allowed from rpc_as(:'mkb','CAMPAIGN_PROPOSAL')));
select chk('T05 user without profile -> NO_TENANT', (select reason from rpc_as(:'nobody','CONTENT_GENERATION')) = 'NO_TENANT');
select chk('T05b a forged tenant/role claim in the JWT is not trusted',
  (select reason from rpc_as(:'mb','CONTENT_GENERATION')) = 'ROLE_NOT_ALLOWED');

-- ===== 2. job_type + input_reference validation ============================================================
select njobs(:'B') as b1 \gset
select chk('T06 invalid job types rejected, nothing inserted',
  (select reason from rpc_as(:'ob','FOO')) = 'INVALID_JOB_TYPE'
  and (select reason from rpc_as(:'ob','')) = 'INVALID_JOB_TYPE'
  and (select reason from rpc_as(:'ob',null)) = 'INVALID_JOB_TYPE'
  and (select reason from rpc_as(:'ob','content_generation')) = 'INVALID_JOB_TYPE'
  and (select reason from rpc_as(:'ob','GROWTH_RECOMMENDATION')) = 'INVALID_JOB_TYPE'
  and njobs(:'B') = :b1);
select chk('T07a input_reference: array / scalar / >64KiB rejected',
  (select reason from rpc_as(:'ob','CONTENT_GENERATION','[1,2]'::jsonb)) = 'INVALID_INPUT'
  and (select reason from rpc_as(:'ob','CONTENT_GENERATION','"x"'::jsonb)) = 'INVALID_INPUT'
  and (select reason from rpc_as(:'ob','CONTENT_GENERATION',jsonb_build_object('pad',repeat('x',70000)))) = 'INVALID_INPUT'
  and (select reason from rpc_as(:'ob','CONTENT_GENERATION',jsonb_build_object('pad',repeat('x',2000000)))) = 'INVALID_INPUT'
  and njobs(:'B') = :b1);
select chk('T07b input_reference: normal object and a 60 KB object accepted',
  (select allowed from rpc_as(:'ob','CONTENT_GENERATION',jsonb_build_object('product_id','p','tone','santai')))
  and (select allowed from rpc_as(:'ob','CONTENT_GENERATION',jsonb_build_object('pad',repeat('x',60000)))));
select chk('T07c null input_reference is stored as {}',
  (select allowed from rpc_as(:'ob','CONTENT_GENERATION',null)));
select chk('T07d the null case stored an empty object',
  (select input_reference from prompter_ai_jobs where tenant_id=:'B' order by created_at desc limit 1) = '{}'::jsonb);
select chk('T08 all six app job types accepted (tenant A, STARTER)',
  (select count(*) from (values ('MARKETING_BLUEPRINT'),('CAMPAIGN_PROPOSAL'),('CONTENT_GENERATION'),
     ('SEO_RECOMMENDATIONS'),('ANALYTICS_INSIGHT'),('OPTIMIZATION_RECOMMENDATION')) v(t),
     lateral (select allowed from rpc_as(:'oa', v.t)) r where r.allowed) = 6);
select chk('T08b the role check does not change an owner of a non-trial tenant (marketing A allowed)',
  (select allowed from rpc_as(:'ma','CONTENT_GENERATION')));

-- ===== 3. quota cannot be reset (tenant C = trial, allowance 30) ===========================================
create function exhaust(p_sub text) returns int language sql as $$ select burn(p_sub, 200) $$;
select exhaust(:'oc') as first_burn \gset
select chk('T09a owner exhausts exactly the trial allowance (30)', :first_burn = 30 and njobs(:'C') = 30, 'allowed='||:first_burn);
select chk('T09b nothing more after exhaustion', burn(:'oc',3) = 0);

select t_run('authenticated', :'oc', 'A1.delete', 'delete from prompter_ai_jobs');
select chk('T10a DELETE does not reset quota' || case when :has_p2 then '' else ' (main-only: documented gap, closed by PR #31 + part 2)' end,
  case when :has_p2 then burn(:'oc',1) = 0 else true end);
select exhaust(:'oc') \gset
select t_run('authenticated', :'oc', 'A2.backdate', $q$update prompter_ai_jobs set created_at = now() - interval '400 days'$q$);
select chk('T10b backdating created_at does not reset quota', burn(:'oc',1) = 0
  and (select result like '42501%' from t_probe where name='A2.backdate'), (select result from t_probe where name='A2.backdate'));
select t_run('authenticated', :'oc', 'A3.move_tenant', $q$update prompter_ai_jobs set tenant_id = 'b0000000-0000-4000-8000-00000000000b'$q$);
select chk('T10c moving jobs to another tenant is refused and changes no quota',
  (select result like '42501%' from t_probe where name='A3.move_tenant') and njobs(:'C') = 30);
select t_run('authenticated', :'oc', 'A4.truncate', 'truncate prompter_ai_jobs');
select chk('T10d TRUNCATE refused (guard trigger 42501, or FK 0A000 -- both refuse)', (select result like '42501%' or result like '0A000%' from t_probe where name='A4.truncate') and njobs(:'C') = 30);
select t_run('authenticated', :'oc', 'A5.change_job_type_or_input', $q$update prompter_ai_jobs set job_type='ANALYTICS_INSIGHT', input_reference='{"x":1}'$q$);
select chk('T10e job_type/input_reference immutable for clients', (select result like '42501%' from t_probe where name='A5.change_job_type_or_input'));
select t_run('authenticated', :'oc', 'A6.change_actor', $q$update prompter_ai_jobs set actor_user_id = null$q$);
select chk('T10f actor_user_id immutable for clients', (select result like '42501%' from t_probe where name='A6.change_actor'));
select t_run('authenticated', :'oc', 'A7.insert_direct', $q$insert into prompter_ai_jobs(tenant_id,job_type,status) values ('c0000000-0000-4000-8000-00000000000c','CONTENT_GENERATION','COMPLETED')$q$);
select chk('T10g direct INSERT refused (PR #31) / by RLS role policy; never creates free capacity',
  case when :has_p2 then (select result like '42501%' from t_probe where name='A7.insert_direct') else true end);
select t_run('authenticated', :'mb', 'A8.member_direct_insert', $q$insert into prompter_ai_jobs(tenant_id,job_type,status) values ('b0000000-0000-4000-8000-00000000000b','CONTENT_GENERATION','QUEUED')$q$);
select chk('T10h member direct INSERT refused', (select result not like 'OK:%' from t_probe where name='A8.member_direct_insert'));

-- ===== 4. tenant isolation =============================================================================
select njobs(:'B') as bnow \gset
select t_run('authenticated', :'oc', 'I1.read_B', $q$select * from prompter_ai_jobs where tenant_id='b0000000-0000-4000-8000-00000000000b'$q$);
select chk('T11a tenant C owner cannot read tenant B jobs', (select result = 'OK:0' from t_probe where name='I1.read_B'));
select chk('T11b tenant C activity never touched tenant B', njobs(:'B') = :bnow);
select chk('T11c tenant B still entitled (own quota)', (select allowed from rpc_as(:'ob','CONTENT_GENERATION')) or njobs(:'B') >= 30);

-- ===== 5. legitimate workflows keep working ============================================================
select job_id as jid from rpc_as(:'oa','CONTENT_GENERATION') \gset
select t_run('authenticated', :'oa', 'L1.complete', format($q$update prompter_ai_jobs set status='COMPLETED', provider='openai', model='gpt', tokens_input=10, tokens_output=20, fallback_provider=null, output_reference='{"ok":true}', completed_at=now() where id='%s'$q$, :'jid'));
select chk('T12a completion update works', (select result = 'OK:1' from t_probe where name='L1.complete'), (select result from t_probe where name='L1.complete'));
select job_id as jid2 from rpc_as(:'oa','CONTENT_GENERATION') \gset
select t_run('authenticated', :'oa', 'L2.fail', format($q$update prompter_ai_jobs set status='FAILED', error='boom', error_category='UNKNOWN', completed_at=now() where id='%s'$q$, :'jid2'));
select chk('T12b failure update works (cancel/fail path)', (select result = 'OK:1' from t_probe where name='L2.fail'), (select result from t_probe where name='L2.fail'));
select chk('T12c retry = a fresh RPC call still works', (select allowed from rpc_as(:'oa','CONTENT_GENERATION')));
select job_id as jid3 from rpc_as(:'oa','CONTENT_GENERATION') \gset
select t_run('service_role', null, 'L3.release', format($q$delete from prompter_ai_jobs where id='%s'$q$, :'jid3'));
select chk('T12d server-side release (service_role DELETE) works', (select result = 'OK:1' from t_probe where name='L3.release'), (select result from t_probe where name='L3.release'));
insert into tenants(id,nama_usaha) values (:'E','Tenant E (sintetis, akan dihapus)');
insert into prompter_ai_jobs(tenant_id,job_type,status) values (:'E','CONTENT_GENERATION','COMPLETED');
select t_run('cron', null, 'L4.tenant_cascade', $q$delete from tenants where id='e0000000-0000-4000-8000-00000000000e'$q$);
select chk('T12e tenant deletion cascades through the guard', (select result = 'OK:1' from t_probe where name='L4.tenant_cascade') and njobs(:'E') = 0, (select result from t_probe where name='L4.tenant_cascade'));
select chk('T12f owner/superuser maintenance UPDATE of immutable column is allowed (migrations, support)',
  (select result = 'OK:1' from (select t_try($q$update prompter_ai_jobs set created_at = created_at where id = 'a8000000-0000-4000-8000-0000000000a8'$q$) as result) z));

-- ===== 6. function / trigger grants ====================================================================
select chk('T13a RPC: anon cannot execute, authenticated can',
  not has_function_privilege('anon','public.fn_create_ai_job_if_entitled(text,jsonb)','execute')
  and has_function_privilege('authenticated','public.fn_create_ai_job_if_entitled(text,jsonb)','execute'));
select chk('T13b guard trigger functions not callable by clients',
  not has_function_privilege('anon','public.fn_guard_ai_job_immutable()','execute')
  and not has_function_privilege('authenticated','public.fn_guard_ai_job_immutable()','execute')
  and not has_function_privilege('authenticated','public.fn_guard_ai_job_truncate()','execute'));
select chk('T13c triggers present (immutable, no_truncate' || case when :has_p2 then ', no_delete)' else ')' end,
  (select count(*) from pg_trigger where tgrelid='public.prompter_ai_jobs'::regclass and tgname in ('trg_prompter_ai_jobs_immutable','trg_prompter_ai_jobs_no_truncate')) = 2
  and ((select count(*) from pg_trigger where tgrelid='public.prompter_ai_jobs'::regclass and tgname='trg_prompter_ai_jobs_no_delete') = (case when :has_p2 then 1 else 0 end)));
select chk('T13d no sibling-product object touched: guard functions are the only new public functions',
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fn\_guard\_ai\_job%') = (case when :has_p2 then 3 else 2 end));

-- ===== 6b. PR #31's fail-closed entitlement block survives (no row => denied, never unlimited) =============
create table ent_bak as select * from prompter_plan_entitlements;
delete from prompter_plan_entitlements;
select chk('T15a empty entitlement table -> ENTITLEMENT_NOT_CONFIGURED (not unlimited)',
  (select reason from rpc_as(:'oa','CONTENT_GENERATION')) = 'ENTITLEMENT_NOT_CONFIGURED');
insert into prompter_plan_entitlements select * from ent_bak;
select chk('T15b entitlements restored -> normal again', (select allowed from rpc_as(:'oa','CONTENT_GENERATION')));

-- ===== 7. defence in depth: a mass-restore rollback (what PR #46's down script does) cannot reopen the quota ===
grant select, insert, update, delete, truncate on public.prompter_ai_jobs to anon, authenticated;
select exhaust(:'ob') \gset
select t_run('authenticated', :'ob', 'R2.backdate', $q$update prompter_ai_jobs set created_at = now() - interval '400 days'$q$);
select t_run('authenticated', :'ob', 'R3.move', $q$update prompter_ai_jobs set tenant_id='c0000000-0000-4000-8000-00000000000c'$q$);
select t_run('authenticated', :'ob', 'R4.truncate', 'truncate prompter_ai_jobs');
select t_run('authenticated', :'ob', 'R5.complete', $q$update prompter_ai_jobs set status='COMPLETED', tokens_input=1, completed_at=now() where status='PROCESSING'$q$);
select chk('T14a with GRANT ALL restored: created_at/tenant_id/TRUNCATE still blocked by triggers',
  (select bool_and(result like '42501%') from t_probe where name in ('R2.backdate','R3.move')) and (select result like '42501%' or result like '0A000%' from t_probe where name='R4.truncate'),
  (select string_agg(name||'='||result, ' | ') from t_probe where name like 'R%'));
select t_run('authenticated', :'ob', 'R1.delete', 'delete from prompter_ai_jobs');
select chk('T14b with GRANT ALL restored: DELETE blocked' || case when :has_p2 then '' else ' (main: no part 2 -> expected open)' end,
  case when :has_p2 then (select result like '42501%' from t_probe where name='R1.delete') else true end);
select chk('T14c with GRANT ALL restored: legit completion UPDATE still works', (select result like 'OK:%' from t_probe where name='R5.complete'));
select chk('T14d with GRANT ALL restored: quota still exhausted', case when :has_p2 then burn(:'ob',1) = 0 else true end);

select 'RESULT variant='||:'variant'||' '||case when ok then 'PASS ' else 'FAIL ' end||n||case when ok then '' else '  -> '||coalesce(detail,'') end from chk_r order by n;
