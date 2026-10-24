-- FAIL-CLOSED ROLLBACK for the S1 migrations
--   20261019100000_prompter_p0_ai_jobs_lockdown, 20261019100100_prompter_p0_subscription_trial_insert_guard,
--   20261019100200_prompter_p0_plan_entitlements_lockdown.
-- PLAIN SQL: no psql meta-commands or variables (works in the Supabase SQL editor and `psql -f`).
--
-- WHY THE PREVIOUS ROLLBACKS WERE REMOVED: they re-granted `delete, insert, references, select, trigger, truncate,
-- update` on prompter_ai_jobs (and delete/truncate/insert on subscriptions, insert/update/delete/truncate on
-- plan_entitlements) to anon + authenticated. That re-opens exactly the holes S1 closes: quota reset by DELETE or
-- backdating created_at, forged / re-created / extended trials, cross-tenant TRUNCATE, unlimited AI through an
-- emptied entitlement table. A rollback must never be able to undo a security fix.
--
-- WHAT THIS DOES INSTEAD: exactly ONE narrow, low-risk restore is possible, and only on explicit request:
--     UPDATE(estimated_cost) on public.prompter_ai_jobs for `authenticated`
-- (a cost display figure of the caller's own tenant; it is not part of the quota maths). Anything else is REFUSED:
--   * INSERT / DELETE / TRUNCATE / REFERENCES / TRIGGER on any table, anything for anon / PUBLIC / service_role;
--   * UPDATE on id, tenant_id, job_type, input_reference, created_at, actor_user_id (quota ledger identity);
--   * any change to prompter_subscriptions (trial) or prompter_plan_entitlements, and dropping the trial trigger.
-- If a verified flow breaks because of S1, fix FORWARD with a new reviewed migration (and Founder approval), not by
-- re-opening a privilege.
--
-- HOW TO USE: copy this file, replace REPLACE_WITH_REQUEST in the copy with exactly
--     prompter_ai_jobs:UPDATE(estimated_cost)
-- and run the copy. Left unedited it refuses. All-or-nothing (one DO block) with an exact-change post-check.
-- NOT placed in supabase/migrations on purpose (never auto-applied).

do $down$
declare
  v_req text := 'REPLACE_WITH_REQUEST';   -- EDIT: prompter_ai_jobs:UPDATE(estimated_cost)
  c_allowed constant text := 'prompter_ai_jobs:UPDATE(estimated_cost)';
  v_maint boolean := current_setting('server_version_num')::int >= 170000;
  before_s jsonb;
  after_s jsonb;
  col_before text[];
  col_after text[];
  k text;
begin
  perform set_config('lock_timeout', '5s', true);
  v_req := btrim(v_req);
  if v_req = '' or v_req = 'REPLACE_WITH_REQUEST' then
    raise exception 'refused: name the request (see header); a blanket restore does not exist';
  end if;
  if v_req <> c_allowed then
    raise exception 'refused: "%" is never restored by a rollback (only % is allowed); fix forward with a reviewed migration', v_req, c_allowed;
  end if;
  if to_regclass('public.prompter_ai_jobs') is null then
    raise exception 'refused: public.prompter_ai_jobs does not exist';
  end if;

  -- snapshots: table-level privileges of anon / authenticated / service_role on the three S1 tables, and every column ACL entry
  select jsonb_object_agg(c.relname || ':' || r.r || ':' || p.p, has_table_privilege(r.r, c.oid, p.p)) into before_s
    from pg_class c cross join (values ('anon'),('authenticated'),('service_role')) r(r)
    cross join (select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                                     || case when v_maint then array['MAINTAIN'] else array[]::text[] end) p) p
   where c.relnamespace = 'public'::regnamespace and c.relname in ('prompter_ai_jobs','prompter_subscriptions','prompter_plan_entitlements');
  select coalesce(array_agg((select relname::text from pg_class where oid = a.attrelid) || '.' || a.attname || ':' || x.grantee::regrole::text || ':' || x.privilege_type
                            order by (select relname::text from pg_class where oid = a.attrelid), a.attname, x.grantee, x.privilege_type), '{}') into col_before
    from pg_attribute a cross join lateral aclexplode(a.attacl) x
   where a.attrelid in ('public.prompter_ai_jobs'::regclass, 'public.prompter_subscriptions'::regclass, 'public.prompter_plan_entitlements'::regclass)
     and a.attacl is not null and not a.attisdropped;

  grant update (estimated_cost) on public.prompter_ai_jobs to authenticated;

  select jsonb_object_agg(c.relname || ':' || r.r || ':' || p.p, has_table_privilege(r.r, c.oid, p.p)) into after_s
    from pg_class c cross join (values ('anon'),('authenticated'),('service_role')) r(r)
    cross join (select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                                     || case when v_maint then array['MAINTAIN'] else array[]::text[] end) p) p
   where c.relnamespace = 'public'::regnamespace and c.relname in ('prompter_ai_jobs','prompter_subscriptions','prompter_plan_entitlements');
  select coalesce(array_agg((select relname::text from pg_class where oid = a.attrelid) || '.' || a.attname || ':' || x.grantee::regrole::text || ':' || x.privilege_type
                            order by (select relname::text from pg_class where oid = a.attrelid), a.attname, x.grantee, x.privilege_type), '{}') into col_after
    from pg_attribute a cross join lateral aclexplode(a.attacl) x
   where a.attrelid in ('public.prompter_ai_jobs'::regclass, 'public.prompter_subscriptions'::regclass, 'public.prompter_plan_entitlements'::regclass)
     and a.attacl is not null and not a.attisdropped;

  -- exact-change post-check: no table-level cell moved, exactly one new column ACL entry, and it is the requested one
  for k in select key from jsonb_each(after_s) a(key, value) where value is distinct from before_s -> key loop
    raise exception 'rollback post-check failed: unexpected table-level privilege change %', k;
  end loop;
  if (select count(*) from unnest(col_after) e where e <> all (col_before)) > 1
     or (select count(*) from unnest(col_before) e where e <> all (col_after)) <> 0 then
    raise exception 'rollback post-check failed: column privileges changed beyond the requested cell';
  end if;
  if exists (select 1 from unnest(col_after) e where e <> all (col_before) and e <> 'prompter_ai_jobs.estimated_cost:authenticated:UPDATE') then
    raise exception 'rollback post-check failed: unexpected column privilege';
  end if;
  if exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) x
              where c.relnamespace = 'public'::regnamespace and x.grantee = 0
                and c.relname in ('prompter_ai_jobs','prompter_subscriptions','prompter_plan_entitlements')) then
    raise exception 'rollback post-check failed: PUBLIC holds a privilege';
  end if;
  raise notice 'restored UPDATE(estimated_cost) on prompter_ai_jobs for authenticated only';
end
$down$;
