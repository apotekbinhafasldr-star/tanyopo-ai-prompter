-- ============================================================================
-- 10_migrations_part_3.sql  (bagian 3 dari 8)  -- SANDBOX DOKU SAJA
-- Migrasi 15 s/d 27 dari 49:  20260901135021_prompter_global_edition_foundation.sql  ...  20260915043800_prompter_b9_entitlement_enforcement.sql
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- File ini DIBANGUN OTOMATIS oleh tools/build_bundles.py; isi migrasi disalin apa adanya.
-- Jalankan HANYA di project sandbox (cek ref di URL dashboard), SETELAH 00 PASS dan 01 sukses,
-- dan berurutan (bagian 3 butuh 14 migrasi sudah tercatat). Satu transaksi: gagal = tidak ada yang terpasang.
-- ============================================================================
begin;
do $guard$
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: marker sandbox tidak ada. Bukan project sandbox / 01_shim belum dijalankan.';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('products', 'product_batches', 'warehouses', 'warehouse_stock', 'inventory_movements', 'purchase_orders', 'transactions', 'transaction_items', 'online_orders', 'pesanan_meja', 'receivables', 'employees', 'attendance', 'payroll_notes', 'kontrak_karyawan', 'leave_requests')) then
    raise exception 'ABORT: tabel UMKMpro terdeteksi -> kemungkinan project PRODUCTION. Berhenti.';
  end if;
  if (select count(*) from public._linoe_sandbox_applied) <> 14 then
    raise exception 'ABORT: urutan salah. Harus ada 14 migrasi tercatat sebelum bagian ini.';
  end if;
end $guard$;

-- >>> 20260901135021_prompter_global_edition_foundation.sql  sha256=5ba01dedd79145b0c1c60ab58ae150398e302cab95e86f2330ef452346208946
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
insert into public._linoe_sandbox_applied (version, sha256) values ('20260901135021', '5ba01dedd79145b0c1c60ab58ae150398e302cab95e86f2330ef452346208946');

-- >>> 20260901141241_prompter_global_marketing_blueprint.sql  sha256=211d38fd5e71478f5f97baf17d9e622a2d4b8367898e42dfb0d1dfcb4a06b9ff
-- Tanyopo AI Promoter — Global Edition: Marketing Blueprint localization fields.
--
-- Additive only. All nullable/empty-default -- every existing blueprint
-- row (if any) keeps working with these simply unset, and reading an
-- old blueprint back never breaks because a new field is missing.
--
-- home_market/target_markets/target_languages/target_currency are
-- metadata computed server-side from real tenant/product data
-- (prompter_brand_profiles.country_code, prompter_products.target_countries/
-- currency) at generation time -- never asked of or invented by the AI.
-- localization_strategy is the one genuinely AI-reasoned addition
-- (product spec §9-10): how to adapt positioning/content for the
-- target market(s), not a factual claim.
alter table public.prompter_marketing_blueprints
  add column if not exists home_market text,
  add column if not exists target_markets jsonb not null default '[]'::jsonb,
  add column if not exists target_languages jsonb not null default '[]'::jsonb,
  add column if not exists target_currency text,
  add column if not exists localization_strategy text;

comment on column public.prompter_marketing_blueprints.localization_strategy is
  'AI-generated reasoning on adapting this blueprint for its target market(s) -- never a legal/compliance claim, never fabricated local statistics, never a promised result.';
insert into public._linoe_sandbox_applied (version, sha256) values ('20260901141241', '211d38fd5e71478f5f97baf17d9e622a2d4b8367898e42dfb0d1dfcb4a06b9ff');

-- >>> 20260901142211_prompter_compliance_flags_global_unique.sql  sha256=083d82ee984e276ad595263466ec6612baed0ea9ba20d1e8e40fca600b351c6c
-- Tanyopo AI Promoter — unique index needed for upsert on the global
-- (market_country_code is null) compliance flag case, which is the only
-- one the app writes to in this pass (features/settings/actions.ts#updateComplianceFlagAction).
-- Additive, non-destructive -- no existing row can violate this (the
-- table was created empty in the same migration pass and has 0 rows).
--
-- Superseded by 20260901142236_prompter_compliance_flags_market_sentinel.sql
-- (a partial index can't be targeted by PostgREST's upsert onConflict,
-- which doesn't emit a matching WHERE clause) -- kept here, dropped
-- there, to match the live ledger's real applied history exactly.
create unique index if not exists idx_prompter_compliance_flags_global_unique
  on public.prompter_compliance_flags (tenant_id, flag_type)
  where market_country_code is null;
insert into public._linoe_sandbox_applied (version, sha256) values ('20260901142211', '083d82ee984e276ad595263466ec6612baed0ea9ba20d1e8e40fca600b351c6c');

-- >>> 20260901142236_prompter_compliance_flags_market_sentinel.sql  sha256=9e1ba45a5a65a9a5190020ddbff4126d5554c3de76dffc32330c6227598e0082
-- Tanyopo AI Promoter — fixes the compliance flags uniqueness approach.
-- A partial unique index (WHERE market_country_code IS NULL) can't be
-- targeted by PostgREST's upsert onConflict (which emits a plain
-- ON CONFLICT (cols) with no WHERE clause, so Postgres can't infer the
-- partial index as the arbiter). Switches to the same non-NULL empty-
-- string sentinel already used by prompter_platform_capabilities.country_code
-- ('' = "applies globally") so a plain full unique constraint works.
-- Additive/non-destructive -- table has 0 rows.
drop index if exists idx_prompter_compliance_flags_global_unique;

alter table public.prompter_compliance_flags
  alter column market_country_code set default '',
  alter column market_country_code set not null;

update public.prompter_compliance_flags set market_country_code = '' where market_country_code is null;

alter table public.prompter_compliance_flags
  add constraint prompter_compliance_flags_unique unique (tenant_id, market_country_code, flag_type);

comment on column public.prompter_compliance_flags.market_country_code is
  'ISO 3166-1 alpha-2, or '''' (empty string) meaning "applies to every market this tenant targets". Never NULL -- kept non-NULL so a plain unique constraint (not a partial index) backs upsert.';
insert into public._linoe_sandbox_applied (version, sha256) values ('20260901142236', '9e1ba45a5a65a9a5190020ddbff4126d5554c3de76dffc32330c6227598e0082');

-- >>> 20260906061202_prompter_product_stock_unit.sql  sha256=b76bbd5b9f61a5824091e2e4ed5592600f91341e47699faf6c9000695269a6ec
-- Additive only: adds an optional unit label ("pcs", "box", "kg", ...) next
-- to prompter_products.stock. Nullable, no default backfill needed — every
-- existing product simply has stock_unit = null, which the app already
-- renders as a bare number (see features/products), so this is a
-- zero-downtime, fully backward-compatible change. Not destructive: no
-- column is dropped, renamed, or narrowed, and no existing row is rewritten.
alter table public.prompter_products
  add column if not exists stock_unit text;

comment on column public.prompter_products.stock_unit is
  'Optional free-text unit label for `stock` (e.g. pcs, box, kg). Null on rows created before this column existed and on products with no stock unit set — the app falls back to showing the bare stock number.';
insert into public._linoe_sandbox_applied (version, sha256) values ('20260906061202', 'b76bbd5b9f61a5824091e2e4ed5592600f91341e47699faf6c9000695269a6ec');

-- >>> 20260909073321_prompter_channel_campaigns_add_scheduled_at.sql  sha256=d862671cd713f692e4cfe1380143be265b968a90020287d34ba55da9e1444621
-- ============================================================================
-- Batch B3 (correction) — Smart Scheduling Recommendation, extended to the
-- Golden Path's own Review Campaign step. Adds a per-channel schedule to
-- prompter_channel_campaigns (channel_campaigns), the row B2 already uses
-- for per-channel selection/budget — no parallel table, and no change to
-- prompter_master_campaigns.start_date (a plain `date` column used
-- elsewhere) so every existing campaign renders exactly as before. Purely
-- additive: nullable column, no backfill, no data migration.
-- ============================================================================

alter table public.prompter_channel_campaigns add column if not exists scheduled_at timestamptz;

comment on column public.prompter_channel_campaigns.scheduled_at is
  'Batch B3: real UTC instant this channel is scheduled to publish/launch at, chosen from LINOE''s Smart Scheduling recommendation or set manually by the owner. Null until scheduled. Independent per channel — Instagram and Facebook under the same campaign can carry different times.';
insert into public._linoe_sandbox_applied (version, sha256) values ('20260909073321', 'd862671cd713f692e4cfe1380143be265b968a90020287d34ba55da9e1444621');

-- >>> 20260909100910_prompter_master_campaigns_add_selected_media.sql  sha256=fccca85c0eb052df334f12623fc1581cd9898c7612b02ceb22f599cd23d7e2ea
-- ============================================================================
-- Batch B4 — Media Workflow. Lets a campaign remember which of its
-- product's already-uploaded media (prompter_product_media, Phase 1) is
-- the one selected for promotion, instead of building a parallel
-- campaign-media table. Nullable and additive:
-- - Existing campaigns default to null, which the app reads as "use the
--   product's first media" (or "no media yet" if the product has none) —
--   no backfill needed, no behavior change for any row until an owner
--   explicitly picks a different one.
-- - `on delete set null` so deleting a product media row (already-existing
--   deleteProductMediaAction) never leaves a dangling reference.
-- ============================================================================

alter table public.prompter_master_campaigns
  add column if not exists selected_media_id uuid references public.prompter_product_media(id) on delete set null;

comment on column public.prompter_master_campaigns.selected_media_id is
  'Batch B4: which prompter_product_media row this campaign uses as its promotional creative. Null = inherit the product''s first media (or none, if the product has no media yet) — media stays optional throughout Quick Promote.';
insert into public._linoe_sandbox_applied (version, sha256) values ('20260909100910', 'fccca85c0eb052df334f12623fc1581cd9898c7612b02ceb22f599cd23d7e2ea');

-- >>> 20260909141526_prompter_seo_discovery_no_website.sql  sha256=2904e9759a293b2920d8a0666658f0b6af160bdc4603ada537f0097ecc18559e
-- ============================================================================
-- Batch B5 — SEO & Discovery without a website. Additive only: loosens one
-- NOT NULL constraint (no data loss — every existing row already has a
-- real website_url) and adds nullable columns with safe defaults. No new
-- table, reusing prompter_seo_projects/prompter_seo_recommendations as the
-- single home for both modes, and prompter_brand_profiles for the one
-- piece of durable contact context (WhatsApp) this batch needs that had
-- no existing home.
-- ============================================================================

alter table public.prompter_seo_projects
  alter column website_url drop not null,
  add column if not exists discovery_mode text not null default 'WEBSITE'
    check (discovery_mode in ('WEBSITE', 'NO_WEBSITE')),
  add column if not exists product_id uuid references public.prompter_products(id) on delete set null;

comment on column public.prompter_seo_projects.discovery_mode is
  'Batch B5: WEBSITE keeps the existing website-SEO flow (website_url required at the app layer); NO_WEBSITE is discovery via social/marketplace instead — website_url stays null for those rows.';
comment on column public.prompter_seo_projects.product_id is
  'Batch B5: optional link back to the product this project was opened from, so context (name/description/category/target market) can be re-inherited without asking again on a later visit or regenerate.';

alter table public.prompter_seo_recommendations
  add column if not exists discovery_recommendations jsonb;

comment on column public.prompter_seo_recommendations.discovery_recommendations is
  'Batch B5: structured AI output for a NO_WEBSITE project (keywords, profile/bio tips, content ideas, hashtags, CTA, recommended discovery channels). Null for WEBSITE-mode rows, which keep using the existing on_page_recommendations/content_plan columns unchanged.';

alter table public.prompter_brand_profiles
  add column if not exists whatsapp_number text;

comment on column public.prompter_brand_profiles.whatsapp_number is
  'Batch B5: tenant contact number/link, used only as CTA/contact context in AI recommendations (e.g. "arahkan ke WhatsApp Anda"). Never used to send a message — no WhatsApp API/automation exists in this app.';
insert into public._linoe_sandbox_applied (version, sha256) values ('20260909141526', '2904e9759a293b2920d8a0666658f0b6af160bdc4603ada537f0097ecc18559e');

-- >>> 20260909164100_prompter_growth_recommendation_job_type.sql  sha256=ecdc6a2c89cf124d0a4c936215e5ba357dfaa4bb99d15f5f72d6d7f49a34e48d
alter table public.prompter_ai_jobs drop constraint if exists prompter_ai_jobs_job_type_check;

alter table public.prompter_ai_jobs add constraint prompter_ai_jobs_job_type_check
  check (job_type in (
    'MARKETING_BLUEPRINT', 'CAMPAIGN_PROPOSAL', 'CONTENT_GENERATION',
    'SEO_RECOMMENDATIONS', 'ANALYTICS_INSIGHT', 'OPTIMIZATION_RECOMMENDATION',
    'GROWTH_RECOMMENDATION'
  ));
insert into public._linoe_sandbox_applied (version, sha256) values ('20260909164100', 'ecdc6a2c89cf124d0a4c936215e5ba357dfaa4bb99d15f5f72d6d7f49a34e48d');

-- >>> 20260910060428_revert_unused_growth_recommendation_job_type.sql  sha256=9944ffdb9210b491f6b645a3f62a868085d8e61059ee98f223427fc04fbc0c2f
alter table public.prompter_ai_jobs drop constraint if exists prompter_ai_jobs_job_type_check;

alter table public.prompter_ai_jobs add constraint prompter_ai_jobs_job_type_check
  check (job_type in (
    'MARKETING_BLUEPRINT', 'CAMPAIGN_PROPOSAL', 'CONTENT_GENERATION',
    'SEO_RECOMMENDATIONS', 'ANALYTICS_INSIGHT', 'OPTIMIZATION_RECOMMENDATION'
  ));
insert into public._linoe_sandbox_applied (version, sha256) values ('20260910060428', '9944ffdb9210b491f6b645a3f62a868085d8e61059ee98f223427fc04fbc0c2f');

-- >>> 20260910072819_prompter_subscriptions_add_starter_plan.sql  sha256=e33bdccda42a6b15aca26e5f14fbe2546a5acc0b111f55dff1bb991a4db1dd45
-- Batch B8 — LINOE Pricing v1.0 introduces "Starter" as a real plan tier
-- between Free Trial and Growth. Additive only: widens the existing plan
-- check constraint, no RLS change, no data migration, no existing row
-- touched (every current row keeps whatever plan it already has).
alter table public.prompter_subscriptions drop constraint if exists prompter_subscriptions_plan_check;

alter table public.prompter_subscriptions add constraint prompter_subscriptions_plan_check
  check (plan in ('FREE', 'STARTER', 'PRO', 'BUSINESS', 'GROWTH', 'AGENCY', 'UMKMPRO_BUNDLE'));
insert into public._linoe_sandbox_applied (version, sha256) values ('20260910072819', 'e33bdccda42a6b15aca26e5f14fbe2546a5acc0b111f55dff1bb991a4db1dd45');

-- >>> 20260913163600_prompter_track_b_meta_page_picker.sql  sha256=902016257bcbf91dee456eb0a91035cbe7caa8b6a16599845fce60435811bf6a
-- Track B — Meta Page Picker.
--
-- Additive only: two new nullable columns on the existing
-- prompter_connected_accounts table, no new table, no RLS change, no
-- backfill needed. Existing rows get NULL for both (== "no Page selected
-- yet"), which is exactly today's behavior — lib/connectors/meta-connector.ts
-- #createCreative() already throws a clear, existing error when no pageId
-- is supplied, so a tenant that never selects a Page sees the same
-- behavior as before this migration.
--
-- Why these live on prompter_connected_accounts rather than a new table:
-- a selected Facebook Page is 1:1 with a tenant's Meta connection (one ad
-- account connection, one Page used for ad creatives), exactly like
-- external_account_id/external_account_name already do for the ad
-- account itself. No new RLS policy is needed either — the existing
-- "Owner kelola koneksi platform" policy on this table is a for-all-columns
-- USING/WITH CHECK on (tenant_id, role), so it already covers these two
-- new columns for both read and write.
alter table public.prompter_connected_accounts
  add column if not exists selected_page_id text,
  add column if not exists selected_page_name text;

comment on column public.prompter_connected_accounts.selected_page_id is
  'Track B — the Facebook Page id (from Meta''s /me/accounts) an Owner has selected to run ad creatives as. NULL means no Page selected yet. Never trust a client-supplied value for this column directly: features/connections/actions.ts#selectMetaPageAction() only ever persists an id that was just re-verified against a live /me/accounts call using the tenant''s own token.';

comment on column public.prompter_connected_accounts.selected_page_name is
  'Track B — display-only cache of the selected Page''s name at selection time, so the Connections UI does not need a live Graph API call just to render it. Never used for authorization — only selected_page_id is passed to the Graph API.';
insert into public._linoe_sandbox_applied (version, sha256) values ('20260913163600', '902016257bcbf91dee456eb0a91035cbe7caa8b6a16599845fce60435811bf6a');

-- >>> 20260915043800_prompter_b9_entitlement_enforcement.sql  sha256=7aa9e03e0a2576afd317ad12130eeacd03d22d46ae1097953afb1728191cefb0
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
insert into public._linoe_sandbox_applied (version, sha256) values ('20260915043800', '7aa9e03e0a2576afd317ad12130eeacd03d22d46ae1097953afb1728191cefb0');

commit;
