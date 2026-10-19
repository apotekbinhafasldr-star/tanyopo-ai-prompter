-- ROLLBACK for 20261019100200_prompter_p0_plan_entitlements_lockdown.sql
-- NOT a migration: never applied automatically. Restores the production state observed on 2026-10-19:
-- anon/authenticated held INSERT/UPDATE/DELETE/TRUNCATE on prompter_plan_entitlements and the quota
-- function had no fail-closed guard.
-- WARNING: rolling back REOPENS the TRUNCATE-the-entitlements quota bypass.

grant insert, update, delete, truncate on public.prompter_plan_entitlements to anon, authenticated;

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
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_entitlement_plan text;
  v_period_start timestamptz;
  v_used integer;
  v_new_job_id uuid;
begin
  v_tenant_id := public.fn_current_tenant_id();
  v_actor_user_id := auth.uid();

  if v_tenant_id is null then
    return query select null::uuid, false, 'NO_TENANT'::text, 0, 0;
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
  values (v_tenant_id, v_actor_user_id, p_job_type, 'PROCESSING', p_input_reference)
  returning id into v_new_job_id;

  return query select v_new_job_id, true, null::text, v_used + 1, v_entitlement.ai_usage_allowance;
end;
$$;
