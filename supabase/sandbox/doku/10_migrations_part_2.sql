-- ============================================================================
-- 10_migrations_part_2.sql  (bagian 2 dari 8)  -- SANDBOX DOKU SAJA
-- Migrasi 7 s/d 14 dari 49:  20260829104743_prompter_phase4_schema.sql  ...  20260901131336_prompter_job_queue.sql
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- File ini DIBANGUN OTOMATIS oleh tools/build_bundles.py; isi migrasi disalin apa adanya.
-- Jalankan HANYA di project sandbox (cek ref di URL dashboard), SETELAH 00 PASS dan 01 sukses,
-- dan berurutan (bagian 2 butuh 6 migrasi sudah tercatat). Satu transaksi: gagal = tidak ada yang terpasang.
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
  if (select count(*) from public._linoe_sandbox_applied) <> 6 then
    raise exception 'ABORT: urutan salah. Harus ada 6 migrasi tercatat sebelum bagian ini.';
  end if;
end $guard$;

-- >>> 20260829104743_prompter_phase4_schema.sql  sha256=31b506080762c409fbed9e852ada219c8e14bd3dd401682ebe787fe1a42fe231
-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829104743), which recorded this exact SQL as already applied on the live
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

-- Tanyopo AI Promoter — Phase 4 schema (UMKMpro Integration)
--
-- Additive only, same rules as Phase 0-3. No UMKMpro table is touched.
--
-- Every write from the /api/v1/integrations/umkmpro/* routes happens
-- through the service-role client (there is no logged-in Supabase user in
-- a server-to-server request signed with UMKMPRO_SERVICE_TOKEN) — see
-- lib/umkmpro/auth.ts and docs/SECURITY.md. RLS policies below cover the
-- read path (a tenant member viewing their own sync history) and, where
-- noted, a narrow write path for the app's own authenticated users.

-- ============================================================================
-- prompter_products: allow safe upsert-by-source
-- Multiple NULL source_product_id values (every 'promoter'-sourced product)
-- remain mutually non-conflicting — Postgres treats NULLs as distinct in a
-- unique constraint — so this only actually constrains 'umkmpro'-sourced
-- rows, which is exactly what product sync needs.
-- ============================================================================
alter table public.prompter_products drop constraint if exists prompter_products_source_unique;
alter table public.prompter_products
  add constraint prompter_products_source_unique unique (tenant_id, source_system, source_product_id);

-- ============================================================================
-- prompter_conversions: idempotency for externally-pushed events
-- Same NULL-distinctness trick — Phase 2's manual entries (external_event_id
-- IS NULL) never collide with each other or with umkmpro-sourced rows.
-- ============================================================================
alter table public.prompter_conversions add column if not exists external_event_id text;

alter table public.prompter_conversions drop constraint if exists prompter_conversions_external_event_unique;
alter table public.prompter_conversions
  add constraint prompter_conversions_external_event_unique unique (tenant_id, source, external_event_id);

-- ============================================================================
-- prompter_product_snapshots
-- Append-only history (product spec §48) — every sync from UMKMpro inserts
-- a NEW row rather than mutating one, so a campaign built from a snapshot
-- stays historically accurate even after the source product's price
-- changes. `linked_product_id` points at the live, mutable
-- prompter_products mirror that the rest of the app (Promote Wizard,
-- Marketing Blueprint, ...) actually queries.
-- ============================================================================
create table if not exists public.prompter_product_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_system text not null default 'umkmpro',
  source_product_id text not null,
  linked_product_id uuid references public.prompter_products(id) on delete set null,
  name text not null,
  description text,
  price numeric(14, 2),
  currency text not null default 'IDR',
  stock integer,
  hpp numeric(14, 2),
  category text,
  images jsonb not null default '[]'::jsonb,
  snapshot_at timestamptz not null default now(),
  source_updated_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.prompter_product_snapshots is
  'Tanyopo AI Promoter: append-only historical product snapshots from UMKMpro AI (product spec §48). Never mutated, only inserted.';

create index if not exists idx_prompter_product_snapshots_tenant on public.prompter_product_snapshots (tenant_id, snapshot_at desc);
create index if not exists idx_prompter_product_snapshots_source on public.prompter_product_snapshots (tenant_id, source_system, source_product_id);

alter table public.prompter_product_snapshots enable row level security;

drop policy if exists "Lihat snapshot produk tenant sendiri" on public.prompter_product_snapshots;
create policy "Lihat snapshot produk tenant sendiri"
  on public.prompter_product_snapshots for select
  using (tenant_id = public.fn_current_tenant_id());

-- No INSERT/UPDATE/DELETE policy for anon/authenticated — every snapshot is
-- written by the service-role client from a signed UMKMpro request.

-- ============================================================================
-- prompter_promotion_handoffs
-- The "secure promotion handoff" from product spec §47: UMKMpro asks
-- Promoter to create one of these, then redirects its user to
-- /promote?handoff=<id>. Promoter's own tenant-scoped RLS is what
-- "validates organization/user" — the visiting user simply can't see a
-- handoff belonging to a different tenant, full stop.
-- ============================================================================
create table if not exists public.prompter_promotion_handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  snapshot_id uuid references public.prompter_product_snapshots(id) on delete set null,
  product_id uuid references public.prompter_products(id) on delete set null,
  source_system text not null default 'umkmpro',
  external_user_reference text,
  status text not null default 'PENDING' check (status in ('PENDING', 'CONSUMED', 'EXPIRED')),
  idempotency_key text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint prompter_promotion_handoffs_idempotency_unique unique (tenant_id, source_system, idempotency_key)
);

comment on table public.prompter_promotion_handoffs is
  'Tanyopo AI Promoter: one-time "Promosikan dengan AI" handoff from UMKMpro. Consumed by /promote?handoff=<id>.';

create index if not exists idx_prompter_promotion_handoffs_tenant on public.prompter_promotion_handoffs (tenant_id, created_at desc);

alter table public.prompter_promotion_handoffs enable row level security;

drop policy if exists "Lihat handoff tenant sendiri" on public.prompter_promotion_handoffs;
create policy "Lihat handoff tenant sendiri"
  on public.prompter_promotion_handoffs for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Tenant sendiri bisa menandai handoff terpakai" on public.prompter_promotion_handoffs;
create policy "Tenant sendiri bisa menandai handoff terpakai"
  on public.prompter_promotion_handoffs for update
  using (tenant_id = public.fn_current_tenant_id())
  with check (tenant_id = public.fn_current_tenant_id());

-- Insert has no authenticated-role policy — handoffs are only ever created
-- by the service-role client from a signed UMKMpro request.

-- ============================================================================
-- prompter_webhook_events
-- Idempotent receipt log for /api/v1/integrations/umkmpro/webhooks
-- (product spec §56-57). `external_event_id` is UMKMpro's own event id;
-- the unique constraint is what makes redelivery a safe no-op.
-- ============================================================================
create table if not exists public.prompter_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  source_system text not null default 'umkmpro',
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint prompter_webhook_events_unique unique (source_system, external_event_id)
);

comment on table public.prompter_webhook_events is
  'Tanyopo AI Promoter: idempotent webhook receipt log. tenant_id is null only when the tenant could not be resolved (status = IGNORED).';

create index if not exists idx_prompter_webhook_events_tenant on public.prompter_webhook_events (tenant_id, received_at desc);

alter table public.prompter_webhook_events enable row level security;

drop policy if exists "Lihat webhook event tenant sendiri" on public.prompter_webhook_events;
create policy "Lihat webhook event tenant sendiri"
  on public.prompter_webhook_events for select
  using (tenant_id = public.fn_current_tenant_id());
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829104743', '31b506080762c409fbed9e852ada219c8e14bd3dd401682ebe787fe1a42fe231');

-- >>> 20260829110644_prompter_phase5_schema.sql  sha256=9bc07e9c766f0019d0abce8b5a08d8ea31d0a2814bd1e38661fa1bdfce64aa81
-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829110644), which recorded this exact SQL as already applied on the live
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

-- Tanyopo AI Promoter — Phase 5 schema (Growth + SEO)
--
-- Additive only, same rules as Phase 0-4. No UMKMpro table is touched.
--
-- Write access (INSERT/UPDATE/DELETE) on every new table below is
-- restricted to roles 'owner'/'marketing', same pattern as Phase 1's
-- marketing-facing tables. Read access is open to any tenant member.

-- ============================================================================
-- prompter_growth_goals
-- One row per tenant per platform (product spec's Growth module): a
-- follower target the business owner sets for themselves. There is no
-- automation behind this number — no bot, no purchased followers, no
-- fake engagement. It exists purely so a real, organic growth effort has
-- something to track progress against. unique(tenant_id, platform) makes
-- "update the goal" a straightforward upsert rather than an ever-growing
-- history (prompter_follower_snapshots below is where history lives).
-- ============================================================================
create table if not exists public.prompter_growth_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null check (platform in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X')),
  target_followers integer not null,
  target_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_growth_goals_target_positive check (target_followers >= 0),
  constraint prompter_growth_goals_unique unique (tenant_id, platform)
);

comment on table public.prompter_growth_goals is
  'Tanyopo AI Promoter: a tenant-set follower growth target per platform. No automation writes to this — user-entered only.';

drop trigger if exists trg_prompter_growth_goals_updated_at on public.prompter_growth_goals;
create trigger trg_prompter_growth_goals_updated_at
  before update on public.prompter_growth_goals
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_growth_goals enable row level security;

drop policy if exists "Lihat growth goal tenant sendiri" on public.prompter_growth_goals;
create policy "Lihat growth goal tenant sendiri"
  on public.prompter_growth_goals for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola growth goal" on public.prompter_growth_goals;
create policy "Owner/marketing kelola growth goal"
  on public.prompter_growth_goals for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_follower_snapshots
-- A manually-logged follower count at a point in time. `source` is fixed
-- to 'manual' today (no platform in this codebase has an organic-follower
-- read API wired up — Meta's Marketing API is ads-only) and left as a
-- text column rather than a boolean specifically so a future real
-- follower-count sync doesn't need a schema migration to add a value like
-- 'meta_api'; it needs actual API code first, which does not exist yet.
-- unique(tenant_id, platform, recorded_at) makes "correct today's number"
-- an upsert rather than a duplicate row.
-- ============================================================================
create table if not exists public.prompter_follower_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null check (platform in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X')),
  follower_count integer not null,
  recorded_at date not null default current_date,
  source text not null default 'manual' check (source in ('manual')),
  created_at timestamptz not null default now(),
  constraint prompter_follower_snapshots_count_nonnegative check (follower_count >= 0),
  constraint prompter_follower_snapshots_unique unique (tenant_id, platform, recorded_at)
);

comment on table public.prompter_follower_snapshots is
  'Tanyopo AI Promoter: manually-logged follower count history per platform. source is always manual today — no organic-follower API exists yet.';

create index if not exists idx_prompter_follower_snapshots_tenant on public.prompter_follower_snapshots (tenant_id, platform, recorded_at desc);

alter table public.prompter_follower_snapshots enable row level security;

drop policy if exists "Lihat follower snapshot tenant sendiri" on public.prompter_follower_snapshots;
create policy "Lihat follower snapshot tenant sendiri"
  on public.prompter_follower_snapshots for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing catat follower snapshot" on public.prompter_follower_snapshots;
create policy "Owner/marketing catat follower snapshot"
  on public.prompter_follower_snapshots for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_seo_projects
-- One row per website a tenant wants SEO help for. target_keywords is the
-- user's own starting list; prompter_seo_recommendations below is where
-- AI-refined keyword/content suggestions live, kept separate so a
-- regenerated recommendation never silently overwrites what the user typed.
-- ============================================================================
create table if not exists public.prompter_seo_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  website_url text not null,
  target_keywords jsonb not null default '[]'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prompter_seo_projects is
  'Tanyopo AI Promoter: one SEO project per website a tenant wants recommendations for.';

create index if not exists idx_prompter_seo_projects_tenant on public.prompter_seo_projects (tenant_id, created_at desc);

drop trigger if exists trg_prompter_seo_projects_updated_at on public.prompter_seo_projects;
create trigger trg_prompter_seo_projects_updated_at
  before update on public.prompter_seo_projects
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_seo_projects enable row level security;

drop policy if exists "Lihat SEO project tenant sendiri" on public.prompter_seo_projects;
create policy "Lihat SEO project tenant sendiri"
  on public.prompter_seo_projects for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola SEO project" on public.prompter_seo_projects;
create policy "Owner/marketing kelola SEO project"
  on public.prompter_seo_projects for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- prompter_seo_recommendations
-- One row per project (unique(project_id), upserted on regenerate — same
-- pattern as prompter_marketing_blueprints). AI-generated: on-page fixes,
-- a refined keyword list, and a content plan (blog/article ideas tied to
-- keywords). NOT_CONFIGURED (no row generated) when AI_PROVIDER_API_KEY
-- is unset — see lib/ai/get-provider.ts.
-- ============================================================================
create table if not exists public.prompter_seo_recommendations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.prompter_seo_projects(id) on delete cascade,
  summary text,
  target_keywords jsonb not null default '[]'::jsonb,
  on_page_recommendations jsonb not null default '[]'::jsonb,
  content_plan jsonb not null default '[]'::jsonb,
  ai_job_id uuid references public.prompter_ai_jobs(id) on delete set null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_seo_recommendations_project_unique unique (project_id)
);

comment on table public.prompter_seo_recommendations is
  'Tanyopo AI Promoter: AI-generated on-page recommendations + content plan for one SEO project. Upserted on regenerate.';

drop trigger if exists trg_prompter_seo_recommendations_updated_at on public.prompter_seo_recommendations;
create trigger trg_prompter_seo_recommendations_updated_at
  before update on public.prompter_seo_recommendations
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_seo_recommendations enable row level security;

drop policy if exists "Lihat SEO recommendation tenant sendiri" on public.prompter_seo_recommendations;
create policy "Lihat SEO recommendation tenant sendiri"
  on public.prompter_seo_recommendations for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola SEO recommendation" on public.prompter_seo_recommendations;
create policy "Owner/marketing kelola SEO recommendation"
  on public.prompter_seo_recommendations for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));

-- ============================================================================
-- Content calendar: prompter_content_items gains a schedule date
-- ============================================================================
alter table public.prompter_content_items add column if not exists scheduled_at timestamptz;

create index if not exists idx_prompter_content_items_scheduled on public.prompter_content_items (tenant_id, scheduled_at)
  where scheduled_at is not null;

-- ============================================================================
-- prompter_ai_jobs.job_type gains SEO_RECOMMENDATIONS
-- ============================================================================
alter table public.prompter_ai_jobs drop constraint if exists prompter_ai_jobs_job_type_check;

alter table public.prompter_ai_jobs add constraint prompter_ai_jobs_job_type_check
  check (job_type in ('MARKETING_BLUEPRINT', 'CAMPAIGN_PROPOSAL', 'CONTENT_GENERATION', 'SEO_RECOMMENDATIONS'));
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829110644', '9bc07e9c766f0019d0abce8b5a08d8ea31d0a2814bd1e38661fa1bdfce64aa81');

-- >>> 20260829112835_prompter_phase6_capabilities.sql  sha256=e2d5b2501ffdcd26407fe22f2e89d1de223d2a0fd68d4774f044c3667fad0f7a
-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829112835), which recorded this exact SQL as already applied on the live
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

-- Tanyopo AI Promoter — Phase 6 (TikTok + X connectors)
--
-- No new table — Phase 6 adds real connector implementations
-- (lib/connectors/tiktok-connector.ts, lib/connectors/x-connector.ts)
-- and updates the read-only capability registry seeded in Phase 3 to
-- reflect what's now actually implemented. Same additive-only rule as
-- every prior migration; no UMKMpro table is touched.
--
-- "enabled = true" means "this codebase has a real implementation
-- attempting the call," not "verified against a live account" or "no
-- remaining gaps" — Meta's own CREATE_AD row was already enabled=true
-- despite its documented Page-picker gap (see Phase 3). TikTok/X's
-- CREATE_CAMPAIGN/CREATE_AD rows follow the same convention: real code
-- exists, and the specific remaining gap (unverified location-catalog
-- mapping, no asset-upload/tweet-composition flow) is named in `notes`
-- rather than hidden by leaving the capability disabled.

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = null
where platform = 'TIKTOK' and capability = 'CONNECT_ACCOUNT';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Insight dasar (spend/impressions/reach/clicks) — belum diverifikasi ke akun nyata.'
where platform = 'TIKTOK' and capability = 'READ_ANALYTICS';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Campaign dapat dibuat, tapi ad set (targeting) berhenti di sini — TikTok memerlukan location_id numerik yang belum ada pemetaan terverifikasi dari kode negara ISO.'
where platform = 'TIKTOK' and capability = 'CREATE_CAMPAIGN';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Kode lengkap ada, tapi tidak tercapai lewat alur peluncuran nyata hari ini — berhenti lebih dulu di tahap ad set (lihat CREATE_CAMPAIGN) dan creative (belum ada alur unggah aset).'
where platform = 'TIKTOK' and capability = 'CREATE_AD';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Memerlukan advertiser_id — diteruskan oleh connector, belum diverifikasi ke akun nyata.'
where platform = 'TIKTOK' and capability = 'UPDATE_BUDGET';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Belum diverifikasi ke akun nyata.'
where platform = 'TIKTOK' and capability = 'PAUSE_CAMPAIGN';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = null
where platform = 'X' and capability = 'CONNECT_ACCOUNT';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Insight dasar (spend/impressions/clicks) — belum diverifikasi ke akun nyata. Tidak ada metrik reach yang sebanding di API X, dilaporkan 0 daripada menebak.'
where platform = 'X' and capability = 'READ_ANALYTICS';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Campaign dapat dibuat (funding instrument otomatis dipilih), tapi ad set (line item/targeting) berhenti di sini — X memerlukan location_id numerik yang belum ada pemetaan terverifikasi dari kode negara ISO.'
where platform = 'X' and capability = 'CREATE_CAMPAIGN';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Kode lengkap ada, tapi tidak tercapai lewat alur peluncuran nyata hari ini — berhenti lebih dulu di tahap ad set (lihat CREATE_CAMPAIGN) dan creative (Promoted Tweet memerlukan tweet yang sudah ada, belum ada alur membuat tweet).'
where platform = 'X' and capability = 'CREATE_AD';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Belum diverifikasi ke akun nyata.'
where platform = 'X' and capability = 'UPDATE_BUDGET';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Belum diverifikasi ke akun nyata.'
where platform = 'X' and capability = 'PAUSE_CAMPAIGN';

-- PUBLISH_CONTENT (organic posting) stays disabled for both — same as
-- Meta: this phase only covers each platform's ads/marketing API.
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829112835', 'e2d5b2501ffdcd26407fe22f2e89d1de223d2a0fd68d4774f044c3667fad0f7a');

-- >>> 20260829114414_prompter_phase7_schema.sql  sha256=7aa7f152c27bd8015b08e43ce1db350710223407bab5cacf9e6f98f36234529c
-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829114414), which recorded this exact SQL as already applied on the live
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
alter table public.prompter_ai_jobs drop constraint if exists prompter_ai_jobs_job_type_check;

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
create table if not exists public.prompter_analytics_insights (
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

drop trigger if exists trg_prompter_analytics_insights_updated_at on public.prompter_analytics_insights;
create trigger trg_prompter_analytics_insights_updated_at
  before update on public.prompter_analytics_insights
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_analytics_insights enable row level security;

drop policy if exists "Lihat analytics insight tenant sendiri" on public.prompter_analytics_insights;
create policy "Lihat analytics insight tenant sendiri"
  on public.prompter_analytics_insights for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola analytics insight" on public.prompter_analytics_insights;
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
create table if not exists public.prompter_optimization_recommendations (
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

drop trigger if exists trg_prompter_optimization_recommendations_updated_at on public.prompter_optimization_recommendations;
create trigger trg_prompter_optimization_recommendations_updated_at
  before update on public.prompter_optimization_recommendations
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_optimization_recommendations enable row level security;

drop policy if exists "Lihat optimization recommendation tenant sendiri" on public.prompter_optimization_recommendations;
create policy "Lihat optimization recommendation tenant sendiri"
  on public.prompter_optimization_recommendations for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing kelola optimization recommendation" on public.prompter_optimization_recommendations;
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
create table if not exists public.prompter_autopilot_policies (
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

drop trigger if exists trg_prompter_autopilot_policies_updated_at on public.prompter_autopilot_policies;
create trigger trg_prompter_autopilot_policies_updated_at
  before update on public.prompter_autopilot_policies
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_autopilot_policies enable row level security;

drop policy if exists "Lihat autopilot policy tenant sendiri" on public.prompter_autopilot_policies;
create policy "Lihat autopilot policy tenant sendiri"
  on public.prompter_autopilot_policies for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner kelola autopilot policy" on public.prompter_autopilot_policies;
create policy "Owner kelola autopilot policy"
  on public.prompter_autopilot_policies for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829114414', '7aa7f152c27bd8015b08e43ce1db350710223407bab5cacf9e6f98f36234529c');

-- >>> 20260829155306_prompter_ai_router_usage_columns.sql  sha256=55ad80cefe2b17096217f6b27ca36483e2b75160a9c56c1e6710ad242e7a33a0
-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829155306), which recorded this exact SQL as already applied on the live
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

alter table public.prompter_ai_jobs
  add column if not exists provider text,
  add column if not exists actor_user_id uuid references public.user_profiles(id) on delete set null,
  add column if not exists fallback_provider text,
  add column if not exists error_category text check (
    error_category is null or error_category in (
      'AUTH', 'RATE_LIMIT', 'CONNECTION', 'API', 'REFUSAL', 'INVALID_OUTPUT', 'CONFIG', 'UNKNOWN'
    )
  );

comment on column public.prompter_ai_jobs.provider is
  'Which AI provider (e.g. "openai", "anthropic") actually produced this result -- set by the AI Router, never guessed by feature code.';
comment on column public.prompter_ai_jobs.actor_user_id is
  'The user who triggered this generation, when the call happened in a request context. Null for system-triggered jobs, if any exist in future.';
comment on column public.prompter_ai_jobs.fallback_provider is
  'Set only when the AI Router''s primary provider failed and a configured fallback provider served the request instead -- names the primary that failed.';
comment on column public.prompter_ai_jobs.error_category is
  'Coarse, provider-agnostic failure category for a FAILED job -- lets AI usage accounting query without parsing vendor-specific error text.';

create index if not exists idx_prompter_ai_jobs_actor on public.prompter_ai_jobs (actor_user_id) where actor_user_id is not null;
insert into public._linoe_sandbox_applied (version, sha256) values ('20260829155306', '55ad80cefe2b17096217f6b27ca36483e2b75160a9c56c1e6710ad242e7a33a0');

-- >>> 20260901120847_prompter_billing_foundation.sql  sha256=8f2fea245a46636a7bd33f59a2971c9ab4a32770641a133f8b3feb79fcb44881
-- Tanyopo AI Promoter — Billing foundation (provider-neutral).
--
-- Additive only, same rules as every prior Promoter migration: prefixed
-- `prompter_`, foreign-keys into the existing public.tenants, scoped by
-- the existing fn_current_tenant_id()/fn_current_role(). No UMKMpro
-- table is touched.
--
-- This is deliberately NOT a full billing/payments system. No payment
-- processor has been selected yet, so this only models what's known
-- today: which plan tier a tenant is on (Free by default — every tenant
-- must have a working row, never a missing one), and the *rate* a
-- success fee would be calculated at, which stays null (meaning "not
-- configured, no fee charged") until a real commercial rate is decided.
-- Actual prices are never invented here. Payment execution itself has no
-- table at all yet — there is nothing to execute against without a
-- chosen processor; see lib/billing/ for how the app surfaces that as
-- NOT_CONFIGURED rather than faking a working billing flow.
create table if not exists public.prompter_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan text not null default 'FREE' check (
    plan in ('FREE', 'PRO', 'BUSINESS', 'GROWTH', 'AGENCY', 'UMKMPRO_BUNDLE')
  ),
  status text not null default 'ACTIVE' check (
    status in ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED')
  ),
  -- Which payment processor is wired up for this tenant, if any. Null
  -- means no processor is configured — the billing UI must render that
  -- as NOT_CONFIGURED, never simulate a successful charge.
  billing_provider text,
  -- Success fee rate in basis points (1/100 of a percent), e.g. 500 =
  -- 5%. Null means "no rate has been commercially decided yet" — the
  -- success-fee calculator (lib/billing/success-fee.ts) must return
  -- NOT_CONFIGURED rather than assume a rate, and no fee is ever charged
  -- against total business revenue — only against verified attributed
  -- conversions (prompter_attributions where attribution_model =
  -- 'UMKMPRO_VERIFIED').
  success_fee_rate_bps integer,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_subscriptions_fee_rate_range check (
    success_fee_rate_bps is null or (success_fee_rate_bps >= 0 and success_fee_rate_bps <= 10000)
  )
);

comment on table public.prompter_subscriptions is
  'Tanyopo AI Promoter: per-tenant plan/subscription state. Provider-neutral -- billing_provider and success_fee_rate_bps are null (NOT_CONFIGURED) until a real processor/rate is chosen. Every tenant gets a FREE-plan row lazily on first access, same pattern as prompter_budget_policies.';

drop trigger if exists trg_prompter_subscriptions_updated_at on public.prompter_subscriptions;
create trigger trg_prompter_subscriptions_updated_at
  before update on public.prompter_subscriptions
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_subscriptions enable row level security;

drop policy if exists "Lihat subscription tenant sendiri" on public.prompter_subscriptions;
create policy "Lihat subscription tenant sendiri"
  on public.prompter_subscriptions for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Buat subscription tenant sendiri" on public.prompter_subscriptions;
create policy "Buat subscription tenant sendiri"
  on public.prompter_subscriptions for insert
  with check (tenant_id = public.fn_current_tenant_id());

-- Plan changes are financial governance, same owner-only pattern as
-- prompter_budget_policies. No app code updates billing_provider or
-- success_fee_rate_bps today (both stay null/NOT_CONFIGURED) -- those
-- fields exist for a future admin/billing-integration flow.
drop policy if exists "Owner kelola subscription" on public.prompter_subscriptions;
create policy "Owner kelola subscription"
  on public.prompter_subscriptions for update
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');
insert into public._linoe_sandbox_applied (version, sha256) values ('20260901120847', '8f2fea245a46636a7bd33f59a2971c9ab4a32770641a133f8b3feb79fcb44881');

-- >>> 20260901130513_prompter_billing_invoices.sql  sha256=f94e7cab392e9fadfa983513e771c1c6fe142506b61dc463f1ae0feb0aae1e6a
-- Tanyopo AI Promoter — Billing: invoices (provider-neutral).
--
-- Additive only. No prices are invented — amount/currency are nullable
-- and only ever populated from a real provider's invoice payload once
-- one is integrated (lib/billing/payment-provider.ts). Every field here
-- models structure, not fabricated data: a tenant with no payment
-- provider configured simply has zero rows, which the billing UI shows
-- as an honest empty state.
create table if not exists public.prompter_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Null until a real processor issues this invoice (matches
  -- prompter_subscriptions.billing_provider — same provider name).
  provider text,
  external_invoice_id text,
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE')
  ),
  amount numeric(14, 2),
  currency text not null default 'IDR',
  description text,
  period_start timestamptz,
  period_end timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Multiple NULL/NULL rows are mutually non-conflicting (Postgres
  -- treats NULLs as distinct in a unique constraint) — this only
  -- actually constrains real provider-issued invoices against
  -- duplicate delivery, same pattern as prompter_products/
  -- prompter_webhook_events elsewhere in this schema.
  constraint prompter_invoices_provider_external_unique unique (provider, external_invoice_id)
);

comment on table public.prompter_invoices is
  'Tanyopo AI Promoter: per-tenant invoice records. provider/external_invoice_id/amount are null until a real payment processor is integrated -- structure only, no fabricated data.';

drop trigger if exists trg_prompter_invoices_updated_at on public.prompter_invoices;
create trigger trg_prompter_invoices_updated_at
  before update on public.prompter_invoices
  for each row execute function public.prompter_set_updated_at();

create index if not exists idx_prompter_invoices_tenant on public.prompter_invoices (tenant_id, created_at desc);

alter table public.prompter_invoices enable row level security;

drop policy if exists "Lihat invoice tenant sendiri" on public.prompter_invoices;
create policy "Lihat invoice tenant sendiri"
  on public.prompter_invoices for select
  using (tenant_id = public.fn_current_tenant_id());

-- No INSERT/UPDATE/DELETE policy for anon/authenticated -- every invoice
-- is written by the service-role client from a verified payment-provider
-- webhook, same pattern as prompter_product_snapshots.
insert into public._linoe_sandbox_applied (version, sha256) values ('20260901130513', 'f94e7cab392e9fadfa983513e771c1c6fe142506b61dc463f1ae0feb0aae1e6a');

-- >>> 20260901131336_prompter_job_queue.sql  sha256=067436ff2c64b5023ffca6b8915d00dfda351339d2704ba11ad8033607ea85ff
-- Tanyopo AI Promoter — provider-neutral background job queue.
--
-- Additive only. This is a DB-backed "local/development" queue
-- implementation behind a swappable runtime interface
-- (lib/jobs/job-queue.ts) — nothing in the app is rewired to depend on
-- it yet (see services/jobs.ts docblock), so this migration changes no
-- existing behavior. A real external queue provider (SQS, Cloud Tasks,
-- a Redis-backed queue, ...) could replace the DB-backed claim/complete/
-- fail logic later without any caller changing, same pattern as every
-- other provider-neutral abstraction in this app (connectors, AI
-- router, payment provider).
create table if not exists public.prompter_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_type text not null check (job_type in (
    'AI_GENERATION', 'CONTENT_GENERATION', 'CAMPAIGN_EXECUTION', 'ANALYTICS_SYNC',
    'WEBHOOK_PROCESSING', 'SEO_JOB', 'OPTIMIZATION_JOB', 'EXTERNAL_API_RETRY'
  )),
  status text not null default 'PENDING' check (
    status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED')
  ),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  -- Nullable, and multiple NULLs are mutually non-conflicting (Postgres
  -- treats NULLs as distinct in a unique constraint) — only a caller
  -- that actually wants idempotency sets this, same pattern used
  -- throughout this schema (prompter_products, prompter_webhook_events).
  idempotency_key text,
  created_by uuid references auth.users(id),
  -- Next eligible execution time. Set to now() on enqueue; pushed
  -- forward by lib/jobs/backoff.ts's exponential backoff on each retry.
  run_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_jobs_max_attempts_positive check (max_attempts >= 1),
  constraint prompter_jobs_idempotency_unique unique (tenant_id, job_type, idempotency_key)
);

comment on table public.prompter_jobs is
  'Tanyopo AI Promoter: provider-neutral background job queue (DB-backed default implementation). No existing feature is wired to enqueue into this yet -- see services/jobs.ts.';

create index if not exists idx_prompter_jobs_tenant on public.prompter_jobs (tenant_id, created_at desc);
create index if not exists idx_prompter_jobs_claim on public.prompter_jobs (status, run_at) where status = 'PENDING';

drop trigger if exists trg_prompter_jobs_updated_at on public.prompter_jobs;
create trigger trg_prompter_jobs_updated_at
  before update on public.prompter_jobs
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_jobs enable row level security;

drop policy if exists "Lihat job tenant sendiri" on public.prompter_jobs;
create policy "Lihat job tenant sendiri"
  on public.prompter_jobs for select
  using (tenant_id = public.fn_current_tenant_id());

-- No INSERT/UPDATE/DELETE policy for anon/authenticated -- enqueue/claim/
-- complete/fail/cancel all go through the service-role client
-- (services/jobs.ts), so state transitions stay controlled and atomic
-- (see prompter_claim_next_job below) rather than something any tenant
-- session could corrupt.

-- ============================================================================
-- prompter_claim_next_job(p_job_types)
-- Atomically claims one PENDING, due (run_at <= now()) job — `for update
-- skip locked` so concurrent claimers never race for the same row or
-- block on each other. SECURITY DEFINER is required for this to see
-- across tenants (a queue worker is not scoped to one tenant the way a
-- normal request is), so unlike the RLS-scoped SELECT policy above,
-- access to this function itself is locked down explicitly below —
-- revoked from anon/authenticated, granted only to service_role. This
-- is the same SECURITY DEFINER pattern already used elsewhere in this
-- shared project (fn_current_tenant_id(), fn_current_role()), but with
-- explicit grants added rather than left at the Postgres default (grant
-- to PUBLIC), which is what the get_advisors security scan flags on
-- several pre-existing UMKMpro functions unrelated to this app.
--
-- Verified live (2026-09-01): enqueue -> claim (status PENDING->RUNNING,
-- attempts 0->1) -> second claim on the same job_type returns null (no
-- double-claim) -> complete -> idempotent re-insert on the same
-- (tenant_id, job_type, idempotency_key) raises 23505 as expected. Test
-- row deleted after verification, no data left behind.
-- ============================================================================
create or replace function public.prompter_claim_next_job(p_job_types text[] default null)
returns public.prompter_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.prompter_jobs;
begin
  select * into v_job
  from public.prompter_jobs
  where status = 'PENDING'
    and run_at <= now()
    and (p_job_types is null or job_type = any(p_job_types))
  order by run_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return null;
  end if;

  update public.prompter_jobs
  set status = 'RUNNING', started_at = now(), attempts = attempts + 1, updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.prompter_claim_next_job(text[]) from public;
revoke all on function public.prompter_claim_next_job(text[]) from anon;
revoke all on function public.prompter_claim_next_job(text[]) from authenticated;
grant execute on function public.prompter_claim_next_job(text[]) to service_role;
insert into public._linoe_sandbox_applied (version, sha256) values ('20260901131336', '067436ff2c64b5023ffca6b8915d00dfda351339d2704ba11ad8033607ea85ff');

commit;
