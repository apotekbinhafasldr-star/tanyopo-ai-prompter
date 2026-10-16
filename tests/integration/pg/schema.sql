-- ============================================================================
-- EPHEMERAL TEST FIXTURE -- NOT A MIGRATION. NEVER applied to Supabase.
--
-- Loaded by tests/integration/pg/global-setup.ts into the throw-away
-- PostgreSQL 16 service container (database "linoe_pg_test") ONLY, after the
-- isolation guard (pg-env.ts) has proven that:
--   * the host is local, the database is exactly "linoe_pg_test",
--   * no Supabase host / production credential is present in the environment,
--   * none of the production tables exist in this database.
--
-- It mirrors the columns, CHECK constraints, UNIQUE constraint, trigger and
-- RLS policies of public.prompter_channel_campaigns exactly as the repository's
-- migrations define them (a unit test, tests/unit/integration/pg-fixture-drift,
-- fails when they drift apart). Differences, on purpose:
--   * no foreign keys (the parent tables are production tables and must not
--     exist in this database),
--   * fn_current_tenant_id() / fn_current_role() read the session settings
--     app.tenant_id / app.role instead of auth.uid() + user_profiles.
-- ============================================================================

drop table if exists fixture_approvals, fixture_master_campaigns, prompter_audit_logs, prompter_automation_settings, prompter_channel_campaigns cascade;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create or replace function prompter_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace function fn_current_tenant_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function fn_current_role() returns text
language sql stable as $$ select nullif(current_setting('app.role', true), '') $$;

create table prompter_channel_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  master_campaign_id uuid not null,
  channel text not null check (channel in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X', 'SEO')),
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED')
  ),
  budget_percentage numeric(5, 2),
  external_campaign_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error text,
  scheduled_at timestamptz,
  constraint prompter_channel_campaigns_unique unique (master_campaign_id, channel),
  constraint prompter_channel_campaigns_budget_pct_range check (
    budget_percentage is null or (budget_percentage >= 0 and budget_percentage <= 100)
  )
);

create index idx_prompter_channel_campaigns_master on prompter_channel_campaigns (master_campaign_id);
create index idx_prompter_channel_campaigns_tenant on prompter_channel_campaigns (tenant_id);

create trigger trg_prompter_channel_campaigns_updated_at
  before update on prompter_channel_campaigns
  for each row execute function prompter_set_updated_at();

alter table prompter_channel_campaigns enable row level security;

create policy "Lihat channel campaign tenant sendiri"
  on prompter_channel_campaigns for select
  using (tenant_id = fn_current_tenant_id());

create policy "Owner/marketing kelola channel campaign"
  on prompter_channel_campaigns for all
  using (tenant_id = fn_current_tenant_id() and fn_current_role() in ('owner', 'marketing'))
  with check (tenant_id = fn_current_tenant_id() and fn_current_role() in ('owner', 'marketing'));

create table prompter_automation_settings (
  tenant_id uuid primary key,
  emergency_stop_active boolean not null default false
);

create table prompter_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_user_id uuid,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table prompter_audit_logs enable row level security;

create policy "Lihat audit log tenant sendiri"
  on prompter_audit_logs for select
  using (tenant_id = fn_current_tenant_id());

create policy "Tulis audit log tenant sendiri"
  on prompter_audit_logs for insert
  with check (tenant_id = fn_current_tenant_id());

-- H1 / PR #39 stand-ins for the approval + master-campaign flow. They use
-- NON-production names on purpose (pg-env.ts refuses to run when the real
-- prompter_master_campaigns / prompter_approvals exist) and carry only the
-- columns and status values the H1 statements touch.
create table fixture_master_campaigns (
  id uuid primary key,
  tenant_id uuid not null,
  channels text[] not null default '{}',
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED')
  )
);

create table fixture_approvals (
  id uuid primary key,
  tenant_id uuid not null,
  resource_id uuid not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  decided_at timestamptz
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
