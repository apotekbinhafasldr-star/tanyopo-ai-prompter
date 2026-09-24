-- Batch B12 P0 remediation: trial-expiry gap on non-AI entitlement paths.
--
-- fn_create_ai_job_if_entitled() (B9/B10) already denies a TRIALING
-- subscription past its current_period_end. fn_activate_product() and
-- fn_reserve_active_campaign_slot() never got the same check when B10
-- added the PAST_DUE/CANCELED guard to them -- both currently only
-- collapse an expired trial down to FREE-tier numeric limits, they never
-- deny outright the way an expired trial denies AI usage. This closes
-- that gap by mirroring fn_create_ai_job_if_entitled's exact condition,
-- placed before the existing PAST_DUE/CANCELED check in each function.
--
-- CREATE OR REPLACE with an identical signature preserves each
-- function's existing GRANT/REVOKE state (function OID persists) -- no
-- grant statements needed here, same as B10's redefinition of these two
-- functions.

create or replace function public.fn_activate_product(p_product_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_product public.prompter_products%rowtype;
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement_plan text;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_active_count integer;
begin
  v_tenant_id := public.fn_current_tenant_id();
  if v_tenant_id is null then
    return query select false, 'NO_TENANT'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('prompter_active_products:' || v_tenant_id::text));

  select * into v_product from public.prompter_products where id = p_product_id and tenant_id = v_tenant_id for update;
  if not found then
    return query select false, 'NOT_FOUND'::text;
    return;
  end if;

  if v_product.status = 'ACTIVE' then
    return query select true, null::text;
    return;
  end if;

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant_id;

  if found and v_sub.status = 'TRIALING' and v_sub.current_period_end is not null and now() > v_sub.current_period_end then
    return query select false, 'TRIAL_EXPIRED'::text;
    return;
  end if;

  if found and v_sub.status in ('PAST_DUE', 'CANCELED') then
    return query select false, ('SUBSCRIPTION_' || v_sub.status)::text;
    return;
  end if;

  v_entitlement_plan := case
    when not found then 'FREE'
    when v_sub.status = 'TRIALING' then 'FREE'
    else coalesce(v_sub.plan, 'FREE')
  end;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_entitlement_plan;
  if not found then
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  if v_entitlement.max_active_products is not null then
    select count(*) into v_active_count
    from public.prompter_products
    where tenant_id = v_tenant_id and status = 'ACTIVE';

    if v_active_count >= v_entitlement.max_active_products then
      return query select false, 'PRODUCT_LIMIT_REACHED'::text;
      return;
    end if;
  end if;

  update public.prompter_products set status = 'ACTIVE', updated_at = now() where id = p_product_id;
  return query select true, null::text;
end;
$$;

comment on function public.fn_activate_product(uuid) is
  'Batch B9 P0-1/P2-3, extended by Batch B10 to deny PAST_DUE/CANCELED subscriptions and to always use FREE-tier numbers while TRIALING regardless of the plan column; extended by this migration to deny outright once a TRIALING subscription has passed current_period_end (mirrors fn_create_ai_job_if_entitled).';

create or replace function public.fn_reserve_active_campaign_slot(p_campaign_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_campaign public.prompter_master_campaigns%rowtype;
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement_plan text;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_consuming_count integer;
begin
  v_tenant_id := public.fn_current_tenant_id();
  if v_tenant_id is null then
    return query select false, 'NO_TENANT'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('prompter_active_campaigns:' || v_tenant_id::text));

  select * into v_campaign from public.prompter_master_campaigns where id = p_campaign_id and tenant_id = v_tenant_id for update;
  if not found then
    return query select false, 'NOT_FOUND'::text;
    return;
  end if;

  if v_campaign.status <> 'DRAFT' then
    return query select false, 'INVALID_STATE'::text;
    return;
  end if;

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant_id;

  if found and v_sub.status = 'TRIALING' and v_sub.current_period_end is not null and now() > v_sub.current_period_end then
    return query select false, 'TRIAL_EXPIRED'::text;
    return;
  end if;

  if found and v_sub.status in ('PAST_DUE', 'CANCELED') then
    return query select false, ('SUBSCRIPTION_' || v_sub.status)::text;
    return;
  end if;

  v_entitlement_plan := case
    when not found then 'FREE'
    when v_sub.status = 'TRIALING' then 'FREE'
    else coalesce(v_sub.plan, 'FREE')
  end;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_entitlement_plan;
  if not found then
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  if v_entitlement.max_active_campaigns is not null then
    select count(*) into v_consuming_count
    from public.prompter_master_campaigns
    where tenant_id = v_tenant_id
      and status in ('ACTIVE', 'SCHEDULED', 'AWAITING_APPROVAL', 'PAUSED')
      and id <> p_campaign_id;

    if v_consuming_count >= v_entitlement.max_active_campaigns then
      return query select false, 'CAMPAIGN_LIMIT_REACHED'::text;
      return;
    end if;
  end if;

  update public.prompter_master_campaigns set status = 'AWAITING_APPROVAL', updated_at = now() where id = p_campaign_id;
  return query select true, null::text;
end;
$$;

comment on function public.fn_reserve_active_campaign_slot(uuid) is
  'Batch B9 P0-1/P2-2, extended by Batch B10 to deny PAST_DUE/CANCELED subscriptions and to always use FREE-tier numbers while TRIALING regardless of the plan column; extended by this migration to deny outright once a TRIALING subscription has passed current_period_end (mirrors fn_create_ai_job_if_entitled).';
