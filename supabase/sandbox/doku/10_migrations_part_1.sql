-- ============================================================================
-- 10_migrations_part_1.sql  (bagian 1 dari 8)  -- SANDBOX DOKU SAJA
-- Migrasi 1 s/d 6 dari 49:  20260829080127_prompter_foundation_schema.sql  ...  20260829102947_prompter_channel_campaigns_add_error.sql
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- File ini DIBANGUN OTOMATIS oleh tools/build_bundles.py; isi migrasi disalin apa adanya.
-- Jalankan HANYA di project sandbox (cek ref di URL dashboard), SETELAH 00 PASS dan 01 sukses,
-- dan berurutan (bagian 1 butuh 0 migrasi sudah tercatat). Satu transaksi: gagal = tidak ada yang terpasang.
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
  if (select count(*) from public._linoe_sandbox_applied) <> 0 then
    raise exception 'ABORT: urutan salah. Harus ada 0 migrasi tercatat sebelum bagian ini.';
  end if;
end $guard$;

-- >>> 20260829080127_prompter_foundation_schema.sql  sha256=68deade554b45b338699f96634bb82c45d9d540f0c4cea6973d9b7468438e63a
-- Tanyopo AI Promoter — Phase 0 foundation schema
--
-- This migration is ADDITIVE ONLY. It creates new tables, all prefixed
-- `prompter_`, in the existing shared Supabase project used by UMKMpro AI.
-- It does not alter, rename, or drop any pre-existing UMKMpro table,
-- column, function, or policy.
--
-- Tenancy model: Tanyopo AI Promoter reuses the UMKMpro AI identity layer
-- (`public.tenants`, `public.user_profiles`, `auth.users`) instead of
-- introducing a parallel organizations/members schema. Every Promoter table
-- carries `tenant_id references public.tenants(id)` and is scoped with the
-- existing `public.fn_current_tenant_id()` / `public.fn_current_role()`
-- helper functions so RLS behaves identically to the rest of the platform.

-- ============================================================================
-- Helper: updated_at trigger (local to prompter_ tables; does not touch the
-- `moddatetime` extension or any UMKMpro trigger function).
-- ============================================================================
create or replace function public.prompter_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- prompter_brand_profiles
-- One row per tenant. Captures the Promoter-specific brand/business context
-- (section 61 "Brand Profile", section 68 onboarding) that AI generation
-- uses as context. Distinct from `public.tenants`, which is UMKMpro's own
-- business record — this table only stores marketing-relevant fields.
-- ============================================================================
create table public.prompter_brand_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  brand_name text,
  business_description text,
  what_do_you_sell text,
  business_category text check (
    business_category is null or business_category in (
      'PHYSICAL_PRODUCT', 'SERVICE', 'APPLICATION', 'SUBSCRIPTION', 'DIGITAL_PRODUCT'
    )
  ),
  primary_goal text check (
    primary_goal is null or primary_goal in (
      'INCREASE_SALES', 'GET_LEADS', 'INCREASE_FOLLOWERS',
      'BRAND_AWARENESS', 'WEBSITE_TRAFFIC', 'PROMOTE_APP'
    )
  ),
  tone_of_voice text,
  target_market text,
  prohibited_claims text,
  default_language text not null default 'id' check (default_language in ('id', 'en')),
  default_location text,
  default_currency text not null default 'IDR',
  default_timezone text not null default 'Asia/Jakarta',
  logo_url text,
  website_url text,
  onboarding_completed boolean not null default false,
  onboarding_step smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prompter_brand_profiles is
  'Tanyopo AI Promoter: per-tenant brand/marketing profile used as AI context. One row per tenant.';

create trigger trg_prompter_brand_profiles_updated_at
  before update on public.prompter_brand_profiles
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_brand_profiles enable row level security;

create policy "Lihat brand profile tenant sendiri"
  on public.prompter_brand_profiles for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Buat brand profile tenant sendiri"
  on public.prompter_brand_profiles for insert
  with check (tenant_id = public.fn_current_tenant_id());

create policy "Owner atau marketing bisa edit brand profile"
  on public.prompter_brand_profiles for update
  using (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
  )
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
  );

-- ============================================================================
-- prompter_automation_settings
-- One row per tenant. Governs Manual / AI Assist / Autopilot mode and the
-- emergency stop switch (sections 40-41). Defaults are the safest possible
-- state: manual mode, automation off, no autopilot budget.
-- ============================================================================
create table public.prompter_automation_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  automation_mode text not null default 'manual' check (
    automation_mode in ('manual', 'ai_assist', 'autopilot')
  ),
  autopilot_daily_limit numeric(14, 2),
  emergency_stop_active boolean not null default false,
  emergency_stop_activated_at timestamptz,
  emergency_stop_activated_by uuid references auth.users(id),
  emergency_stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_autopilot_limit_positive check (
    autopilot_daily_limit is null or autopilot_daily_limit >= 0
  )
);

comment on table public.prompter_automation_settings is
  'Tanyopo AI Promoter: per-tenant automation mode + emergency stop switch. Never bypassed by autopilot logic.';

create trigger trg_prompter_automation_settings_updated_at
  before update on public.prompter_automation_settings
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_automation_settings enable row level security;

create policy "Lihat automation settings tenant sendiri"
  on public.prompter_automation_settings for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Buat automation settings tenant sendiri"
  on public.prompter_automation_settings for insert
  with check (tenant_id = public.fn_current_tenant_id());

create policy "Owner atau marketing bisa ubah automation settings"
  on public.prompter_automation_settings for update
  using (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
  )
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
  );

-- ============================================================================
-- prompter_audit_logs
-- Append-only audit trail (section 55). No update/delete policy is defined
-- on purpose — rows are immutable once written. Every critical action
-- (connection, campaign launch, budget change, approval, automation change,
-- role change, billing action) must write one row here.
-- ============================================================================
create table public.prompter_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  before_data jsonb,
  after_data jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.prompter_audit_logs is
  'Tanyopo AI Promoter: append-only audit trail. No UPDATE/DELETE policy exists — rows are immutable.';

create index idx_prompter_audit_logs_tenant_created
  on public.prompter_audit_logs (tenant_id, created_at desc);

create index idx_prompter_audit_logs_resource
  on public.prompter_audit_logs (resource_type, resource_id);

alter table public.prompter_audit_logs enable row level security;

create policy "Lihat audit log tenant sendiri"
  on public.prompter_audit_logs for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Tulis audit log sebagai diri sendiri"
  on public.prompter_audit_logs for insert
  with check (
    tenant_id = public.fn_current_tenant_id()
    and (actor_user_id is null or actor_user_id = auth.uid())
  );
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829080127', '68deade554b45b338699f96634bb82c45d9d540f0c4cea6973d9b7468438e63a');

-- >>> 20260829080155_prompter_fix_function_search_path.sql  sha256=1b170e599e2181908beb38aa4baa5b062e09e44fb4fb59fe703c77f28cc779f9
-- Fixes a Supabase linter WARN (function_search_path_mutable) on the
-- trigger function introduced in the previous migration.
create or replace function public.prompter_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829080155', '1b170e599e2181908beb38aa4baa5b062e09e44fb4fb59fe703c77f28cc779f9');

-- >>> 20260829092303_prompter_phase1_schema.sql  sha256=f8f02b0511ad58fd1dfa18774eed12226fa9b256c27a170bd9147970f1648012
-- Tanyopo AI Promoter — Phase 1 schema (Core Promoter)
--
-- Additive only, same rules as the Phase 0 migration: every table is
-- prefixed `prompter_`, foreign-keys into the existing public.tenants,
-- and is scoped by the existing fn_current_tenant_id()/fn_current_role().
-- No UMKMpro table is touched.
--
-- Write access (INSERT/UPDATE/DELETE) on every table below is restricted
-- to roles 'owner'/'marketing' — consistent with the Phase 0 tables, and
-- deliberate here because these actions create AI jobs (real cost) or
-- represent marketing-facing changes. Read access is open to any member
-- of the tenant.

-- ============================================================================
-- prompter_products
-- ============================================================================
create table public.prompter_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  product_type text not null check (
    product_type in ('PHYSICAL_PRODUCT', 'SERVICE', 'APPLICATION', 'SUBSCRIPTION', 'DIGITAL_PRODUCT')
  ),
  category text,
  price numeric(14, 2),
  currency text not null default 'IDR',
  stock integer,
  hpp numeric(14, 2),
  website_url text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DRAFT', 'ARCHIVED')),
  -- Reserved for the Phase 4 UMKMpro handoff (product_snapshots). Unused
  -- until then — every Phase 1 product has source_system = 'promoter'.
  source_system text not null default 'promoter' check (source_system in ('promoter', 'umkmpro')),
  source_product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_products_price_nonnegative check (price is null or price >= 0),
  constraint prompter_products_stock_nonnegative check (stock is null or stock >= 0),
  constraint prompter_products_hpp_nonnegative check (hpp is null or hpp >= 0)
);

comment on table public.prompter_products is
  'Tanyopo AI Promoter: product/service/app/subscription catalog a tenant wants to promote.';

create index idx_prompter_products_tenant on public.prompter_products (tenant_id, created_at desc);

create trigger trg_prompter_products_updated_at
  before update on public.prompter_products
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_products enable row level security;

create policy "Lihat produk tenant sendiri"
  on public.prompter_products for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola produk"
  on public.prompter_products for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_product_media
-- ============================================================================
create table public.prompter_product_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.prompter_products(id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO')),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.prompter_product_media is
  'Tanyopo AI Promoter: uploaded product images/videos. storage_path points into the product-media bucket.';

create index idx_prompter_product_media_product on public.prompter_product_media (product_id, position);
create index idx_prompter_product_media_tenant on public.prompter_product_media (tenant_id);

alter table public.prompter_product_media enable row level security;

create policy "Lihat media produk tenant sendiri"
  on public.prompter_product_media for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola media produk"
  on public.prompter_product_media for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_ai_jobs
-- Created before prompter_marketing_blueprints/prompter_master_campaigns/
-- prompter_content_items so they can each carry an ai_job_id FK.
-- ============================================================================
create table public.prompter_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_type text not null check (
    job_type in ('MARKETING_BLUEPRINT', 'CAMPAIGN_PROPOSAL', 'CONTENT_GENERATION')
  ),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  model text,
  input_reference jsonb not null default '{}'::jsonb,
  output_reference jsonb,
  tokens_input integer,
  tokens_output integer,
  estimated_cost numeric(10, 4),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.prompter_ai_jobs is
  'Tanyopo AI Promoter: audit + cost-observability record for every AI generation request.';

create index idx_prompter_ai_jobs_tenant on public.prompter_ai_jobs (tenant_id, created_at desc);

alter table public.prompter_ai_jobs enable row level security;

create policy "Lihat ai job tenant sendiri"
  on public.prompter_ai_jobs for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing buat & ubah ai job"
  on public.prompter_ai_jobs for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_marketing_blueprints
-- One row per product — regenerating overwrites the existing row (upsert on
-- product_id) rather than versioning, to keep Phase 1 simple.
-- ============================================================================
create table public.prompter_marketing_blueprints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.prompter_products(id) on delete cascade,
  summary text,
  usp text,
  benefits jsonb not null default '[]'::jsonb,
  pain_points jsonb not null default '[]'::jsonb,
  target_personas jsonb not null default '[]'::jsonb,
  positioning text,
  marketing_angles jsonb not null default '[]'::jsonb,
  recommended_channels jsonb not null default '[]'::jsonb,
  content_ideas jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  disclaimers text,
  ai_job_id uuid references public.prompter_ai_jobs(id) on delete set null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_marketing_blueprints_product_unique unique (product_id)
);

comment on table public.prompter_marketing_blueprints is
  'Tanyopo AI Promoter: structured AI Marketing Blueprint per product. Regenerating replaces the row.';

create index idx_prompter_marketing_blueprints_tenant on public.prompter_marketing_blueprints (tenant_id);

create trigger trg_prompter_marketing_blueprints_updated_at
  before update on public.prompter_marketing_blueprints
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_marketing_blueprints enable row level security;

create policy "Lihat blueprint tenant sendiri"
  on public.prompter_marketing_blueprints for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola blueprint"
  on public.prompter_marketing_blueprints for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_master_campaigns
-- Phase 1 scope: DRAFT only (no channel_campaigns, no real publishing — see
-- ROADMAP.md Phase 2/3). `channels` records the user's intent, not a live
-- connection; `ai_proposal` holds the AI-generated strategy as structured
-- JSON validated against CampaignProposalSchema before being written here.
-- ============================================================================
create table public.prompter_master_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid references public.prompter_products(id) on delete set null,
  name text not null,
  objective text not null check (
    objective in (
      'INCREASE_SALES', 'GET_LEADS', 'INCREASE_FOLLOWERS',
      'BRAND_AWARENESS', 'WEBSITE_TRAFFIC', 'PROMOTE_APP'
    )
  ),
  channels text[] not null default '{}',
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED')
  ),
  target_country text,
  target_region text,
  target_city text,
  audience_notes text,
  daily_budget numeric(14, 2),
  total_budget numeric(14, 2),
  currency text not null default 'IDR',
  duration_days integer,
  start_date date,
  ai_proposal jsonb,
  ai_job_id uuid references public.prompter_ai_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_master_campaigns_budget_nonnegative check (
    (daily_budget is null or daily_budget >= 0) and (total_budget is null or total_budget >= 0)
  ),
  constraint prompter_master_campaigns_duration_positive check (duration_days is null or duration_days > 0)
);

comment on table public.prompter_master_campaigns is
  'Tanyopo AI Promoter: campaign draft produced by the Promote Wizard. Phase 1 — DRAFT status only, no live publishing.';

create index idx_prompter_master_campaigns_tenant on public.prompter_master_campaigns (tenant_id, created_at desc);
create index idx_prompter_master_campaigns_product on public.prompter_master_campaigns (product_id);

create trigger trg_prompter_master_campaigns_updated_at
  before update on public.prompter_master_campaigns
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_master_campaigns enable row level security;

create policy "Lihat campaign tenant sendiri"
  on public.prompter_master_campaigns for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola campaign"
  on public.prompter_master_campaigns for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_content_items
-- ============================================================================
create table public.prompter_content_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid references public.prompter_products(id) on delete set null,
  platform text not null check (platform in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X', 'WEBSITE')),
  content_type text not null check (content_type in ('CAPTION', 'AD_COPY', 'BLOG', 'VIDEO_SCRIPT')),
  goal text check (
    goal is null or goal in (
      'INCREASE_SALES', 'GET_LEADS', 'INCREASE_FOLLOWERS',
      'BRAND_AWARENESS', 'WEBSITE_TRAFFIC', 'PROMOTE_APP'
    )
  ),
  tone text,
  language text not null default 'id' check (language in ('id', 'en')),
  body jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'FAILED')
  ),
  ai_job_id uuid references public.prompter_ai_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prompter_content_items is
  'Tanyopo AI Promoter: AI-generated content (caption/ad copy/blog/script). Phase 1 — DRAFT status only, no scheduling/publishing yet.';

create index idx_prompter_content_items_tenant on public.prompter_content_items (tenant_id, created_at desc);
create index idx_prompter_content_items_product on public.prompter_content_items (product_id);

create trigger trg_prompter_content_items_updated_at
  before update on public.prompter_content_items
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_content_items enable row level security;

create policy "Lihat konten tenant sendiri"
  on public.prompter_content_items for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Owner/marketing kelola konten"
  on public.prompter_content_items for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- Storage buckets (section 54). Object path convention:
-- {tenant_id}/{...}. All four are public-read (marketing assets are meant
-- to be embeddable in previews/ads/social posts), but writes are gated by
-- the storage.objects policy below — the tenant's own folder only.
-- Only `product-media` has a Phase 1 writer (product media upload); the
-- other three are reserved for Phase 2/3 features and stay empty until then.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-media', 'product-media', true, 104857600,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('creative-assets', 'creative-assets', true, 104857600,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('brand-assets', 'brand-assets', true, 5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('generated-content', 'generated-content', true, 104857600,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do nothing;

create policy "Tenant kelola file marketing miliknya sendiri"
  on storage.objects for all
  using (
    bucket_id in ('product-media', 'creative-assets', 'brand-assets', 'generated-content')
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  )
  with check (
    bucket_id in ('product-media', 'creative-assets', 'brand-assets', 'generated-content')
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  );
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829092303', 'f8f02b0511ad58fd1dfa18774eed12226fa9b256c27a170bd9147970f1648012');

-- >>> 20260829095447_prompter_phase2_schema.sql  sha256=b801b07a0cfb6a314306b4a4877da02fc8e8e9c05c57564b41dfbbd2adfff206
-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829095447), which recorded this exact SQL as already applied on the live
-- database but never had a corresponding file committed to this repository
-- (Stage 1 production integration verification, Item 1 -- schema drift).
--
-- This file's version prefix matches the version already recorded as
-- applied in `supabase_migrations.schema_migrations` on the live project,
-- so a standard `supabase db push` against that project will recognize it
-- as already-applied and skip it -- it will NOT be re-executed there.
-- Defensive IF NOT EXISTS / DROP-IF-EXISTS-THEN-CREATE guards have been
-- added below (where Postgres syntax allows) purely so this file is also
-- safe to run once, from scratch, against a project that does NOT yet have
-- this schema (e.g. a fresh dev/staging replica) -- it must NOT be run
-- against the live umkmpro-ai project itself, since that would attempt to
-- recreate objects that already exist there under the same names.
-- ============================================================================

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
create table if not exists public.prompter_budget_policies (
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

drop trigger if exists trg_prompter_budget_policies_updated_at on public.prompter_budget_policies;
create trigger trg_prompter_budget_policies_updated_at
  before update on public.prompter_budget_policies
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_budget_policies enable row level security;

drop policy if exists "Lihat budget policy tenant sendiri" on public.prompter_budget_policies;
create policy "Lihat budget policy tenant sendiri"
  on public.prompter_budget_policies for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner kelola budget policy" on public.prompter_budget_policies;
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
create table if not exists public.prompter_channel_campaigns (
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

create index if not exists idx_prompter_channel_campaigns_master on public.prompter_channel_campaigns (master_campaign_id);
create index if not exists idx_prompter_channel_campaigns_tenant on public.prompter_channel_campaigns (tenant_id);

drop trigger if exists trg_prompter_channel_campaigns_updated_at on public.prompter_channel_campaigns;
create trigger trg_prompter_channel_campaigns_updated_at
  before update on public.prompter_channel_campaigns
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_channel_campaigns enable row level security;

drop policy if exists "Lihat channel campaign tenant sendiri" on public.prompter_channel_campaigns;
create policy "Lihat channel campaign tenant sendiri"
  on public.prompter_channel_campaigns for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola channel campaign" on public.prompter_channel_campaigns;
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
create table if not exists public.prompter_approvals (
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

create index if not exists idx_prompter_approvals_tenant on public.prompter_approvals (tenant_id, status, created_at desc);
create index if not exists idx_prompter_approvals_resource on public.prompter_approvals (resource_type, resource_id);

alter table public.prompter_approvals enable row level security;

drop policy if exists "Lihat approval tenant sendiri" on public.prompter_approvals;
create policy "Lihat approval tenant sendiri"
  on public.prompter_approvals for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing ajukan approval" on public.prompter_approvals;
create policy "Owner/marketing ajukan approval"
  on public.prompter_approvals for insert
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
    and (requested_by is null or requested_by = auth.uid())
  );

drop policy if exists "Owner memutuskan approval" on public.prompter_approvals;
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
create table if not exists public.prompter_marketing_metrics (
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

create index if not exists idx_prompter_marketing_metrics_tenant on public.prompter_marketing_metrics (tenant_id, date desc);
create index if not exists idx_prompter_marketing_metrics_campaign on public.prompter_marketing_metrics (master_campaign_id);

alter table public.prompter_marketing_metrics enable row level security;

drop policy if exists "Lihat marketing metrics tenant sendiri" on public.prompter_marketing_metrics;
create policy "Lihat marketing metrics tenant sendiri"
  on public.prompter_marketing_metrics for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola marketing metrics" on public.prompter_marketing_metrics;
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
create table if not exists public.prompter_conversions (
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

create index if not exists idx_prompter_conversions_tenant on public.prompter_conversions (tenant_id, occurred_at desc);
create index if not exists idx_prompter_conversions_campaign on public.prompter_conversions (master_campaign_id);

alter table public.prompter_conversions enable row level security;

drop policy if exists "Lihat konversi tenant sendiri" on public.prompter_conversions;
create policy "Lihat konversi tenant sendiri"
  on public.prompter_conversions for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola konversi" on public.prompter_conversions;
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
create table if not exists public.prompter_attributions (
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

create index if not exists idx_prompter_attributions_tenant on public.prompter_attributions (tenant_id);
create index if not exists idx_prompter_attributions_conversion on public.prompter_attributions (conversion_id);

alter table public.prompter_attributions enable row level security;

drop policy if exists "Lihat atribusi tenant sendiri" on public.prompter_attributions;
create policy "Lihat atribusi tenant sendiri"
  on public.prompter_attributions for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola atribusi" on public.prompter_attributions;
create policy "Owner/marketing kelola atribusi"
  on public.prompter_attributions for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829095447', 'b801b07a0cfb6a314306b4a4877da02fc8e8e9c05c57564b41dfbbd2adfff206');

-- >>> 20260829102304_prompter_phase3_schema.sql  sha256=b2038586a8e061478a896cc280e6e0566ecc65e5a52ae691170e9b9424997a10
-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829102304), which recorded this exact SQL as already applied on the live
-- database but never had a corresponding file committed to this repository
-- (Stage 1 production integration verification, Item 1 -- schema drift).
--
-- This file's version prefix matches the version already recorded as
-- applied in `supabase_migrations.schema_migrations` on the live project,
-- so a standard `supabase db push` against that project will recognize it
-- as already-applied and skip it -- it will NOT be re-executed there.
-- Defensive IF NOT EXISTS / DROP-IF-EXISTS-THEN-CREATE guards have been
-- added below (where Postgres syntax allows) purely so this file is also
-- safe to run once, from scratch, against a project that does NOT yet have
-- this schema (e.g. a fresh dev/staging replica) -- it must NOT be run
-- against the live umkmpro-ai project itself, since that would attempt to
-- recreate objects that already exist there under the same names.
-- ============================================================================

-- Tanyopo AI Promoter — Phase 3 schema (Meta Foundation)
--
-- Additive only, same rules as Phase 0-2. No UMKMpro table is touched.
--
-- `platform` here (META/TIKTOK/X) names an OAuth connector/provider and is
-- deliberately distinct from the `channel` enum used on campaigns/content
-- (FACEBOOK/INSTAGRAM/TIKTOK/X/SEO) — a single Meta connection covers both
-- the Facebook and Instagram channels, matching the Connection Center's
-- single "Facebook & Instagram" card (product spec §27).

-- ============================================================================
-- prompter_platform_capabilities
-- Global reference/registry data, not tenant-scoped — the same table every
-- tenant reads to render Connection Center capability details. Seeded by
-- this migration only; no INSERT/UPDATE/DELETE policy exists, so the app
-- can never write to it (a future capability change is a migration, not a
-- runtime write).
-- ============================================================================
create table if not exists public.prompter_platform_capabilities (
  platform text not null check (platform in ('META', 'TIKTOK', 'X')),
  capability text not null check (
    capability in (
      'CONNECT_ACCOUNT', 'READ_ANALYTICS', 'PUBLISH_CONTENT',
      'CREATE_CAMPAIGN', 'CREATE_AD', 'UPDATE_BUDGET', 'PAUSE_CAMPAIGN'
    )
  ),
  enabled boolean not null default false,
  requires_oauth boolean not null default true,
  requires_approval boolean not null default false,
  api_version text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (platform, capability)
);

comment on table public.prompter_platform_capabilities is
  'Tanyopo AI Promoter: global connector capability registry. Read-only from the app — seeded by migrations.';

drop trigger if exists trg_prompter_platform_capabilities_updated_at on public.prompter_platform_capabilities;
create trigger trg_prompter_platform_capabilities_updated_at
  before update on public.prompter_platform_capabilities
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_platform_capabilities enable row level security;

drop policy if exists "Semua pengguna login bisa lihat capability registry" on public.prompter_platform_capabilities;
create policy "Semua pengguna login bisa lihat capability registry"
  on public.prompter_platform_capabilities for select
  to authenticated
  using (true);

-- ============================================================================
-- prompter_connected_accounts
-- Connection metadata only — never the token itself (see
-- prompter_oauth_credentials below). One row per tenant per platform.
-- Absence of a row means NOT_CONNECTED; this table never stores a fake
-- CONNECTED status — a row is only written after a real OAuth callback
-- succeeds (see app/api/connections/meta/callback).
-- ============================================================================
create table if not exists public.prompter_connected_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null check (platform in ('META', 'TIKTOK', 'X')),
  external_account_id text not null,
  external_account_name text,
  status text not null default 'CONNECTED' check (
    status in ('CONNECTED', 'EXPIRED', 'ACTION_REQUIRED', 'DISCONNECTED')
  ),
  scopes text[] not null default '{}',
  expires_at timestamptz,
  refreshable boolean not null default true,
  last_refreshed_at timestamptz,
  connected_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_connected_accounts_unique unique (tenant_id, platform)
);

comment on table public.prompter_connected_accounts is
  'Tanyopo AI Promoter: OAuth connection metadata (never tokens). A missing row means NOT_CONNECTED.';

create index if not exists idx_prompter_connected_accounts_tenant on public.prompter_connected_accounts (tenant_id);

drop trigger if exists trg_prompter_connected_accounts_updated_at on public.prompter_connected_accounts;
create trigger trg_prompter_connected_accounts_updated_at
  before update on public.prompter_connected_accounts
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_connected_accounts enable row level security;

drop policy if exists "Lihat koneksi tenant sendiri" on public.prompter_connected_accounts;
create policy "Lihat koneksi tenant sendiri"
  on public.prompter_connected_accounts for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner kelola koneksi platform" on public.prompter_connected_accounts;
create policy "Owner kelola koneksi platform"
  on public.prompter_connected_accounts for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');

-- ============================================================================
-- prompter_oauth_credentials
-- Encrypted tokens (encryption happens in the app — see
-- lib/crypto/token-cipher.ts — this column stores ciphertext, not a
-- plaintext token the database could leak on its own). Deliberately has
-- ZERO RLS policies: RLS is enabled but no policy is defined for
-- anon/authenticated, so every ordinary client request is denied by
-- default. Only the service-role key (lib/supabase/admin.ts, which
-- bypasses RLS entirely and is never sent to the browser) can read or
-- write this table — matching product spec §32 "tokens never sent to the
-- browser, never displayed." This mirrors the same enabled-with-no-policy
-- pattern already used by UMKMpro's own ai_assistant_usage_log table.
-- ============================================================================
create table if not exists public.prompter_oauth_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connected_account_id uuid not null references public.prompter_connected_accounts(id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_oauth_credentials_unique unique (connected_account_id)
);

comment on table public.prompter_oauth_credentials is
  'Tanyopo AI Promoter: encrypted OAuth tokens. RLS enabled with NO policies — service-role access only, by design.';

drop trigger if exists trg_prompter_oauth_credentials_updated_at on public.prompter_oauth_credentials;
create trigger trg_prompter_oauth_credentials_updated_at
  before update on public.prompter_oauth_credentials
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_oauth_credentials enable row level security;

-- ============================================================================
-- Seed: platform_capabilities
-- Meta: capabilities this codebase actually implements (lib/connectors/
-- meta-connector.ts) are enabled — still gated at runtime by whether
-- META_APP_ID/META_APP_SECRET/META_REDIRECT_URI are configured (see
-- lib/env.ts). TikTok/X: no connector code exists yet (Phase 6), so every
-- capability is disabled regardless of credentials.
-- ============================================================================
insert into public.prompter_platform_capabilities
  (platform, capability, enabled, requires_oauth, requires_approval, api_version, notes)
values
  ('META', 'CONNECT_ACCOUNT', true, true, false, 'v21.0', null),
  ('META', 'READ_ANALYTICS', true, true, true, 'v21.0', 'Memerlukan Meta App Review untuk ads_read di Advanced Access.'),
  ('META', 'CREATE_CAMPAIGN', true, true, true, 'v21.0', 'Memerlukan Meta App Review untuk ads_management di Advanced Access.'),
  ('META', 'CREATE_AD', true, true, true, 'v21.0', 'Memerlukan Meta App Review untuk ads_management di Advanced Access.'),
  ('META', 'UPDATE_BUDGET', true, true, true, 'v21.0', 'Memerlukan Meta App Review untuk ads_management di Advanced Access.'),
  ('META', 'PAUSE_CAMPAIGN', true, true, true, 'v21.0', 'Memerlukan Meta App Review untuk ads_management di Advanced Access.'),
  ('META', 'PUBLISH_CONTENT', false, true, true, null, 'Belum diimplementasikan — Phase 3 hanya mencakup Marketing API (ads), bukan organic posting.'),
  ('TIKTOK', 'CONNECT_ACCOUNT', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('TIKTOK', 'READ_ANALYTICS', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('TIKTOK', 'CREATE_CAMPAIGN', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('TIKTOK', 'CREATE_AD', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('TIKTOK', 'UPDATE_BUDGET', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('TIKTOK', 'PAUSE_CAMPAIGN', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('TIKTOK', 'PUBLISH_CONTENT', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('X', 'CONNECT_ACCOUNT', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('X', 'READ_ANALYTICS', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('X', 'CREATE_CAMPAIGN', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('X', 'CREATE_AD', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('X', 'UPDATE_BUDGET', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('X', 'PAUSE_CAMPAIGN', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.'),
  ('X', 'PUBLISH_CONTENT', false, true, false, null, 'Connector belum dibangun — direncanakan Phase 6.')
on conflict do nothing;
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829102304', 'b2038586a8e061478a896cc280e6e0566ecc65e5a52ae691170e9b9424997a10');

-- >>> 20260829102947_prompter_channel_campaigns_add_error.sql  sha256=98de4568c1284adbb3058fcc1fc14fc11699e0b188e55508c24315f8da1e0720
-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829102947), which recorded this exact SQL as already applied on the live
-- database but never had a corresponding file committed to this repository
-- (Stage 1 production integration verification, Item 1 -- schema drift).
--
-- This file's version prefix matches the version already recorded as
-- applied in `supabase_migrations.schema_migrations` on the live project,
-- so a standard `supabase db push` against that project will recognize it
-- as already-applied and skip it -- it will NOT be re-executed there.
-- Defensive IF NOT EXISTS / DROP-IF-EXISTS-THEN-CREATE guards have been
-- added below (where Postgres syntax allows) purely so this file is also
-- safe to run once, from scratch, against a project that does NOT yet have
-- this schema (e.g. a fresh dev/staging replica) -- it must NOT be run
-- against the live umkmpro-ai project itself, since that would attempt to
-- recreate objects that already exist there under the same names.
-- ============================================================================

alter table public.prompter_channel_campaigns add column if not exists error text;
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829102947', '98de4568c1284adbb3058fcc1fc14fc11699e0b188e55508c24315f8da1e0720');

commit;
