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
