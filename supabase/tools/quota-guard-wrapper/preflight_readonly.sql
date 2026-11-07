-- AI-jobs quota guard - PREFLIGHT (READ-ONLY, one SELECT). Run BEFORE each guard file, in the Supabase SQL Editor of
-- project wjjyqovhmwenbcvbnkgx. Returns only counts, md5 hashes, flags and role names - no customer rows, no identifiers.
-- Read the LAST row: verdict = READY_FOR_PART1 | READY_FOR_PART2 | DONE | STOP:<reason>. Anything but READY_* = do not apply.
-- Locked by supabase/tools/quota-guard-wrapper/manifest.json (sha256). Expected md5 values below are the manifest's.
with
exp as (select '17bd1c2bee1069ca6460774e9021fa9d'::text as md5_before, '2042201955b6acbae5b10999413b0e49'::text as md5_after1),
cur as (
  select md5(pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure)) as md5_now,
         (select count(*) from pg_trigger where tgrelid = 'public.prompter_ai_jobs'::regclass and not tgisinternal) as trg_n,
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fn\_guard\_ai\_job%') as fn_n,
         (select count(*) from supabase_migrations.schema_migrations where version in ('20261019100000','20261019100100','20261019100200')) as s1_n,
         (select count(*) from supabase_migrations.schema_migrations where version = '20261021120000') as g1_n,
         (select count(*) from supabase_migrations.schema_migrations where version = '20261021120100') as g2_n,
         (select count(*) from supabase_migrations.schema_migrations where name in ('prompter_ai_jobs_quota_guard','prompter_ai_jobs_delete_guard')) as gname_n,
         (select count(*) from unnest(array['anon','authenticated']) r, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
            where has_table_privilege(r, 'public.prompter_ai_jobs', p)) as client_write_n,
         (select count(*) from pg_attribute a where a.attrelid = 'public.prompter_ai_jobs'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('authenticated', 'public.prompter_ai_jobs'::regclass, a.attnum, 'UPDATE')) as upd_cols_n,
         has_function_privilege('anon', 'public.fn_create_ai_job_if_entitled(text,jsonb)', 'execute') as anon_exec,
         has_function_privilege('authenticated', 'public.fn_create_ai_job_if_entitled(text,jsonb)', 'execute') as auth_exec,
         (select count(*) from public.prompter_plan_entitlements where plan = 'FREE' and ai_usage_allowance is not null) as free_ok_n,
         (select count(*) from public.prompter_plan_entitlements where ai_usage_allowance is null) as null_allow_n,
         (select max(version) from supabase_migrations.schema_migrations) as ledger_max,
         (select count(*) from public.prompter_ai_jobs where created_at > now() - interval '1 hour') as jobs_last_hour,
         (select count(*) from pg_locks l where l.relation = 'public.prompter_ai_jobs'::regclass and l.granted and l.mode in ('ShareRowExclusiveLock','ShareLock','ExclusiveLock','AccessExclusiveLock')) as heavy_locks_n
),
st as (
  select cur.*,
    case when g1_n = 0 and g2_n = 0 then 'S0_BEFORE_PART1'
         when g1_n = 1 and g2_n = 0 then 'S1_PART1_DONE'
         when g1_n = 1 and g2_n = 1 then 'S2_ALL_DONE'
         else 'UNKNOWN' end as state
  from cur
),
rows_ as (
  select 10 as o, 'ledger_max (info; guard versions are older than this - expected, recorded explicitly)' as chk, ledger_max as val, null::boolean as ok from st
  union all select 11, 'state', state, state <> 'UNKNOWN' from st
  union all select 12, 'S1 versions recorded in ledger (need 3)', s1_n::text, s1_n = 3 from st
  union all select 13, 'ledger rows with guard names (must equal rows by version)', gname_n::text, gname_n = g1_n + g2_n from st
  union all select 20, 'client write privileges on prompter_ai_jobs (S1 effect; must be 0)', client_write_n::text, client_write_n = 0 from st
  union all select 21, 'authenticated column-UPDATE count (S1: 10)', upd_cols_n::text, upd_cols_n = 10 from st
  union all select 22, 'RPC execute: anon=false authenticated=true', anon_exec::text || '/' || auth_exec::text, (not anon_exec) and auth_exec from st
  union all select 30, 'RPC md5 now', md5_now, case state when 'S0_BEFORE_PART1' then md5_now = exp.md5_before
                                                       when 'UNKNOWN' then false else md5_now = exp.md5_after1 end from st, exp
  union all select 31, 'guard triggers / guard functions (S0: 0/0, S1: 2/2, S2: 3/3)', trg_n::text || '/' || fn_n::text,
         case state when 'S0_BEFORE_PART1' then trg_n = 0 and fn_n = 0 when 'S1_PART1_DONE' then trg_n = 2 and fn_n = 2
                    when 'S2_ALL_DONE' then trg_n = 3 and fn_n = 3 else false end from st
  union all select 40, 'FREE entitlement row present with non-null allowance (fail-closed block relies on it)', free_ok_n::text, free_ok_n = 1 from st
  union all select 41, 'entitlement rows with NULL allowance (must be 0)', null_allow_n::text, null_allow_n = 0 from st
  union all select 50, 'AI jobs created in the last hour (info; prefer a quiet moment)', jobs_last_hour::text, null from st
  union all select 51, 'heavy locks held on prompter_ai_jobs right now (must be 0)', heavy_locks_n::text, heavy_locks_n = 0 from st
  union all select 60, 'users per role that part 1 would block with ROLE_NOT_ALLOWED (info; owner/marketing are allowed)',
         coalesce((select string_agg(role || '=' || n, ', ' order by role) from (
           select up.role, count(*) n from public.user_profiles up
           where up.tenant_id in (select tenant_id from public.prompter_subscriptions) and up.role not in ('owner','marketing')
           group by up.role) z), 'none'), null from st
)
select o, chk, val, ok from rows_
union all
select 99, 'VERDICT',
  case when exists (select 1 from rows_ where ok is false) then 'STOP: ' || (select string_agg(chk, ' | ' order by o) from rows_ where ok is false)
       else case (select state from st) when 'S0_BEFORE_PART1' then 'READY_FOR_PART1'
                                        when 'S1_PART1_DONE' then 'READY_FOR_PART2'
                                        else 'DONE' end end,
  not exists (select 1 from rows_ where ok is false)
order by o;
