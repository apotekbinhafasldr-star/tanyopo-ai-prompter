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
