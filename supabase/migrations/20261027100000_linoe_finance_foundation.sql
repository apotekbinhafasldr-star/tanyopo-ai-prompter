-- LINOE Finance & Tax foundation (Phase A) — ADDITIVE ONLY, NOT APPLIED to any environment.
--
-- Creates the platform-level finance tables used by lib/finance and
-- services/finance-admin.ts:
--   finance_platform_admins        who may see platform finance data (NOT the tenant owner role)
--   finance_ledger_entries         append-only ledger, one row per financial fact, UNIQUE idempotency_key
--   finance_refunds                refunds and their lifecycle
--   finance_settlements            gateway payouts
--   finance_operating_expenses     expenses; never deleted, only voided
--   finance_tax_settings           append-only tax configuration versions (no default rates)
--   finance_audit_logs             immutable audit trail
--
-- Safety properties (checked by tests/unit/migrations/finance-foundation.test.ts):
--   * touches NO existing table, function, policy, cron job or Edge Function;
--   * money is bigint minor units (scale 2), never float/numeric/double;
--   * RLS is enabled with NO policies and anon/authenticated lose every grant, so only the
--     service role (used server-side after the finance-admin gate) can read or write;
--   * service_role gets no DELETE and no TRUNCATE; ledger and audit rows are immutable via triggers.
--
-- Rollback: supabase/rollback/20261027100000_linoe_finance_foundation.down.sql (refuses if any table has rows).
set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------
create or replace function public.fn_finance_block_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'finance table % is append-only (% blocked)', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

create or replace function public.fn_finance_audit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor uuid;
  entity text;
  payload jsonb;
begin
  begin
    actor := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when others then
    actor := null;
  end;
  if tg_op = 'DELETE' then
    payload := to_jsonb(old);
  else
    payload := to_jsonb(new);
  end if;
  entity := coalesce(payload ->> 'id', payload ->> 'user_id');
  insert into public.finance_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (actor, tg_op, tg_table_name, entity, payload);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_audit_logs (created first: other tables' audit triggers write to it)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- finance_platform_admins
-- ---------------------------------------------------------------------------
create table if not exists public.finance_platform_admins (
  user_id uuid primary key references auth.users (id) on delete restrict,
  role text not null check (role in ('FINANCE_ADMIN', 'FINANCE_VIEWER')),
  is_active boolean not null default true,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  note text
);

-- ---------------------------------------------------------------------------
-- finance_ledger_entries
-- ---------------------------------------------------------------------------
create table if not exists public.finance_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 3 and 300),
  entry_type text not null check (entry_type in ('PAYMENT_VERIFIED', 'REFUND', 'GATEWAY_FEE', 'SETTLEMENT', 'EXPENSE')),
  direction text not null check (direction in ('IN', 'OUT')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_at timestamptz,
  provider text,
  provider_ref text,
  tenant_id uuid,
  source_event_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists finance_ledger_entries_type_effective_idx
  on public.finance_ledger_entries (entry_type, effective_at);

-- ---------------------------------------------------------------------------
-- finance_refunds
-- ---------------------------------------------------------------------------
create table if not exists public.finance_refunds (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_refund_id text not null,
  provider_payment_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('REQUESTED', 'APPROVED', 'PROCESSED', 'FAILED')),
  processed_at timestamptz,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_refund_id),
  check (status <> 'PROCESSED' or processed_at is not null)
);
create index if not exists finance_refunds_payment_idx on public.finance_refunds (provider, provider_payment_id);

-- ---------------------------------------------------------------------------
-- finance_settlements
-- ---------------------------------------------------------------------------
create table if not exists public.finance_settlements (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_settlement_id text not null,
  settled_at timestamptz not null,
  gross_minor bigint not null check (gross_minor >= 0),
  fee_minor bigint not null check (fee_minor >= 0),
  refund_deducted_minor bigint not null default 0 check (refund_deducted_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_settlement_id)
);

-- ---------------------------------------------------------------------------
-- finance_operating_expenses (never deleted; voiding is the only change allowed)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_operating_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null check (length(category) between 1 and 80),
  vendor text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  tax_minor bigint check (tax_minor is null or tax_minor >= 0),
  receipt_ref text,
  is_void boolean not null default false,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (is_void = (voided_at is not null))
);
create index if not exists finance_operating_expenses_date_idx on public.finance_operating_expenses (expense_date);

create or replace function public.fn_finance_expense_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'finance expenses are never deleted; void them instead' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.expense_date is distinct from old.expense_date
     or new.category is distinct from old.category
     or new.vendor is distinct from old.vendor
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.tax_minor is distinct from old.tax_minor
     or new.receipt_ref is distinct from old.receipt_ref
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'only voiding is allowed on a finance expense' using errcode = '42501';
  end if;
  if old.is_void and not new.is_void then
    raise exception 'a voided finance expense cannot be restored' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_tax_settings (append-only versions; no default rates anywhere)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_tax_settings (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  pkp_status text not null default 'UNVERIFIED' check (pkp_status in ('UNVERIFIED', 'PKP', 'NON_PKP')),
  ppn_rate_bps integer check (ppn_rate_bps is null or ppn_rate_bps between 1 and 10000),
  prices_include_ppn boolean,
  final_tax_rate_bps integer check (final_tax_rate_bps is null or final_tax_rate_bps between 1 and 10000),
  annual_threshold_minor bigint check (annual_threshold_minor is null or annual_threshold_minor > 0),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  verified_by text,
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  -- a configuration only counts as verified when someone is named and dated; any rate needs that
  check (
    (pkp_status = 'UNVERIFIED' and ppn_rate_bps is null and final_tax_rate_bps is null)
    or (verified_by is not null and verified_at is not null)
  )
);

-- ---------------------------------------------------------------------------
-- Immutability + audit triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_finance_audit_logs_immutable on public.finance_audit_logs;
create trigger trg_finance_audit_logs_immutable
  before update or delete on public.finance_audit_logs
  for each row execute function public.fn_finance_block_mutation();
drop trigger if exists trg_finance_audit_logs_no_truncate on public.finance_audit_logs;
create trigger trg_finance_audit_logs_no_truncate
  before truncate on public.finance_audit_logs
  for each statement execute function public.fn_finance_block_mutation();

drop trigger if exists trg_finance_ledger_immutable on public.finance_ledger_entries;
create trigger trg_finance_ledger_immutable
  before update or delete on public.finance_ledger_entries
  for each row execute function public.fn_finance_block_mutation();
drop trigger if exists trg_finance_ledger_no_truncate on public.finance_ledger_entries;
create trigger trg_finance_ledger_no_truncate
  before truncate on public.finance_ledger_entries
  for each statement execute function public.fn_finance_block_mutation();

drop trigger if exists trg_finance_tax_settings_immutable on public.finance_tax_settings;
create trigger trg_finance_tax_settings_immutable
  before update or delete on public.finance_tax_settings
  for each row execute function public.fn_finance_block_mutation();

drop trigger if exists trg_finance_expenses_guard on public.finance_operating_expenses;
create trigger trg_finance_expenses_guard
  before update or delete on public.finance_operating_expenses
  for each row execute function public.fn_finance_expense_guard();

drop trigger if exists trg_finance_ledger_audit on public.finance_ledger_entries;
create trigger trg_finance_ledger_audit
  after insert on public.finance_ledger_entries
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_refunds_audit on public.finance_refunds;
create trigger trg_finance_refunds_audit
  after insert or update on public.finance_refunds
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_settlements_audit on public.finance_settlements;
create trigger trg_finance_settlements_audit
  after insert on public.finance_settlements
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_expenses_audit on public.finance_operating_expenses;
create trigger trg_finance_expenses_audit
  after insert or update on public.finance_operating_expenses
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_tax_settings_audit on public.finance_tax_settings;
create trigger trg_finance_tax_settings_audit
  after insert on public.finance_tax_settings
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_admins_audit on public.finance_platform_admins;
create trigger trg_finance_admins_audit
  after insert or update on public.finance_platform_admins
  for each row execute function public.fn_finance_audit();

-- ---------------------------------------------------------------------------
-- Row level security: enabled, NO policies => anon/authenticated see nothing.
-- Grants: everything revoked from public/anon/authenticated AND service_role, then service_role is granted only what it needs.
-- service_role must be revoked explicitly: in Supabase the DEFAULT PRIVILEGES of schema public hand every new table, sequence and
-- function to anon, authenticated and service_role, so a GRANT alone would leave service_role with DELETE/TRUNCATE/UPDATE.
-- (Trigger functions need no EXECUTE for the role that fires them; the grant is checked when the trigger is created.)
-- ---------------------------------------------------------------------------
alter table public.finance_audit_logs enable row level security;
alter table public.finance_platform_admins enable row level security;
alter table public.finance_ledger_entries enable row level security;
alter table public.finance_refunds enable row level security;
alter table public.finance_settlements enable row level security;
alter table public.finance_operating_expenses enable row level security;
alter table public.finance_tax_settings enable row level security;

revoke all on public.finance_audit_logs from public, anon, authenticated, service_role;
revoke all on public.finance_platform_admins from public, anon, authenticated, service_role;
revoke all on public.finance_ledger_entries from public, anon, authenticated, service_role;
revoke all on public.finance_refunds from public, anon, authenticated, service_role;
revoke all on public.finance_settlements from public, anon, authenticated, service_role;
revoke all on public.finance_operating_expenses from public, anon, authenticated, service_role;
revoke all on public.finance_tax_settings from public, anon, authenticated, service_role;
revoke all on sequence public.finance_audit_logs_id_seq from public, anon, authenticated, service_role;

grant select, insert on public.finance_audit_logs to service_role;
grant select, insert, update on public.finance_platform_admins to service_role;
grant select, insert on public.finance_ledger_entries to service_role;
grant select, insert, update on public.finance_refunds to service_role;
grant select, insert on public.finance_settlements to service_role;
grant select, insert, update on public.finance_operating_expenses to service_role;
grant select, insert on public.finance_tax_settings to service_role;
grant usage on sequence public.finance_audit_logs_id_seq to service_role;

revoke all on function public.fn_finance_block_mutation() from public, anon, authenticated, service_role;
revoke all on function public.fn_finance_audit() from public, anon, authenticated, service_role;
revoke all on function public.fn_finance_expense_guard() from public, anon, authenticated, service_role;
