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
