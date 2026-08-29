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
