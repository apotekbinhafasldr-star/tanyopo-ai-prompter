-- Tanyopo AI Promoter — Global Edition foundation schema.
--
-- Additive only, non-destructive, forward-only. Every new column is
-- nullable (or has a safe default) and every existing Indonesia tenant
-- is explicitly backfilled to preserve current behavior -- no tenant is
-- forced to reconfigure anything. No UMKMpro table is touched.

-- ============================================================================
-- prompter_brand_profiles: business home market fields.
-- default_language/default_currency/default_timezone already existed
-- (Phase 0) -- country_code/region/billing_country are the missing
-- pieces to make "business home market" explicit and structured.
-- ============================================================================
alter table public.prompter_brand_profiles
  add column if not exists country_code text,
  add column if not exists region text,
  add column if not exists billing_country text;

update public.prompter_brand_profiles
  set country_code = 'ID'
  where country_code is null;

update public.prompter_brand_profiles
  set billing_country = country_code
  where billing_country is null;

comment on column public.prompter_brand_profiles.country_code is
  'ISO 3166-1 alpha-2. Business home market. Backfilled to ID for every tenant that existed before Global Edition.';

-- ============================================================================
-- prompter_products: global product/offer fields (product spec §7).
-- price/currency already existed (Phase 0/1) -- target_countries/language
-- are additive.
-- ============================================================================
alter table public.prompter_products
  add column if not exists target_countries jsonb not null default '[]'::jsonb,
  add column if not exists language text;

comment on column public.prompter_products.target_countries is
  'Array of ISO 3166-1 alpha-2 codes this product/offer is marketed toward. Empty array (default) means "not yet set", never assumed to mean "everywhere".';

-- ============================================================================
-- prompter_master_campaigns: campaign target market fields.
-- target_country/target_region/target_city/currency already existed
-- (Phase 0/1) -- target_language/target_currency close the gap so a
-- campaign's target market is fully distinguishable from the business
-- home market (product spec §8: "Business country: Indonesia, Target
-- campaign market: Malaysia" must be representable).
-- ============================================================================
alter table public.prompter_master_campaigns
  add column if not exists target_language text,
  add column if not exists target_currency text;

-- ============================================================================
-- prompter_seo_projects: market fields.
-- ============================================================================
alter table public.prompter_seo_projects
  add column if not exists country_code text,
  add column if not exists language text;

-- ============================================================================
-- prompter_platform_capabilities: capability-by-market (product spec §11).
-- Changes the primary key from (platform, capability) to (platform,
-- capability, country_code) so a future region-specific override row can
-- coexist with the global default. country_code uses '' (empty string,
-- not NULL -- primary key columns can't be NULL) as the "applies to
-- every market" sentinel; every one of the 21 existing seeded rows gets
-- backfilled to '' so their meaning is completely unchanged. No
-- region-specific capability row is seeded in this migration -- doing
-- so honestly would require verified per-region platform documentation,
-- which this pass does not fabricate.
-- ============================================================================
alter table public.prompter_platform_capabilities
  add column if not exists country_code text not null default '';

alter table public.prompter_platform_capabilities drop constraint if exists prompter_platform_capabilities_pkey;
alter table public.prompter_platform_capabilities add primary key (platform, capability, country_code);

alter table public.prompter_platform_capabilities
  add column if not exists status text;

update public.prompter_platform_capabilities
  set status = case when enabled then 'SUPPORTED' else 'UNSUPPORTED' end
  where status is null;

alter table public.prompter_platform_capabilities
  alter column status set not null,
  alter column status set default 'NOT_CONFIGURED';

alter table public.prompter_platform_capabilities
  add constraint prompter_platform_capabilities_status_check
  check (status in ('SUPPORTED', 'UNSUPPORTED', 'NOT_CONFIGURED', 'BLOCKED_EXTERNAL', 'REQUIRES_APPROVAL'));

comment on column public.prompter_platform_capabilities.country_code is
  'ISO 3166-1 alpha-2, or '''' (empty string) meaning "applies globally". Never NULL -- NULL cannot be a primary key column.';
comment on column public.prompter_platform_capabilities.status is
  'Honest capability status (product spec §11). enabled (legacy boolean) is kept in sync for backward compatibility but status is the source of truth going forward.';

-- ============================================================================
-- prompter_attributions: currency (product spec §14 -- attribution must
-- preserve currency context, same as prompter_conversions already does).
-- Backfilled from the linked conversion's currency where one exists.
-- ============================================================================
alter table public.prompter_attributions
  add column if not exists currency text;

update public.prompter_attributions a
  set currency = c.currency
  from public.prompter_conversions c
  where a.conversion_id = c.id and a.currency is null;

-- ============================================================================
-- prompter_subscriptions / prompter_invoices: regional billing metadata
-- (product spec §15). No tax logic, no invented VAT/GST/PPh -- metadata
-- placeholders only, all null/empty by default.
-- ============================================================================
alter table public.prompter_subscriptions
  add column if not exists billing_country text,
  add column if not exists invoice_currency text,
  add column if not exists payment_provider_customer_reference text,
  add column if not exists tax_metadata jsonb not null default '{}'::jsonb;

alter table public.prompter_invoices
  add column if not exists billing_country text;

-- ============================================================================
-- prompter_compliance_flags (product spec §16): a provider-neutral
-- compliance READINESS layer, not a compliance engine. Never claims
-- "fully compliant" -- only ever one of the four honest statuses below.
-- ============================================================================
create table if not exists public.prompter_compliance_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- ISO 3166-1 alpha-2, or null meaning "applies to every market this tenant targets".
  market_country_code text,
  flag_type text not null check (flag_type in (
    'DATA_RESIDENCY', 'MARKETING_CONSENT', 'AGE_SENSITIVE_PRODUCT',
    'REGULATED_PRODUCT', 'PLATFORM_AD_RESTRICTION', 'TERMS_PRIVACY_LINK'
  )),
  status text not null default 'NOT_CONFIGURED' check (
    status in ('COMPLIANCE_REVIEW_REQUIRED', 'SUPPORTED', 'RESTRICTED', 'NOT_CONFIGURED')
  ),
  notes text,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prompter_compliance_flags is
  'Tanyopo AI Promoter: provider-neutral compliance readiness metadata (product spec §16). Never asserts "fully compliant" -- only COMPLIANCE_REVIEW_REQUIRED / SUPPORTED / RESTRICTED / NOT_CONFIGURED.';

create index if not exists idx_prompter_compliance_flags_tenant on public.prompter_compliance_flags (tenant_id);

drop trigger if exists trg_prompter_compliance_flags_updated_at on public.prompter_compliance_flags;
create trigger trg_prompter_compliance_flags_updated_at
  before update on public.prompter_compliance_flags
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_compliance_flags enable row level security;

drop policy if exists "Lihat compliance flag tenant sendiri" on public.prompter_compliance_flags;
create policy "Lihat compliance flag tenant sendiri"
  on public.prompter_compliance_flags for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner kelola compliance flag" on public.prompter_compliance_flags;
create policy "Owner kelola compliance flag"
  on public.prompter_compliance_flags for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');

-- ============================================================================
-- prompter_feature_flags (product spec §21): per-tenant opt-in rollout
-- control. Absence of a row means the flag is OFF -- an existing tenant
-- with no rows is unaffected by any Global Edition feature until it
-- explicitly opts in (app-layer default in lib/feature-flags.ts).
-- ============================================================================
create table if not exists public.prompter_feature_flags (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  flag_key text not null check (flag_key in (
    'global_onboarding', 'multi_currency', 'market_targeting', 'english_ui',
    'regional_capabilities', 'global_billing', 'global_analytics_dimensions'
  )),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, flag_key)
);

comment on table public.prompter_feature_flags is
  'Tanyopo AI Promoter: per-tenant Global Edition feature flags. A missing row means OFF -- existing tenants are never auto-enrolled.';

drop trigger if exists trg_prompter_feature_flags_updated_at on public.prompter_feature_flags;
create trigger trg_prompter_feature_flags_updated_at
  before update on public.prompter_feature_flags
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_feature_flags enable row level security;

drop policy if exists "Lihat feature flag tenant sendiri" on public.prompter_feature_flags;
create policy "Lihat feature flag tenant sendiri"
  on public.prompter_feature_flags for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner kelola feature flag" on public.prompter_feature_flags;
create policy "Owner kelola feature flag"
  on public.prompter_feature_flags for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');
