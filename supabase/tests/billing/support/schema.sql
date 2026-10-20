-- TEST SUPPORT ONLY (local throw-away PostgreSQL, synthetic data). Minimal reconstruction of
-- the production objects the billing migrations touch. The real B10 / lifecycle function
-- bodies are loaded from the repository migrations by run-local.sh, not re-typed here.
drop schema if exists public cascade;
create schema public;
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.tenants (id uuid primary key default gen_random_uuid());
create table public.user_profiles (id uuid primary key default gen_random_uuid());

-- Session identity stubs (production reads the JWT; tests set these GUCs).
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create function public.fn_current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;
create function public.fn_current_role() returns text language sql stable as $$ select nullif(current_setting('app.role', true), '') $$;
create function public.prompter_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create table public.prompter_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan text default 'FREE',
  status text not null default 'TRIALING' check (status in ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED')),
  billing_provider text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_subscription_id text
);
create table public.prompter_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid, actor_user_id uuid, action text, resource_type text, resource_id uuid, context jsonb
);
create table public.prompter_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  source_system text not null default 'umkmpro',
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')),
  error text, received_at timestamptz not null default now(), processed_at timestamptz,
  constraint prompter_webhook_events_unique unique (source_system, external_event_id)
);

-- Exact DDL of prompter_payment_transactions from 20260915051359_prompter_b10_payment_billing_core.sql.
create table public.prompter_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete set null,
  provider text not null,
  provider_payment_id text,
  provider_event_id text,
  plan text not null check (plan in ('FREE', 'STARTER', 'PRO', 'BUSINESS', 'GROWTH', 'AGENCY', 'UMKMPRO_BUNDLE')),
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'IDR',
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED')),
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint prompter_payment_transactions_provider_payment_unique unique (provider, provider_payment_id)
);
create trigger trg_prompter_payment_transactions_updated_at
  before update on public.prompter_payment_transactions
  for each row execute function public.prompter_set_updated_at();
alter table public.prompter_payment_transactions enable row level security;
create policy "Lihat payment transaction tenant sendiri" on public.prompter_payment_transactions
  for select using (tenant_id = public.fn_current_tenant_id());
create policy "Buat payment transaction tenant sendiri" on public.prompter_payment_transactions
  for insert with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner'
    and status = 'PENDING' and provider_payment_id is null and provider_event_id is null and paid_at is null);
grant select, insert on public.prompter_payment_transactions to authenticated;

-- Simple assertion helper for the SQL tests.
create function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if c is not true then raise exception 'ASSERTION FAILED: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;
