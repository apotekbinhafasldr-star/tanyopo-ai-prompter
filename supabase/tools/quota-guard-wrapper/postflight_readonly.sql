-- AI-jobs quota guard - POSTFLIGHT (READ-ONLY, one SELECT). Run AFTER each guard file. Returns only counts, md5 hashes
-- and flags - no customer rows. Read the LAST row: verdict = POST_OK_PART1 | POST_OK_ALL | STOP:<reason>.
-- Locked by supabase/tools/quota-guard-wrapper/manifest.json (sha256). Expected values are the manifest's.
with
exp as (select '17bd1c2bee1069ca6460774e9021fa9d'::text as md5_before,
               '2042201955b6acbae5b10999413b0e49'::text as md5_after1,
               '4037f87f42e93c43472f5b321f9e257500d5d849c1036f257158b0594ae3f356'::text as sha_g1,
               '903bde666f87c981c7ab00a449a538ecdf000823bb3fa79c108593d5ed099d91'::text as sha_g2),
fn as (select 'public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure as oid),
cur as (
  select md5(pg_get_functiondef(fn.oid)) as md5_now,
         (select pg_get_userbyid(proowner) || '/secdef=' || prosecdef from pg_proc where oid = fn.oid) as owner_def,
         position('ROLE_NOT_ALLOWED' in pg_get_functiondef(fn.oid)) > 0 as has_role_guard,
         position('ENTITLEMENT_NOT_CONFIGURED' in pg_get_functiondef(fn.oid)) > 0 as has_failclosed,
         has_function_privilege('anon', fn.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', fn.oid, 'execute') as auth_exec,
         has_function_privilege('service_role', fn.oid, 'execute') as svc_exec,
         (select count(*) from pg_trigger where tgrelid = 'public.prompter_ai_jobs'::regclass and not tgisinternal) as trg_n,
         (select count(*) from pg_trigger t where t.tgrelid = 'public.prompter_ai_jobs'::regclass and not t.tgisinternal and t.tgenabled = 'O' and (
              (t.tgname = 'trg_prompter_ai_jobs_immutable'   and t.tgtype = 19 and (select f.proname from pg_proc f where f.oid = t.tgfoid) = 'fn_guard_ai_job_immutable') or
              (t.tgname = 'trg_prompter_ai_jobs_no_truncate' and t.tgtype = 34 and (select f.proname from pg_proc f where f.oid = t.tgfoid) = 'fn_guard_ai_job_truncate') or
              (t.tgname = 'trg_prompter_ai_jobs_no_delete'   and t.tgtype = 11 and (select f.proname from pg_proc f where f.oid = t.tgfoid) = 'fn_guard_ai_job_delete'))) as trg_ok_n,
         (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_guard\_ai\_job%') as fn_n,
         (select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_guard\_ai\_job%'
              and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon','authenticated'))) as fn_exposed_n,
         (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_guard\_ai\_job%' and p.prosecdef) as fn_secdef_n,
         (select count(*) from unnest(array['anon','authenticated']) r, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
            where has_table_privilege(r, 'public.prompter_ai_jobs', p)) as client_write_n,
         (select count(*) from pg_attribute a where a.attrelid = 'public.prompter_ai_jobs'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('authenticated', 'public.prompter_ai_jobs'::regclass, a.attnum, 'UPDATE')) as upd_cols_n,
         (select count(*) from supabase_migrations.schema_migrations where version = '20261021120000' and name = 'prompter_ai_jobs_quota_guard'
            and cardinality(statements) = 1 and encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') = exp.sha_g1) as led1_ok,
         (select count(*) from supabase_migrations.schema_migrations where version = '20261021120100' and name = 'prompter_ai_jobs_delete_guard'
            and cardinality(statements) = 1 and encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') = exp.sha_g2) as led2_ok,
         (select count(*) from supabase_migrations.schema_migrations where version in ('20261019100000','20261019100100','20261019100200')) as s1_n,
         (select count(*) from supabase_migrations.schema_migrations where version in ('20261021120000','20261021120100')) as g_n,
         (select max(version) from supabase_migrations.schema_migrations) as ledger_max,
         (select count(*) from public.prompter_ai_jobs) as jobs_total
  from fn, exp
),
st as (select cur.*, case when led1_ok = 1 and led2_ok = 1 then 'ALL' when led1_ok = 1 and g_n = 1 then 'PART1' else 'OTHER' end as state from cur),
rows_ as (
  select 10 as o, 'state (ledger content matches the locked sha256)' as chk, state as val, state in ('PART1','ALL') as ok from st
  union all select 11, 'ledger max (info; unchanged other versions)', ledger_max, null from st
  union all select 12, 'S1 versions still recorded (3)', s1_n::text, s1_n = 3 from st
  union all select 20, 'RPC md5 now', md5_now, case state when 'PART1' then md5_now = exp.md5_after1 when 'ALL' then md5_now = exp.md5_after1 else false end from st, exp
  union all select 21, 'RPC has role guard and fail-closed block', has_role_guard::text || '/' || has_failclosed::text, has_role_guard and has_failclosed from st
  union all select 22, 'RPC owner/security definer (postgres/secdef=true)', owner_def, owner_def = 'postgres/secdef=true' from st
  union all select 23, 'RPC execute anon/authenticated/service_role (false/true/true, unchanged ACL)', anon_exec::text || '/' || auth_exec::text || '/' || svc_exec::text,
         (not anon_exec) and auth_exec and svc_exec from st
  union all select 30, 'triggers on prompter_ai_jobs with the exact shape / total (PART1: 2/2, ALL: 3/3)', trg_ok_n::text || '/' || trg_n::text,
         case state when 'PART1' then trg_ok_n = 2 and trg_n = 2 when 'ALL' then trg_ok_n = 3 and trg_n = 3 else false end from st
  union all select 31, 'guard functions (PART1: 2, ALL: 3), SECURITY DEFINER count (0), exposed to PUBLIC/anon/authenticated (0)',
         fn_n::text || '/' || fn_secdef_n::text || '/' || fn_exposed_n::text,
         (case state when 'PART1' then fn_n = 2 when 'ALL' then fn_n = 3 else false end) and fn_secdef_n = 0 and fn_exposed_n = 0 from st
  union all select 40, 'client write privileges on prompter_ai_jobs (must stay 0)', client_write_n::text, client_write_n = 0 from st
  union all select 41, 'authenticated column-UPDATE count (S1: 10, unchanged)', upd_cols_n::text, upd_cols_n = 10 from st
  union all select 50, 'prompter_ai_jobs total rows (info; compare with the preflight count you noted, only counts)', jobs_total::text, null from st
)
select o, chk, val, ok from rows_
union all
select 99, 'VERDICT',
  case when exists (select 1 from rows_ where ok is false) then 'STOP: ' || (select string_agg(chk, ' | ' order by o) from rows_ where ok is false)
       when (select state from st) = 'PART1' then 'POST_OK_PART1' else 'POST_OK_ALL' end,
  not exists (select 1 from rows_ where ok is false)
order by o;
