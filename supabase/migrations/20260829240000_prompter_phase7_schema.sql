-- Tanyopo AI Promoter — Phase 7 schema (Advanced AI)
--
-- Additive only, same rules as Phase 0-6. No UMKMpro table is touched.
--
-- Write access on every new table below follows the pattern the risk
-- level of the data calls for: analytics_insights/optimization_recommendations
-- follow the Phase 1 pattern (owner/marketing write — they don't move
-- money or spend on their own, they're AI-generated suggestions for
-- review); autopilot_policies follows the stricter Phase 2 budget_policies
-- pattern (owner-only — this table gates whether an AI suggestion gets
-- auto-routed to the Approval Center without an extra manual click).

-- ============================================================================
-- prompter_ai_jobs.job_type gains two Phase 7 generation types
-- ============================================================================
alter table public.prompter_ai_jobs drop constraint prompter_ai_jobs_job_type_check;

alter table public.prompter_ai_jobs add constraint prompter_ai_jobs_job_type_check
  check (job_type in (
    'MARKETING_BLUEPRINT', 'CAMPAIGN_PROPOSAL', 'CONTENT_GENERATION',
    'SEO_RECOMMENDATIONS', 'ANALYTICS_INSIGHT', 'OPTIMIZATION_RECOMMENDATION'
  ));

-- ============================================================================
-- prompter_analytics_insights
-- One row per tenant (unique(tenant_id), upserted on regenerate — same
-- pattern as prompter_marketing_blueprints/prompter_seo_recommendations).
-- Generation is only ever offered by the app when real
-- prompter_marketing_metrics or prompter_conversions data exists for the
-- tenant — see features/analytics/actions.ts. This table is the backing
-- store for the "Tanyopo Intelligence" card (dashboard + /analytics),
-- replacing its Phase 0 always-empty stub with real, persisted output.
-- ============================================================================
create table public.prompter_analytics_insights (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  summary text,
  trends jsonb not null default '[]'::jsonb,
  top_channel text,
  underperforming_channels jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  ai_job_id uuid references public.prompter_ai_jobs(id) on delete set null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prompter_analytics_insights is
  'Tanyopo AI Promoter: one AI-generated performance summary per tenant, upserted on regenerate. Only ever generated from real metrics/conversions data.';

create trigger trg_prompter_analytics_insights_updated_at
  before update on public.prompter_analytics_insights
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_analytics_insights enable row level security;

create policy "Lihat analytics insight tenant sendiri"
  on public.prompter_analytics_insights for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola analytics insight"
  on public.prompter_analytics_insights for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_optimization_recommendations
-- One row per master campaign (unique(master_campaign_id), upserted on
-- regenerate). AI compares that campaign's own channel_campaigns against
-- each other — "cross-channel recommendations" scoped to one campaign's
-- channels, a well-defined comparison rather than a fuzzy tenant-wide one
-- across unrelated campaigns. `recommendations` is an array of
-- {channel, action_type, rationale, suggested_daily_budget}; a human (or,
-- policy-gated, the system itself) can submit one as a
-- prompter_approvals row — see prompter_autopilot_policies below and
-- features/campaigns/optimization-actions.ts. This table never causes a
-- budget change or pause on its own; it only ever proposes one.
-- ============================================================================
create table public.prompter_optimization_recommendations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  master_campaign_id uuid not null references public.prompter_master_campaigns(id) on delete cascade,
  summary text,
  recommendations jsonb not null default '[]'::jsonb,
  ai_job_id uuid references public.prompter_ai_jobs(id) on delete set null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_optimization_recommendations_campaign_unique unique (master_campaign_id)
);

comment on table public.prompter_optimization_recommendations is
  'Tanyopo AI Promoter: AI-generated cross-channel budget/pause suggestions for one campaign. A suggestion, never an executed action.';

create trigger trg_prompter_optimization_recommendations_updated_at
  before update on public.prompter_optimization_recommendations
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_optimization_recommendations enable row level security;

create policy "Lihat optimization recommendation tenant sendiri"
  on public.prompter_optimization_recommendations for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola optimization recommendation"
  on public.prompter_optimization_recommendations for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_autopilot_policies
-- One row per tenant per policy_type (unique(tenant_id, policy_type)).
-- Owner-only write — same stricter pattern as prompter_budget_policies,
-- since this table governs whether an AI suggestion gets auto-routed to
-- the Approval Center without a human clicking "submit" first. Enabling a
-- policy is real automation-scope authorization (product spec's "tenant
-- authorization" boundary on Autopilot); it never grants direct
-- execution — every action still lands in prompter_approvals and still
-- requires an owner's APPROVED decision before anything calls out to a
-- real ad platform. See docs/SECURITY.md "Automation safety" for the
-- full boundary list this table is one part of.
-- ============================================================================
create table public.prompter_autopilot_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_type text not null check (
    policy_type in ('AUTO_PAUSE_UNDERPERFORMING', 'AUTO_PROPOSE_BUDGET_REALLOCATION')
  ),
  enabled boolean not null default false,
  threshold_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_autopilot_policies_unique unique (tenant_id, policy_type)
);

comment on table public.prompter_autopilot_policies is
  'Tanyopo AI Promoter: per-tenant autopilot policy toggles. Enabling one only auto-routes a matching AI suggestion to the Approval Center — it never grants direct execution.';

create trigger trg_prompter_autopilot_policies_updated_at
  before update on public.prompter_autopilot_policies
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_autopilot_policies enable row level security;

create policy "Lihat autopilot policy tenant sendiri"
  on public.prompter_autopilot_policies for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner kelola autopilot policy"
  on public.prompter_autopilot_policies for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');
