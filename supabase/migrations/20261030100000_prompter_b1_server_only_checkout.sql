-- LINOE Billing B1: transactions are created ONLY by a trusted server path, priced ONLY from the database catalog.
-- NOT APPLIED to any database by the PR that adds this file.
--
-- Closes (Billing P0 audit): an Owner could INSERT a PENDING prompter_payment_transactions row directly over
-- PostgREST with ANY plan / amount / currency / provider (policy "Buat payment transaction tenant sendiri"), and the
-- evidence table still carried client UPDATE / DELETE / TRUNCATE grants.
--
-- What this does (one transaction, additive except the policy/grant revocations):
--   1. prompter_plan_prices: the price catalog in the DATABASE (no client access at all; seeded from lib/billing/plans.ts,
--      kept in sync by a drift test).
--   2. fn_begin_checkout(tenant, user, plan, provider): service_role only. NO amount / currency parameter exists, so no
--      caller can supply a price. It re-checks in SQL that the user is an Owner of that tenant, that the plan has a
--      catalog price and is ACTIVE in prompter_plan_entitlements, and it caps open PENDING rows per tenant.
--   3. fn_payment_txn_insert_guard + trigger (defense in depth, any role): a new transaction must be PENDING, carry no
--      provider ids / paid_at, and match the catalog price and currency exactly. Client roles are rejected outright.
--   4. DROP the client INSERT policy; REVOKE all client write privileges (INSERT/UPDATE/DELETE/TRUNCATE) on
--      prompter_payment_transactions. SELECT for the tenant's own rows (RLS) is unchanged.
--
-- Compatible with PR #74 (20261029220000): touches nothing of prompter_subscriptions / fn_set_trial_plan_preference;
-- fn_apply_verified_payment (webhook path, service_role) is not modified and keeps working.
-- Deploy order: apply this migration, then merge/deploy the app (either order is fail-closed while live payments are HOLD).
-- Rollback: supabase/rollback/20261030100000_prompter_b1_server_only_checkout.down.sql (fail-closed, needs confirmation).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. Price catalog (database-side source of truth for what a checkout may charge).
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_plan_prices (
  plan text primary key references public.prompter_plan_entitlements(plan),
  price_idr integer not null check (price_idr > 0),
  currency text not null default 'IDR' check (currency = 'IDR'),
  billing_period text not null default 'MONTH' check (billing_period = 'MONTH'),
  updated_at timestamptz not null default now(),
  constraint prompter_plan_prices_not_free check (plan <> 'FREE')
);

comment on table public.prompter_plan_prices is
  'Billing B1: the only price list a checkout may use (fn_begin_checkout and the payment-transaction insert guard read it). Mirrors lib/billing/plans.ts PLAN_TIERS priceIDR for sellable plans (a unit test fails on drift). No client access; only a migration / service_role may change it. A plan is purchasable only if it has a row here AND is ACTIVE in prompter_plan_entitlements (so AGENCY / COMING_SOON and UMKMPRO_BUNDLE are not sellable).';

drop trigger if exists trg_prompter_plan_prices_updated_at on public.prompter_plan_prices;
create trigger trg_prompter_plan_prices_updated_at
  before update on public.prompter_plan_prices
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_plan_prices enable row level security;
revoke all on public.prompter_plan_prices from public, anon, authenticated;

insert into public.prompter_plan_prices (plan, price_idr)
select v.plan, v.price_idr
from (values ('STARTER', 99000), ('GROWTH', 199000), ('PRO', 399000), ('BUSINESS', 799000)) as v(plan, price_idr)
where exists (select 1 from public.prompter_plan_entitlements e where e.plan = v.plan)
on conflict (plan) do nothing;

-- ---------------------------------------------------------------------------
-- 2. fn_begin_checkout: the single server-side way to create a PENDING transaction.
--    Outcomes (out_outcome): CREATED | INVALID | NOT_MEMBER | NOT_OWNER | PLAN_NOT_PURCHASABLE |
--                            PLAN_NOT_AVAILABLE | NO_SUBSCRIPTION | TOO_MANY_PENDING
--    Never raises for a business condition. Amount and currency are returned FROM the catalog.
-- ---------------------------------------------------------------------------
create or replace function public.fn_begin_checkout(
  p_tenant_id uuid,
  p_user_id uuid,
  p_plan text,
  p_provider text
) returns table(out_transaction_id uuid, out_amount numeric, out_currency text, out_outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_tenant uuid;
  v_role text;
  v_price integer;
  v_currency text;
  v_availability text;
  v_pending integer;
  v_new uuid;
begin
  if p_tenant_id is null or p_user_id is null
     or coalesce(p_plan, '') = ''
     or p_provider is null or p_provider !~ '^[A-Za-z0-9_-]{2,40}$' then
    return query select null::uuid, null::numeric, null::text, 'INVALID'::text;
    return;
  end if;

  -- Independent of whatever the application already checked: the user must be an Owner of THIS tenant.
  select tenant_id, role into v_member_tenant, v_role from public.user_profiles where id = p_user_id;
  if not found or v_member_tenant is distinct from p_tenant_id then
    return query select null::uuid, null::numeric, null::text, 'NOT_MEMBER'::text;
    return;
  end if;
  if v_role is distinct from 'owner' then
    return query select null::uuid, null::numeric, null::text, 'NOT_OWNER'::text;
    return;
  end if;

  select pr.price_idr, pr.currency, e.availability
    into v_price, v_currency, v_availability
  from public.prompter_plan_prices pr
  join public.prompter_plan_entitlements e on e.plan = pr.plan
  where pr.plan = p_plan;
  if not found then
    return query select null::uuid, null::numeric, null::text, 'PLAN_NOT_PURCHASABLE'::text;
    return;
  end if;
  if v_availability is distinct from 'ACTIVE' then
    return query select null::uuid, null::numeric, null::text, 'PLAN_NOT_AVAILABLE'::text;
    return;
  end if;

  perform 1 from public.prompter_subscriptions where tenant_id = p_tenant_id;
  if not found then
    return query select null::uuid, null::numeric, null::text, 'NO_SUBSCRIPTION'::text;
    return;
  end if;

  -- Serialise checkout creation per tenant, then cap abandoned PENDING rows (spam / enumeration guard).
  perform pg_advisory_xact_lock(hashtext('prompter_checkout:' || p_tenant_id::text));
  select count(*) into v_pending
  from public.prompter_payment_transactions
  where tenant_id = p_tenant_id and status = 'PENDING' and created_at > now() - interval '1 hour';
  if v_pending >= 10 then
    return query select null::uuid, null::numeric, null::text, 'TOO_MANY_PENDING'::text;
    return;
  end if;

  insert into public.prompter_payment_transactions (tenant_id, user_id, provider, plan, amount, currency)
  values (p_tenant_id, p_user_id, p_provider, p_plan, v_price, v_currency)
  returning id into v_new;

  return query select v_new, v_price::numeric, v_currency, 'CREATED'::text;
end;
$$;

comment on function public.fn_begin_checkout(uuid, uuid, text, text) is
  'Billing B1: creates a PENDING payment transaction priced from prompter_plan_prices. No amount or currency parameter by design. service_role only; the application passes the tenant / user from the verified session and this function re-verifies Owner membership in SQL.';

revoke all on function public.fn_begin_checkout(uuid, uuid, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_begin_checkout(uuid, uuid, text, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Defense in depth for ANY insert into prompter_payment_transactions (including a buggy server path).
--    SECURITY INVOKER on purpose: current_user is the real caller (anon / authenticated under PostgREST, the function
--    owner inside the SECURITY DEFINER fn_begin_checkout), exactly as in the PR #74 trigger.
-- ---------------------------------------------------------------------------
create or replace function public.fn_payment_txn_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_price integer;
  v_currency text;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'payment transactions can only be created by the server (fn_begin_checkout)'
      using errcode = '42501';
  end if;
  if new.status is distinct from 'PENDING'
     or new.provider_payment_id is not null or new.provider_event_id is not null or new.paid_at is not null then
    raise exception 'a new payment transaction must be PENDING with no provider ids and no paid_at'
      using errcode = '23514';
  end if;
  select price_idr, currency into v_price, v_currency from public.prompter_plan_prices where plan = new.plan;
  if not found or new.amount is distinct from v_price::numeric or new.currency is distinct from v_currency then
    raise exception 'payment transaction plan / amount / currency does not match the server price catalog'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.fn_payment_txn_insert_guard() is
  'Billing B1: rejects client-role inserts and any insert whose plan / amount / currency differs from prompter_plan_prices, or that is not a clean PENDING row. Fires for every role.';

drop trigger if exists trg_prompter_payment_txn_insert_guard on public.prompter_payment_transactions;
create trigger trg_prompter_payment_txn_insert_guard
  before insert on public.prompter_payment_transactions
  for each row execute function public.fn_payment_txn_insert_guard();

-- ---------------------------------------------------------------------------
-- 4. No client write path to the payment evidence table. Reads (own tenant, via RLS) are unchanged.
--    Existing rows are not touched (no INSERT / UPDATE / DELETE of data in this migration except the catalog seed).
-- ---------------------------------------------------------------------------
drop policy if exists "Buat payment transaction tenant sendiri" on public.prompter_payment_transactions;
revoke all on public.prompter_payment_transactions from public, anon, authenticated;
grant select on public.prompter_payment_transactions to authenticated;
