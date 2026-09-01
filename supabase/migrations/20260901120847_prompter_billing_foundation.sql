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
