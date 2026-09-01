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
