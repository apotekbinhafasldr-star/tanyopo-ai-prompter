-- LINOE — AI Jobs quota guard (part 1 of 2). Additive; no table/column/policy/grant change.
--
-- WHY (audit 2026-10-20/21, reproduced on a local synthetic PostgreSQL, nothing on production):
--   1. fn_create_ai_job_if_entitled() is SECURITY DEFINER and has no role check, so ANY logged-in user of
--      a tenant (member, kasir, ...) can consume that tenant's AI quota, while the table policy only lets
--      owner/marketing create jobs directly.
--   2. job_type / input_reference are only validated by the table CHECK / not at all (2 MB accepted).
--   3. Quota = count(prompter_ai_jobs rows created in the period). Anything that can change created_at /
--      tenant_id, or remove rows, resets the quota. (PR #31 closes this with privileges; this migration
--      adds a second layer that survives a privilege rollback or a future GRANT mistake.)
--
-- WHAT:
--   A  fn_create_ai_job_if_entitled(text, jsonb): SAME signature / return shape / quota maths. New, additive
--      denial rows (no exception, so the app shows its generic "Akses AI tidak diizinkan" message):
--        ROLE_NOT_ALLOWED    caller's role (fn_current_role(), derived from auth.uid() -> user_profiles; never
--                            from client input) is not owner/marketing -- the same roles the table policy allows.
--        INVALID_JOB_TYPE    not one of the six job types the app routes (lib/ai/task-classes.ts).
--        INVALID_INPUT       input_reference is not a JSON object, or is larger than 64 KiB.
--      NO_TENANT is still checked first and the quota/period logic is byte-for-byte unchanged.
--   B  BEFORE UPDATE row trigger on prompter_ai_jobs: id, tenant_id, actor_user_id, job_type, input_reference
--      and created_at are immutable for the client roles anon/authenticated. Completion / failure / retry
--      bookkeeping (status, provider, model, tokens, output_reference, error*, completed_at, ...) is untouched.
--   C  BEFORE TRUNCATE statement trigger: blocked for anon/authenticated.
--   D  The body is a SUPERSET of both existing definitions (B10 on main and PR #31's fail-closed
--      ENTITLEMENT_NOT_CONFIGURED block), so the apply order relative to #31 cannot drop either. PR #31's
--      migration 20261019100200 re-creates this function WITHOUT the role check: it must be applied BEFORE this
--      migration (file order already guarantees it); part 2 verifies the guard is live before it installs.
--   Service role, table owner, FK cascades (tenant deletion, run as the owner) and SECURITY DEFINER functions
--   are NOT restricted by B/C.
--
-- NOT DONE ON PURPOSE: no new ledger, no cost cap, no change to allowances/periods/trial logic, no change to any
-- PUBLOE / UMKMpro AI / Apotek object. The DELETE guard is in part 2 (it needs PR #31's server-side release).
-- Rollback: supabase/rollback/20261021120000_prompter_ai_jobs_quota_guard.down.sql

create or replace function public.fn_create_ai_job_if_entitled(
  p_job_type text,
  p_input_reference jsonb default '{}'::jsonb
)
returns table(job_id uuid, allowed boolean, reason text, used_count integer, allowance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_actor_user_id uuid;
  v_role text;
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_entitlement_plan text;
  v_period_start timestamptz;
  v_used integer;
  v_new_job_id uuid;
  v_input jsonb;
begin
  v_tenant_id := public.fn_current_tenant_id();
  v_actor_user_id := auth.uid();

  if v_tenant_id is null then
    return query select null::uuid, false, 'NO_TENANT'::text, 0, 0;
    return;
  end if;

  -- Same roles the "Owner/marketing buat & ubah ai job" policy allows. Identity comes from the JWT
  -- (auth.uid()), never from a parameter.
  v_role := public.fn_current_role();
  if v_role is null or v_role not in ('owner', 'marketing') then
    return query select null::uuid, false, 'ROLE_NOT_ALLOWED'::text, 0, 0;
    return;
  end if;

  if p_job_type is null or p_job_type not in (
    'MARKETING_BLUEPRINT', 'CAMPAIGN_PROPOSAL', 'CONTENT_GENERATION',
    'SEO_RECOMMENDATIONS', 'ANALYTICS_INSIGHT', 'OPTIMIZATION_RECOMMENDATION'
  ) then
    return query select null::uuid, false, 'INVALID_JOB_TYPE'::text, 0, 0;
    return;
  end if;

  v_input := coalesce(p_input_reference, '{}'::jsonb);
  if jsonb_typeof(v_input) <> 'object' or octet_length(v_input::text) > 65536 then
    return query select null::uuid, false, 'INVALID_INPUT'::text, 0, 0;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('prompter_ai_usage:' || v_tenant_id::text));

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant_id for update;

  if not found then
    return query select null::uuid, false, 'NO_SUBSCRIPTION'::text, 0, 0;
    return;
  end if;

  if v_sub.status = 'TRIALING' and v_sub.current_period_end is not null and now() > v_sub.current_period_end then
    return query select null::uuid, false, 'TRIAL_EXPIRED'::text, 0, 0;
    return;
  end if;

  if v_sub.status in ('PAST_DUE', 'CANCELED') then
    return query select null::uuid, false, 'SUBSCRIPTION_' || v_sub.status, 0, 0;
    return;
  end if;

  v_entitlement_plan := case when v_sub.status = 'TRIALING' then 'FREE' else coalesce(v_sub.plan, 'FREE') end;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_entitlement_plan;
  if not found then
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  -- FAIL CLOSED (same block as PR #31 20261019100200): no entitlement row / NULL allowance never means "unlimited".
  -- Repeated here so that applying this migration after (or without) #31 can never remove that fix.
  if v_entitlement.plan is null or v_entitlement.ai_usage_allowance is null then
    return query select null::uuid, false, 'ENTITLEMENT_NOT_CONFIGURED'::text, 0, 0;
    return;
  end if;

  if v_sub.status = 'TRIALING' then
    v_period_start := coalesce(v_sub.current_period_start, v_sub.created_at);
  else
    v_period_start := date_trunc('month', now());
  end if;

  select count(*) into v_used
  from public.prompter_ai_jobs
  where tenant_id = v_tenant_id and created_at >= v_period_start;

  if v_used >= v_entitlement.ai_usage_allowance then
    return query select null::uuid, false, 'AI_USAGE_LIMIT_REACHED'::text, v_used, v_entitlement.ai_usage_allowance;
    return;
  end if;

  insert into public.prompter_ai_jobs (tenant_id, actor_user_id, job_type, status, input_reference)
  values (v_tenant_id, v_actor_user_id, p_job_type, 'PROCESSING', v_input)
  returning id into v_new_job_id;

  return query select v_new_job_id, true, null::text, v_used + 1, v_entitlement.ai_usage_allowance;
end;
$$;

comment on function public.fn_create_ai_job_if_entitled(text, jsonb) is
  'B9/B10 quota RPC + AI-jobs quota guard: owner/marketing only (ROLE_NOT_ALLOWED), known job types only (INVALID_JOB_TYPE), input_reference must be a JSON object <= 64 KiB (INVALID_INPUT). Quota maths unchanged.';

-- Privilege-neutral: CREATE OR REPLACE keeps the existing ACL of the RPC (anon no / authenticated yes on production).

-- ---- B + C : row/statement guards (SECURITY INVOKER on purpose: current_user is the real caller) --------
create or replace function public.fn_guard_ai_job_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.id             is distinct from old.id
    or new.tenant_id      is distinct from old.tenant_id
    or new.actor_user_id  is distinct from old.actor_user_id
    or new.job_type       is distinct from old.job_type
    or new.input_reference is distinct from old.input_reference
    or new.created_at     is distinct from old.created_at
  ) then
    raise exception 'prompter_ai_jobs: id, tenant_id, actor_user_id, job_type, input_reference and created_at are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.fn_guard_ai_job_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'prompter_ai_jobs: TRUNCATE is not allowed' using errcode = '42501';
  end if;
  return null;
end;
$$;

revoke all on function public.fn_guard_ai_job_immutable() from public, anon, authenticated;
revoke all on function public.fn_guard_ai_job_truncate() from public, anon, authenticated;

drop trigger if exists trg_prompter_ai_jobs_immutable on public.prompter_ai_jobs;
create trigger trg_prompter_ai_jobs_immutable
  before update on public.prompter_ai_jobs
  for each row execute function public.fn_guard_ai_job_immutable();

drop trigger if exists trg_prompter_ai_jobs_no_truncate on public.prompter_ai_jobs;
create trigger trg_prompter_ai_jobs_no_truncate
  before truncate on public.prompter_ai_jobs
  for each statement execute function public.fn_guard_ai_job_truncate();
