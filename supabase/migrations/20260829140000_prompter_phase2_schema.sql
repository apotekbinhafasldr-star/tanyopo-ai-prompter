-- Tanyopo AI Promoter — Phase 2 schema (Marketing Operations)
--
-- Additive only, same rules as Phase 0/1: every table is prefixed
-- `prompter_`, foreign-keys into the existing public.tenants, and is
-- scoped by the existing fn_current_tenant_id()/fn_current_role(). No
-- UMKMpro table is touched.

-- ============================================================================
-- prompter_budget_policies
-- One row per tenant (lazily created on first access — see
-- services/budget-guard.ts). Governs the hard limits Budget Guard enforces
-- before a campaign can be submitted for approval. Financial governance,
-- so writes are owner-only (stricter than the owner/marketing pattern used
-- elsewhere in this app).
-- ============================================================================
create table public.prompter_budget_policies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  daily_limit numeric(14, 2),
  monthly_limit numeric(14, 2),
  campaign_limit numeric(14, 2),
  currency text not null default 'IDR',
  require_approval_above numeric(14, 2),
  autopilot_limit numeric(14, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_budget_policies_nonnegative check (
    (daily_limit is null or daily_limit >= 0)
    and (monthly_limit is null or monthly_limit >= 0)
    and (campaign_limit is null or campaign_limit >= 0)
    and (require_approval_above is null or require_approval_above >= 0)
    and (autopilot_limit is null or autopilot_limit >= 0)
  )
);

comment on table public.prompter_budget_policies is
  'Tanyopo AI Promoter: per-tenant spend limits enforced by Budget Guard before campaign submission.';

create trigger trg_prompter_budget_policies_updated_at
  before update on public.prompter_budget_policies
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_budget_policies enable row level security;

create policy "Lihat budget policy tenant sendiri"
  on public.prompter_budget_policies for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner kelola budget policy"
  on public.prompter_budget_policies for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');

-- ============================================================================
-- prompter_channel_campaigns
-- Per-platform breakdown of a Phase 1 master campaign. `status` mirrors
-- the parent master campaign's status (updated together, same action) —
-- independent per-channel status control arrives with real connectors in
-- Phase 3. `external_campaign_id` stays null until a connector actually
-- creates the ad on that platform; nothing in this app writes a fake one.
-- ============================================================================
create table public.prompter_channel_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  master_campaign_id uuid not null references public.prompter_master_campaigns(id) on delete cascade,
  channel text not null check (channel in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X', 'SEO')),
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED')
  ),
  budget_percentage numeric(5, 2),
  external_campaign_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_channel_campaigns_unique unique (master_campaign_id, channel),
  constraint prompter_channel_campaigns_budget_pct_range check (
    budget_percentage is null or (budget_percentage >= 0 and budget_percentage <= 100)
  )
);

comment on table public.prompter_channel_campaigns is
  'Tanyopo AI Promoter: per-channel execution row under a master campaign. external_campaign_id is null until a Phase 3+ connector actually creates the ad.';

create index idx_prompter_channel_campaigns_master on public.prompter_channel_campaigns (master_campaign_id);
create index idx_prompter_channel_campaigns_tenant on public.prompter_channel_campaigns (tenant_id);

create trigger trg_prompter_channel_campaigns_updated_at
  before update on public.prompter_channel_campaigns
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_channel_campaigns enable row level security;

create policy "Lihat channel campaign tenant sendiri"
  on public.prompter_channel_campaigns for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola channel campaign"
  on public.prompter_channel_campaigns for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_approvals
-- Only CAMPAIGN_LAUNCH is created by any code path today (campaign
-- submission — see features/campaigns/actions.ts#submitForApprovalAction).
-- The other types are in the CHECK constraint for forward-compatibility
-- with Phase 2+ features that don't exist yet (budget changes, campaign
-- scaling, content publish, autopilot actions) — the schema doesn't get
-- rewritten when those features land.
-- ============================================================================
create table public.prompter_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  approval_type text not null check (
    approval_type in ('CAMPAIGN_LAUNCH', 'BUDGET_CHANGE', 'CAMPAIGN_SCALE', 'CONTENT_PUBLISH', 'AUTOPILOT_ACTION')
  ),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  resource_type text not null,
  resource_id uuid not null,
  requested_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  reason text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.prompter_approvals is
  'Tanyopo AI Promoter: Approval Center queue. Phase 2 only creates CAMPAIGN_LAUNCH rows.';

create index idx_prompter_approvals_tenant on public.prompter_approvals (tenant_id, status, created_at desc);
create index idx_prompter_approvals_resource on public.prompter_approvals (resource_type, resource_id);

alter table public.prompter_approvals enable row level security;

create policy "Lihat approval tenant sendiri"
  on public.prompter_approvals for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing ajukan approval"
  on public.prompter_approvals for insert
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
    and (requested_by is null or requested_by = auth.uid())
  );

create policy "Owner memutuskan approval"
  on public.prompter_approvals for update
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');

-- ============================================================================
-- prompter_marketing_metrics
-- Normalized daily metrics per channel campaign. Nothing writes to this
-- table yet — no connector exists to pull real ad platform data (Phase 3+)
-- — so /analytics reads it and shows an honest empty state until then.
-- ============================================================================
create table public.prompter_marketing_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  master_campaign_id uuid references public.prompter_master_campaigns(id) on delete cascade,
  channel_campaign_id uuid references public.prompter_channel_campaigns(id) on delete cascade,
  platform text not null check (platform in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X', 'SEO')),
  date date not null,
  spend numeric(14, 2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  engagements bigint not null default 0,
  leads bigint not null default 0,
  conversions bigint not null default 0,
  revenue numeric(14, 2) not null default 0,
  followers_acquired bigint not null default 0,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint prompter_marketing_metrics_unique unique (channel_campaign_id, date)
);

comment on table public.prompter_marketing_metrics is
  'Tanyopo AI Promoter: normalized daily marketing metrics. Empty until a Phase 3+ connector syncs real platform data.';

create index idx_prompter_marketing_metrics_tenant on public.prompter_marketing_metrics (tenant_id, date desc);
create index idx_prompter_marketing_metrics_campaign on public.prompter_marketing_metrics (master_campaign_id);

alter table public.prompter_marketing_metrics enable row level security;

create policy "Lihat marketing metrics tenant sendiri"
  on public.prompter_marketing_metrics for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola marketing metrics"
  on public.prompter_marketing_metrics for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_conversions
-- Phase 2 only supports manual entry (a business owner logging a sale they
-- know came from a campaign) — there is no ad-platform conversion API or
-- UMKMpro conversion bridge yet (Phase 4).
-- ============================================================================
create table public.prompter_conversions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  master_campaign_id uuid references public.prompter_master_campaigns(id) on delete set null,
  channel_campaign_id uuid references public.prompter_channel_campaigns(id) on delete set null,
  customer_reference text,
  order_reference text,
  source text not null default 'manual',
  event_type text not null check (
    event_type in ('LEAD', 'SIGNUP', 'ADD_TO_CART', 'CHECKOUT', 'PURCHASE', 'SUBSCRIPTION')
  ),
  value numeric(14, 2),
  currency text not null default 'IDR',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.prompter_conversions is
  'Tanyopo AI Promoter: conversion events. Phase 2 — manual entry only (source defaults to manual).';

create index idx_prompter_conversions_tenant on public.prompter_conversions (tenant_id, occurred_at desc);
create index idx_prompter_conversions_campaign on public.prompter_conversions (master_campaign_id);

alter table public.prompter_conversions enable row level security;

create policy "Lihat konversi tenant sendiri"
  on public.prompter_conversions for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola konversi"
  on public.prompter_conversions for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_attributions
-- Schema only in Phase 2 — nothing writes to this table yet. Modeling it
-- now (rather than bolting it on later) is what lets future attribution
-- models plug in without a schema migration on launch day.
-- ============================================================================
create table public.prompter_attributions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversion_id uuid not null references public.prompter_conversions(id) on delete cascade,
  master_campaign_id uuid references public.prompter_master_campaigns(id) on delete set null,
  channel_campaign_id uuid references public.prompter_channel_campaigns(id) on delete set null,
  touchpoint_type text,
  attribution_model text not null default 'MANUAL' check (
    attribution_model in ('LAST_CLICK', 'FIRST_CLICK', 'MANUAL', 'UMKMPRO_VERIFIED')
  ),
  weight numeric(5, 2) not null default 100,
  attributed_value numeric(14, 2),
  confidence numeric(5, 2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint prompter_attributions_weight_range check (weight >= 0 and weight <= 100),
  constraint prompter_attributions_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 100))
);

comment on table public.prompter_attributions is
  'Tanyopo AI Promoter: attribution schema, forward-compatible for future models. Not yet written by any code path.';

create index idx_prompter_attributions_tenant on public.prompter_attributions (tenant_id);
create index idx_prompter_attributions_conversion on public.prompter_attributions (conversion_id);

alter table public.prompter_attributions enable row level security;

create policy "Lihat atribusi tenant sendiri"
  on public.prompter_attributions for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola atribusi"
  on public.prompter_attributions for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));
