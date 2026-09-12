-- Batch B9 — Plan Entitlement & Feature Enforcement remediation.
--
-- Additive only, same rules as every prior Promoter migration: prefixed
-- `prompter_`, foreign-keys into existing tables, scoped by the existing
-- fn_current_tenant_id()/fn_current_role(). No UMKMpro table touched, no
-- existing row modified, nothing removed and no row deleted. Idempotent
-- (safe to re-run): every object uses IF NOT EXISTS / CREATE OR REPLACE /
-- DROP-then-CREATE-same-name.
--
-- Fixes, per the B9 audit (see the read-only "B9 PLAN ENTITLEMENT AUDIT
-- REPORT" this migration implements):
--   P0-1: no server-side enforcement of maxActiveProducts,
--         maxActiveCampaigns, or paid-tier aiUsageAllowance.
--   P1-1: changePlanAction could persist a COMING_SOON plan (Agency).
--   P1-2: trial AI usage cap had a check-then-insert TOCTOU race.
--   P2-1: two divergent trial AI allowance numbers (30 vs 20/day+100/mo).
--   P2-2: "active campaign" had no canonical definition.
--   P2-3: products had no archive/reactivate lifecycle.
--
-- Numbers below are copied verbatim from lib/billing/plans.ts's
-- PLAN_TIERS (Batch B8 pricing, founder-approved) -- nothing here invents
-- a new limit. UMKMPRO_BUNDLE is a separate cross-sell bundle belonging
-- to the sibling UMKMpro AI product (lib/billing/plans.ts's own
-- PlanTierId type deliberately excludes it) -- it is out of this audit's
-- scope, so its row conservatively mirrors FREE's numbers rather than
-- inventing a number for it.

-- ---------------------------------------------------------------------------
-- 1. Canonical entitlement table -- the single source of truth the
--    enforcement functions below consult. Mirrors lib/billing/plans.ts
--    exactly; a unit test (tests/unit/lib/billing-plans.test.ts) asserts
--    the two never drift apart.
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_plan_entitlements (
  plan text primary key,
  ai_usage_allowance integer not null check (ai_usage_allowance > 0),
  -- null = unlimited (only Agency's product/campaign caps today -- never
  -- invent a number the product brief didn't give).
  max_active_products integer check (max_active_products is null or max_active_products > 0),
  max_active_campaigns integer check (max_active_campaigns is null or max_active_campaigns > 0),
  max_users integer check (max_users is null or max_users > 0),
  availability text not null default 'ACTIVE' check (availability in ('ACTIVE', 'COMING_SOON')),
  updated_at timestamptz not null default now()
);

comment on table public.prompter_plan_entitlements is
  'Batch B9 -- canonical, DB-level mirror of lib/billing/plans.ts PLAN_TIERS. Consulted by fn_create_ai_job_if_entitled/fn_activate_product/fn_reserve_active_campaign_slot and the Agency-protection trigger below, so enforcement never depends solely on application code sending the correct number.';

drop trigger if exists trg_prompter_plan_entitlements_updated_at on public.prompter_plan_entitlements;
create trigger trg_prompter_plan_entitlements_updated_at
  before update on public.prompter_plan_entitlements
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_plan_entitlements enable row level security;

-- Read-only reference data (same numbers already shown publicly on the
-- pricing page) -- safe for any authenticated user to read, never
-- writable by a client (no insert/update/delete policy at all; only a
-- service-role/migration can change these numbers).
drop policy if exists "Lihat entitlement paket" on public.prompter_plan_entitlements;
create policy "Lihat entitlement paket"
  on public.prompter_plan_entitlements for select
  to authenticated
  using (true);

insert into public.prompter_plan_entitlements
  (plan, ai_usage_allowance, max_active_products, max_active_campaigns, max_users, availability)
values
  ('FREE',           30,    3,    2,   1,  'ACTIVE'),
  ('STARTER',        150,   10,   5,   1,  'ACTIVE'),
  ('GROWTH',         500,   50,   20,  3,  'ACTIVE'),
  ('PRO',            1500,  200,  75,  5,  'ACTIVE'),
  ('BUSINESS',       4000,  500,  200, 10, 'ACTIVE'),
  ('AGENCY',         10000, null, null, 20, 'COMING_SOON'),
  -- Conservative fallback for the separate UMKMpro cross-sell bundle --
  -- out of B9's scope, deliberately mirrors FREE rather than inventing a
  -- number (see file header).
  ('UMKMPRO_BUNDLE', 30,    3,    2,   1,  'ACTIVE')
on conflict (plan) do update set
  ai_usage_allowance = excluded.ai_usage_allowance,
  max_active_products = excluded.max_active_products,
  max_active_campaigns = excluded.max_active_campaigns,
  max_users = excluded.max_users,
  availability = excluded.availability,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. P1-1 -- Agency protection, defense-in-depth at the DB layer. Even if
--    a future code path (or a direct service-role write) bypasses
--    changePlanAction's own app-level check, no row can ever be saved
--    with a COMING_SOON plan. Fails closed: an unrecognized plan (not
--    present in prompter_plan_entitlements at all) is also rejected
--    rather than silently allowed through.
-- ---------------------------------------------------------------------------
create or replace function public.fn_guard_subscription_plan_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_availability text;
begin
  select availability into v_availability
  from public.prompter_plan_entitlements
  where plan = new.plan;

  if v_availability is null then
    raise exception 'Paket "%" belum dikenal oleh sistem entitlement.', new.plan
      using errcode = 'P0001';
  end if;

  if v_availability = 'COMING_SOON' then
    raise exception 'Paket "%" belum dapat diaktifkan (status: coming soon).', new.plan
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.fn_guard_subscription_plan_availability() is
  'Batch B9 P1-1 -- rejects any insert/update on prompter_subscriptions that would persist a plan whose prompter_plan_entitlements.availability is not ACTIVE (e.g. Agency, still COMING_SOON), or a plan not present in the entitlement table at all. Backstops changePlanAction''s own app-level check.';

drop trigger if exists trg_prompter_subscriptions_guard_plan on public.prompter_subscriptions;
create trigger trg_prompter_subscriptions_guard_plan
  before insert or update of plan on public.prompter_subscriptions
  for each row execute function public.fn_guard_subscription_plan_availability();

-- ---------------------------------------------------------------------------
-- 3. P0-1 (AI) + P1-2 + P2-1 -- one atomic function that checks
--    entitlement AND creates the job row in the same transaction. Fixes
--    the TOCTOU race (services/ai-jobs.ts previously did a separate
--    SELECT COUNT then INSERT) by taking a per-tenant advisory
--    transaction lock, which serializes concurrent calls for the same
--    tenant so two requests near the last slot cannot both pass.
--
--    Single canonical trial allowance (P2-1): a TRIALING subscription's
--    cap is now exactly prompter_plan_entitlements.ai_usage_allowance
--    for FREE (30), counted once for the whole 14-day trial period (not
--    a separate 20/day + 100/month pair) -- the old
--    TRIAL_DAILY_AI_JOB_LIMIT/TRIAL_MONTHLY_AI_JOB_LIMIT constants and
--    checkTrialAiUsageCap() are removed from services/billing.ts.
--
--    Tenant identity is derived server-side from fn_current_tenant_id()
--    (auth.uid() -> user_profiles.tenant_id) exactly like every existing
--    RLS policy -- never accepted as a parameter -- so this
--    SECURITY DEFINER function cannot be called with someone else's
--    tenant_id to read or exhaust another tenant's allowance (Audit 8
--    tenant isolation, preserved).
-- ---------------------------------------------------------------------------
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

  -- Serializes concurrent AI-usage checks for this tenant so two
  -- requests near the cap boundary cannot both pass the count check
  -- before either insert lands. Held for this function call's implicit
  -- transaction, released automatically on return.
  perform pg_advisory_xact_lock(hashtext('prompter_ai_usage:' || v_tenant_id::text));

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant_id for update;

  if not found then
    -- Fail closed: no subscription row means entitlement cannot be
    -- determined. services/billing.ts#getOrCreateSubscription() should
    -- always be called before this RPC to avoid hitting this path in
    -- normal operation; this is the safety net if it wasn't.
    return query select null::uuid, false, 'NO_SUBSCRIPTION'::text, 0, 0;
    return;
  end if;

  if v_sub.status = 'TRIALING' and v_sub.current_period_end is not null and now() > v_sub.current_period_end then
    return query select null::uuid, false, 'TRIAL_EXPIRED'::text, 0, 0;
    return;
  end if;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_sub.plan;
  if not found then
    -- Fail closed on an unrecognized/invalid plan: fall back to the
    -- most conservative known tier (FREE) rather than granting an
    -- unlimited or undefined allowance.
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  if v_sub.status = 'TRIALING' then
    -- Canonical trial rule: 30 total AI usages across the whole 14-day
    -- trial, not a per-day/per-month reset.
    v_period_start := coalesce(v_sub.current_period_start, v_sub.created_at);
  else
    -- Paid plans: allowance resets monthly, consistent with each plan's
    -- "/bulan" pricing period.
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

comment on function public.fn_create_ai_job_if_entitled(text, jsonb) is
  'Batch B9 P0-1/P1-2/P2-1 -- atomic entitlement check + prompter_ai_jobs insert for every AI generation (trial and paid plans alike), replacing the old check-then-insert race. Tenant is always derived from fn_current_tenant_id(), never a parameter.';

revoke all on function public.fn_create_ai_job_if_entitled(text, jsonb) from public;
revoke all on function public.fn_create_ai_job_if_entitled(text, jsonb) from anon;
grant execute on function public.fn_create_ai_job_if_entitled(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. P0-1 (products) + P2-3 -- atomic activate/reactivate gate, plus a
--    matching archive function. "Produk aktif" = prompter_products.status
--    = 'ACTIVE' (Audit 3's own definition). Reactivation re-runs the same
--    cap check as a fresh activation, per the founder's decision.
-- ---------------------------------------------------------------------------
create or replace function public.fn_activate_product(p_product_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_product public.prompter_products%rowtype;
  v_plan text;
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
    -- Idempotent no-op: already active, nothing to enforce.
    return query select true, null::text;
    return;
  end if;

  select plan into v_plan from public.prompter_subscriptions where tenant_id = v_tenant_id;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = coalesce(v_plan, 'FREE');
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
  'Batch B9 P0-1/P2-3 -- atomic maxActiveProducts gate for both first activation (create) and reactivation from ARCHIVED. Never hard-deletes a product to free a slot; archiving is the only supported release path.';

revoke all on function public.fn_activate_product(uuid) from public;
revoke all on function public.fn_activate_product(uuid) from anon;
grant execute on function public.fn_activate_product(uuid) to authenticated;

create or replace function public.fn_archive_product(p_product_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_product public.prompter_products%rowtype;
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

  update public.prompter_products set status = 'ARCHIVED', updated_at = now() where id = p_product_id;
  return query select true, null::text;
end;
$$;

comment on function public.fn_archive_product(uuid) is
  'Batch B9 P2-3 -- moves a product to ARCHIVED, freeing its maxActiveProducts slot. Never deletes the row (no data loss).';

revoke all on function public.fn_archive_product(uuid) from public;
revoke all on function public.fn_archive_product(uuid) from anon;
grant execute on function public.fn_archive_product(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. P0-1 (campaigns) + P2-2 -- canonical "active campaign" definition
--    and its atomic gate.
--
--    Canonical consuming set (per founder decision, adapted to the
--    actual prompter_master_campaigns.status enum -- 'DRAFT',
--    'AWAITING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED',
--    'FAILED' -- which has no ARCHIVED value at all, unlike products):
--      consuming:     ACTIVE, SCHEDULED, AWAITING_APPROVAL, PAUSED
--      not consuming: DRAFT, COMPLETED, FAILED
--    PAUSED counts because prompter_channel_campaigns can resume a
--    paused channel without recreating the master campaign (see
--    features/promote/actions.ts#executeAutopilotAction's PAUSE_CHANNEL
--    action) -- it still occupies real operational capacity.
--
--    The only place application code moves a campaign from a
--    non-consuming state into a consuming one is
--    features/campaigns/actions.ts#submitForApprovalAction (DRAFT ->
--    AWAITING_APPROVAL) -- traced exhaustively in the B9 audit; every
--    other status write in the app moves between two already-consuming
--    states (AWAITING_APPROVAL -> SCHEDULED on approval,
--    SCHEDULED -> ... -> channel-level ACTIVE on launch) or releases a
--    slot (AWAITING_APPROVAL -> DRAFT on reject/cancel). This function
--    is therefore the single enforcement point needed for the campaign
--    cap; it does not replace submitForApprovalAction's other steps
--    (Budget Guard, approval-row creation, audit log), only makes the
--    status transition itself atomic against the cap.
-- ---------------------------------------------------------------------------
create or replace function public.fn_reserve_active_campaign_slot(p_campaign_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_campaign public.prompter_master_campaigns%rowtype;
  v_plan text;
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

  select plan into v_plan from public.prompter_subscriptions where tenant_id = v_tenant_id;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = coalesce(v_plan, 'FREE');
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
  'Batch B9 P0-1/P2-2 -- atomic maxActiveCampaigns gate for the sole DRAFT -> AWAITING_APPROVAL transition in the app (submitForApprovalAction). Consuming set: ACTIVE, SCHEDULED, AWAITING_APPROVAL, PAUSED. Non-consuming: DRAFT, COMPLETED, FAILED.';

revoke all on function public.fn_reserve_active_campaign_slot(uuid) from public;
revoke all on function public.fn_reserve_active_campaign_slot(uuid) from anon;
grant execute on function public.fn_reserve_active_campaign_slot(uuid) to authenticated;
