-- LINOE Billing Financial Safety (F1-F4). NOT APPLIED to any database by this PR.
-- Additive and backward compatible: no table or column dropped, no existing row
-- rewritten, fn_apply_verified_payment() (v1) and the existing RLS policies are
-- left untouched. The only existing object replaced is
-- fn_expire_stale_payment_transactions() (same signature, safer predicate); its
-- previous body is restored by supabase/rollback/20261020160000_*.down.sql.
--
-- What this adds (design: docs/BILLING_FINANCIAL_SAFETY.md):
--  F3  stable checkout intent + serialized, reusable checkout (fn_begin_checkout)
--  F1  every payment event is written to an append-only ledger; verified money that
--      cannot be applied automatically goes to an auditable exception queue instead
--      of being discarded; late PAID on EXPIRED/FAILED is applied, not rejected
--  F2  a bad payload (amount 0/missing, mismatch) never flips a transaction to
--      FAILED any more; it is recorded and the transaction stays recoverable
--  F4  renewal extends from max(now(), current_period_end); a second real payment
--      for the same coverage is recorded and NEEDS_REVIEW, never silently dropped
--      and never extends twice
--  reconciliation primitives (claim batch with backoff, record attempt) so the app
--      can ask the gateway before a transaction is expired
-- Refund / credit / chargeback are business decisions: they surface as NEEDS_REVIEW
-- and nothing here refunds money or revokes access automatically.

-- ---------------------------------------------------------------------------
-- 1. Columns on prompter_payment_transactions (all nullable or defaulted).
-- ---------------------------------------------------------------------------
alter table public.prompter_payment_transactions
  add column if not exists intent_key text,
  add column if not exists checkout_url text,
  add column if not exists checkout_expires_at timestamptz,
  add column if not exists activation_state text not null default 'NONE',
  add column if not exists applied_at timestamptz,
  add column if not exists reconcile_attempts integer not null default 0,
  add column if not exists next_reconcile_at timestamptz,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists gateway_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'prompter_payment_transactions_activation_state_check'
      and conrelid = 'public.prompter_payment_transactions'::regclass
  ) then
    alter table public.prompter_payment_transactions
      add constraint prompter_payment_transactions_activation_state_check
      check (activation_state in ('NONE', 'APPLIED', 'NEEDS_REVIEW'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'prompter_payment_transactions_intent_key_check'
      and conrelid = 'public.prompter_payment_transactions'::regclass
  ) then
    alter table public.prompter_payment_transactions
      add constraint prompter_payment_transactions_intent_key_check
      check (intent_key is null or intent_key ~ '^[A-Za-z0-9_-]{8,64}$');
  end if;
end $$;

comment on column public.prompter_payment_transactions.activation_state is
  'NONE = nothing applied by the v2 path (includes every pre-existing row; backfill is a separate, not-yet-planned step). APPLIED = subscription extended exactly once for this transaction. NEEDS_REVIEW = money verified and ledgered but NOT applied (duplicate, plan change, missing subscription...): a human decides credit/refund/extension.';

-- A stable checkout intent is unique per tenant. No time-based predicate, no
-- (tenant, plan) uniqueness: renewals of the same plan stay possible.
create unique index if not exists uq_prompter_payment_txn_tenant_intent
  on public.prompter_payment_transactions (tenant_id, intent_key)
  where intent_key is not null;

-- Reconciliation work-queue scan (static predicate only).
create index if not exists idx_prompter_payment_txn_reconcile
  on public.prompter_payment_transactions (next_reconcile_at)
  where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- 2. Append-only payment ledger. Every webhook / reconciliation observation and
--    every applied or rejected payment is a row. No UPDATE, DELETE or TRUNCATE
--    is possible (triggers), and no client role can write. tenant_id and
--    transaction_id are deliberately NOT foreign keys: a ledger must survive a
--    tenant/transaction cascade delete (and an append-only table cannot be
--    cascade-deleted from).
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_payment_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid,
  transaction_id uuid,
  provider text not null,
  provider_payment_id text,
  provider_event_id text,
  event_kind text not null check (event_kind in ('WEBHOOK', 'RECONCILIATION', 'CHECKOUT', 'REVIEW')),
  observed_status text,
  amount numeric(14, 2),
  currency text,
  outcome text not null check (outcome in ('APPLIED', 'ALREADY_APPLIED', 'RECORDED', 'EXCEPTION', 'REVIEW_RESOLVED')),
  reason text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.prompter_payment_ledger is
  'Append-only financial event ledger. detail never holds secrets or full gateway payloads, only non-sensitive fields.';

create index if not exists idx_prompter_payment_ledger_txn on public.prompter_payment_ledger (transaction_id, seq);
create index if not exists idx_prompter_payment_ledger_tenant on public.prompter_payment_ledger (tenant_id, seq desc);

create or replace function public.fn_payment_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'prompter_payment_ledger is append-only (% blocked)', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists trg_prompter_payment_ledger_no_mutation on public.prompter_payment_ledger;
create trigger trg_prompter_payment_ledger_no_mutation
  before update or delete on public.prompter_payment_ledger
  for each row execute function public.fn_payment_ledger_immutable();

drop trigger if exists trg_prompter_payment_ledger_no_truncate on public.prompter_payment_ledger;
create trigger trg_prompter_payment_ledger_no_truncate
  before truncate on public.prompter_payment_ledger
  for each statement execute function public.fn_payment_ledger_immutable();

alter table public.prompter_payment_ledger enable row level security;
revoke all on public.prompter_payment_ledger from public, anon, authenticated;
grant select on public.prompter_payment_ledger to authenticated;

drop policy if exists "Lihat ledger pembayaran tenant sendiri" on public.prompter_payment_ledger;
create policy "Lihat ledger pembayaran tenant sendiri"
  on public.prompter_payment_ledger for select
  using (tenant_id = public.fn_current_tenant_id());

-- ---------------------------------------------------------------------------
-- 3. Exception queue (internal, service_role only). One OPEN row per distinct
--    problem; a redelivered event does not create a second OPEN row. Resolution
--    is an explicit, ledgered action.
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  transaction_id uuid,
  ledger_id uuid not null references public.prompter_payment_ledger(id),
  code text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);

create unique index if not exists uq_prompter_payment_exceptions_open_dedupe
  on public.prompter_payment_exceptions (dedupe_key)
  where status = 'OPEN';
create index if not exists idx_prompter_payment_exceptions_open
  on public.prompter_payment_exceptions (created_at)
  where status = 'OPEN';

alter table public.prompter_payment_exceptions enable row level security;
revoke all on public.prompter_payment_exceptions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers (not callable by clients).
-- ---------------------------------------------------------------------------
create or replace function public.fn_payment_ledger_add(
  p_tenant uuid, p_txn uuid, p_provider text, p_pay_id text, p_event_id text, p_kind text,
  p_status text, p_amount numeric, p_currency text, p_outcome text, p_reason text, p_detail jsonb
) returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.prompter_payment_ledger
    (tenant_id, transaction_id, provider, provider_payment_id, provider_event_id, event_kind,
     observed_status, amount, currency, outcome, reason, detail)
  values
    (p_tenant, p_txn, p_provider, p_pay_id, p_event_id, p_kind,
     p_status, p_amount, p_currency, p_outcome, p_reason, coalesce(p_detail, '{}'::jsonb))
  returning id;
$$;

create or replace function public.fn_payment_flag_exception(
  p_tenant uuid, p_txn uuid, p_provider text, p_pay_id text, p_event_id text, p_kind text,
  p_status text, p_amount numeric, p_currency text, p_code text, p_detail jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger uuid;
begin
  v_ledger := public.fn_payment_ledger_add(
    p_tenant, p_txn, p_provider, p_pay_id, p_event_id, p_kind,
    p_status, p_amount, p_currency, 'EXCEPTION', p_code, p_detail);
  insert into public.prompter_payment_exceptions (tenant_id, transaction_id, ledger_id, code, dedupe_key)
  values (p_tenant, p_txn, v_ledger, p_code,
          p_code || ':' || coalesce(p_txn::text, '-') || ':' || coalesce(p_pay_id, '-'))
  on conflict (dedupe_key) where status = 'OPEN' do nothing;
  return v_ledger;
end;
$$;

revoke all on function public.fn_payment_ledger_add(uuid, uuid, text, text, text, text, text, numeric, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fn_payment_flag_exception(uuid, uuid, text, text, text, text, text, numeric, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. F3 - fn_begin_checkout: serialized, intent-stable, reusing. service_role
--    only: the server action derives tenant/user from the verified session and
--    the price from lib/billing/plans.ts, so no client-supplied amount or tenant
--    ever reaches this function.
--    Outcomes: CREATED | REUSED | IN_PROGRESS | INTENT_CLOSED | INTENT_STALE |
--              NO_TENANT | INVALID
-- ---------------------------------------------------------------------------
create or replace function public.fn_begin_checkout(
  p_tenant_id uuid,
  p_user_id uuid,
  p_plan text,
  p_amount numeric,
  p_currency text,
  p_provider text,
  p_intent_key text default null
) returns table(out_transaction_id uuid, out_checkout_url text, out_outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
  v_user uuid;
  v_new uuid;
begin
  if p_tenant_id is null or p_plan is null or p_amount is null or p_amount <= 0
     or coalesce(p_provider, '') = '' or coalesce(p_currency, '') = ''
     or p_plan not in ('STARTER', 'PRO', 'BUSINESS', 'GROWTH', 'AGENCY', 'UMKMPRO_BUNDLE')
     or (p_intent_key is not null and p_intent_key !~ '^[A-Za-z0-9_-]{8,64}$') then
    return query select null::uuid, null::text, 'INVALID'::text;
    return;
  end if;

  perform 1 from public.tenants where id = p_tenant_id;
  if not found then
    return query select null::uuid, null::text, 'NO_TENANT'::text;
    return;
  end if;

  -- One checkout decision at a time per tenant+plan.
  perform pg_advisory_xact_lock(hashtext('prompter_checkout:' || p_tenant_id::text || ':' || p_plan));

  if p_intent_key is not null then
    select * into v_txn from public.prompter_payment_transactions
    where tenant_id = p_tenant_id and intent_key = p_intent_key;
    if found then
      if v_txn.status = 'PENDING' and v_txn.checkout_url is not null
         and (v_txn.checkout_expires_at is null or v_txn.checkout_expires_at > now()) then
        return query select v_txn.id, v_txn.checkout_url, 'REUSED'::text;
      elsif v_txn.status = 'PENDING' and v_txn.checkout_url is null
            and v_txn.created_at > now() - interval '60 seconds' then
        return query select v_txn.id, null::text, 'IN_PROGRESS'::text;
      elsif v_txn.status = 'PENDING' and v_txn.checkout_url is null then
        return query select v_txn.id, null::text, 'INTENT_STALE'::text;
      else
        return query select v_txn.id, null::text, 'INTENT_CLOSED'::text;
      end if;
      return;
    end if;
  end if;

  -- No matching intent: reuse a still-open checkout for the same purchase.
  select * into v_txn
  from public.prompter_payment_transactions
  where tenant_id = p_tenant_id and plan = p_plan and provider = p_provider
    and amount = p_amount and currency = p_currency and status = 'PENDING'
    and ((checkout_url is not null and (checkout_expires_at is null or checkout_expires_at > now()))
         or (checkout_url is null and created_at > now() - interval '60 seconds'))
  order by created_at desc
  limit 1;
  if found then
    if v_txn.checkout_url is not null then
      return query select v_txn.id, v_txn.checkout_url, 'REUSED'::text;
    else
      return query select v_txn.id, null::text, 'IN_PROGRESS'::text;
    end if;
    return;
  end if;

  select id into v_user from public.user_profiles where id = p_user_id;

  begin
    insert into public.prompter_payment_transactions (tenant_id, user_id, provider, plan, amount, currency, intent_key)
    values (p_tenant_id, v_user, p_provider, p_plan, p_amount, p_currency, p_intent_key)
    returning id into v_new;
  exception when unique_violation then
    -- Same intent key raced in through a different plan lock: treat as in progress.
    select * into v_txn from public.prompter_payment_transactions
    where tenant_id = p_tenant_id and intent_key = p_intent_key;
    return query select v_txn.id, null::text, 'IN_PROGRESS'::text;
    return;
  end;

  perform public.fn_payment_ledger_add(p_tenant_id, v_new, p_provider, null, null, 'CHECKOUT',
    'PENDING', p_amount, p_currency, 'RECORDED', 'CHECKOUT_CREATED', jsonb_build_object('plan', p_plan));

  return query select v_new, null::text, 'CREATED'::text;
end;
$$;

-- Links the gateway invoice to the transaction. A conflicting gateway reference
-- (already used by another transaction) is reported, never raised.
create or replace function public.fn_record_checkout_session(
  p_transaction_id uuid,
  p_provider_payment_id text,
  p_checkout_url text,
  p_checkout_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
begin
  select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  begin
    update public.prompter_payment_transactions
    set provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
        checkout_url = coalesce(checkout_url, p_checkout_url),
        checkout_expires_at = coalesce(checkout_expires_at, p_checkout_expires_at)
    where id = p_transaction_id and status = 'PENDING';
  exception when unique_violation then
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, v_txn.provider, p_provider_payment_id,
      null, 'CHECKOUT', 'PENDING', v_txn.amount, v_txn.currency, 'DUPLICATE_GATEWAY_REFERENCE', '{}'::jsonb);
    return 'CONFLICT';
  end;
  return 'OK';
end;
$$;

-- Invoice creation failed before any gateway reference existed. A late PAID for
-- this row would still be applied by fn_apply_payment_event.
create or replace function public.fn_mark_checkout_failed(p_transaction_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
begin
  update public.prompter_payment_transactions
  set status = 'FAILED', failure_reason = left(coalesce(p_reason, 'CHECKOUT_CREATE_FAILED'), 120)
  where id = p_transaction_id and status = 'PENDING'
    and provider_payment_id is null and checkout_url is null
  returning * into v_txn;
  if not found then
    return false;
  end if;
  perform public.fn_payment_ledger_add(v_txn.tenant_id, v_txn.id, v_txn.provider, null, null, 'CHECKOUT',
    'FAILED', v_txn.amount, v_txn.currency, 'RECORDED', 'CHECKOUT_CREATE_FAILED', '{}'::jsonb);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. F1/F2/F4 - fn_apply_payment_event: the single, idempotent entry point for a
--    webhook or a reconciliation result. Never raises for a business condition;
--    returns APPLIED | ALREADY_APPLIED | RECORDED | EXCEPTION (+ reason).
--    Locks: transaction row, then the tenant's subscription row (same order in
--    every call, so concurrent events for one tenant serialize without deadlock).
-- ---------------------------------------------------------------------------
create or replace function public.fn_apply_payment_event(
  p_provider text,
  p_transaction_id uuid,
  p_provider_payment_id text,
  p_provider_event_id text,
  p_status text,
  p_amount numeric,
  p_currency text,
  p_source text default 'WEBHOOK'
) returns table(result_outcome text, result_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
  v_sub public.prompter_subscriptions%rowtype;
  v_kind text;
  v_status text := upper(coalesce(p_status, ''));
  v_late boolean;
  v_renewal boolean;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_dup boolean;
begin
  if p_source not in ('WEBHOOK', 'RECONCILIATION') then
    raise exception 'invalid source';
  end if;
  v_kind := p_source;

  if p_transaction_id is not null then
    select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;
  end if;
  if v_txn.id is null then
    perform public.fn_payment_flag_exception(null, null, p_provider, p_provider_payment_id, p_provider_event_id,
      v_kind, v_status, p_amount, p_currency, 'TRANSACTION_NOT_FOUND', '{}'::jsonb);
    return query select 'EXCEPTION'::text, 'TRANSACTION_NOT_FOUND'::text;
    return;
  end if;

  if v_txn.provider is distinct from p_provider then
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'PROVIDER_MISMATCH', '{}'::jsonb);
    return query select 'EXCEPTION'::text, 'PROVIDER_MISMATCH'::text;
    return;
  end if;

  -- Gateway identity: once a transaction is bound to a gateway reference, only that
  -- reference may act on it. A different reference on a PAID transaction is a SECOND
  -- real payment, which is recorded and queued, never dropped.
  if v_txn.provider_payment_id is not null and p_provider_payment_id is distinct from v_txn.provider_payment_id then
    if v_status = 'PAID' then
      perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
        p_provider_event_id, v_kind, v_status, p_amount, p_currency,
        case when v_txn.status = 'PAID' then 'DUPLICATE_PAYMENT_REFERENCE' else 'GATEWAY_REFERENCE_MISMATCH' end,
        '{}'::jsonb);
      return query select 'EXCEPTION'::text,
        (case when v_txn.status = 'PAID' then 'DUPLICATE_PAYMENT_REFERENCE' else 'GATEWAY_REFERENCE_MISMATCH' end)::text;
    else
      perform public.fn_payment_ledger_add(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
        p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'RECORDED', 'REFERENCE_MISMATCH_NOT_PAID', '{}'::jsonb);
      return query select 'RECORDED'::text, 'REFERENCE_MISMATCH_NOT_PAID'::text;
    end if;
    return;
  end if;

  -- Any non-PAID observation is history only. It never changes a transaction, so an
  -- out-of-order EXPIRED/FAILED can never undo a PAID.
  if v_status <> 'PAID' then
    perform public.fn_payment_ledger_add(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'RECORDED', 'OBSERVED_' || v_status, '{}'::jsonb);
    return query select 'RECORDED'::text, ('OBSERVED_' || v_status)::text;
    return;
  end if;

  -- PAID from here on: verify the payload before trusting it.
  if coalesce(p_provider_payment_id, '') = '' or p_amount is null or p_amount <= 0 or coalesce(p_currency, '') = '' then
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'INVALID_PAYLOAD', '{}'::jsonb);
    return query select 'EXCEPTION'::text, 'INVALID_PAYLOAD'::text;
    return;
  end if;

  if v_txn.amount <> p_amount or v_txn.currency <> p_currency then
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'AMOUNT_OR_CURRENCY_MISMATCH',
      jsonb_build_object('expected_amount', v_txn.amount, 'expected_currency', v_txn.currency));
    return query select 'EXCEPTION'::text, 'AMOUNT_OR_CURRENCY_MISMATCH'::text;
    return;
  end if;

  if v_txn.status = 'PAID' then
    perform public.fn_payment_ledger_add(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'ALREADY_APPLIED', 'REPLAY', '{}'::jsonb);
    return query select 'ALREADY_APPLIED'::text,
      (case when v_txn.activation_state = 'NEEDS_REVIEW' then 'NEEDS_REVIEW' else null end)::text;
    return;
  end if;

  -- Bind the gateway reference (first writer wins). A reference already owned by another
  -- transaction (possibly another tenant) is reported, never applied.
  begin
    update public.prompter_payment_transactions
    set provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id)
    where id = v_txn.id;
  exception when unique_violation then
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'DUPLICATE_GATEWAY_REFERENCE', '{}'::jsonb);
    return query select 'EXCEPTION'::text, 'DUPLICATE_GATEWAY_REFERENCE'::text;
    return;
  end;

  v_late := v_txn.status in ('EXPIRED', 'FAILED');

  -- An explicitly cancelled checkout that is then paid: money is real, a human decides.
  if v_txn.status = 'CANCELLED' then
    update public.prompter_payment_transactions
    set status = 'PAID', provider_event_id = p_provider_event_id, paid_at = coalesce(paid_at, now()),
        activation_state = 'NEEDS_REVIEW', failure_reason = null
    where id = v_txn.id;
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'PAID_AFTER_CANCELLED', '{}'::jsonb);
    return query select 'EXCEPTION'::text, 'PAID_AFTER_CANCELLED'::text;
    return;
  end if;

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_txn.tenant_id for update;
  if not found then
    update public.prompter_payment_transactions
    set status = 'PAID', provider_event_id = p_provider_event_id, paid_at = coalesce(paid_at, now()),
        activation_state = 'NEEDS_REVIEW', failure_reason = null
    where id = v_txn.id;
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'SUBSCRIPTION_NOT_FOUND', '{}'::jsonb);
    return query select 'EXCEPTION'::text, 'SUBSCRIPTION_NOT_FOUND'::text;
    return;
  end if;

  -- Second real payment for the same coverage: another transaction of this tenant+plan
  -- was already applied AFTER this checkout was started (concurrent / double checkout).
  -- A genuine later renewal is created after the previous one was applied, so it is not
  -- matched. Evaluated after the subscription lock so two parallel payments serialize
  -- and exactly one is applied.
  select exists (
    select 1 from public.prompter_payment_transactions o
    where o.tenant_id = v_txn.tenant_id and o.plan = v_txn.plan and o.id <> v_txn.id
      and o.activation_state = 'APPLIED'
      and o.applied_at > v_txn.created_at
  ) into v_dup;

  if v_dup then
    update public.prompter_payment_transactions
    set status = 'PAID', provider_event_id = p_provider_event_id, paid_at = coalesce(paid_at, now()),
        activation_state = 'NEEDS_REVIEW', failure_reason = null
    where id = v_txn.id;
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'DUPLICATE_PAYMENT', '{}'::jsonb);
    return query select 'EXCEPTION'::text, 'DUPLICATE_PAYMENT'::text;
    return;
  end if;

  -- Plan change while a different plan still has paid time left: proration/credit is a
  -- business decision, so nothing is applied automatically.
  if v_sub.status = 'ACTIVE' and v_sub.plan is distinct from v_txn.plan
     and v_sub.current_period_end is not null and v_sub.current_period_end > now() then
    update public.prompter_payment_transactions
    set status = 'PAID', provider_event_id = p_provider_event_id, paid_at = coalesce(paid_at, now()),
        activation_state = 'NEEDS_REVIEW', failure_reason = null
    where id = v_txn.id;
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
      p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'PLAN_CHANGE_WHILE_ACTIVE', '{}'::jsonb);
    return query select 'EXCEPTION'::text, 'PLAN_CHANGE_WHILE_ACTIVE'::text;
    return;
  end if;

  -- Apply. Same plan still ACTIVE with time left = renewal: extend from the current end so
  -- paid days are never lost. Anything else (trial, past due, canceled, expired) starts now.
  v_renewal := v_sub.status = 'ACTIVE' and v_sub.plan is not distinct from v_txn.plan
               and v_sub.current_period_end is not null and v_sub.current_period_end > now();
  v_period_start := case when v_renewal then coalesce(v_sub.current_period_start, now()) else now() end;
  v_period_end := (case when v_renewal then v_sub.current_period_end else now() end) + interval '1 month';

  update public.prompter_payment_transactions
  set status = 'PAID', provider_event_id = p_provider_event_id, paid_at = coalesce(paid_at, now()),
      activation_state = 'APPLIED', applied_at = now(), failure_reason = null
  where id = v_txn.id;

  update public.prompter_subscriptions
  set plan = v_txn.plan, status = 'ACTIVE', billing_provider = v_txn.provider,
      current_period_start = v_period_start, current_period_end = v_period_end, cancel_at_period_end = false
  where tenant_id = v_txn.tenant_id;

  insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
  values (v_txn.tenant_id, v_txn.user_id, 'payment.succeeded', 'prompter_payment_transactions', v_txn.id,
          jsonb_build_object('plan', v_txn.plan, 'amount', v_txn.amount, 'currency', v_txn.currency,
                             'provider', v_txn.provider, 'late', v_late, 'renewal', v_renewal));

  perform public.fn_payment_ledger_add(v_txn.tenant_id, v_txn.id, p_provider, p_provider_payment_id,
    p_provider_event_id, v_kind, v_status, p_amount, p_currency, 'APPLIED',
    case when v_late then 'LATE_PAYMENT_APPLIED' when v_renewal then 'RENEWAL_APPLIED' else 'APPLIED' end,
    jsonb_build_object('period_end', v_period_end));

  return query select 'APPLIED'::text, (case when v_late then 'LATE_PAYMENT_APPLIED' else null end)::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reconciliation primitives. The app asks the gateway; these only schedule and
--    record. A timeout/error is never a failure: the row stays PENDING and backs off.
-- ---------------------------------------------------------------------------
create or replace function public.fn_claim_reconciliation_batch(
  p_limit integer default 20,
  p_min_age interval default interval '2 minutes'
) returns table(out_transaction_id uuid, out_provider text, out_provider_payment_id text,
                out_amount numeric, out_currency text, out_plan text, out_attempts integer)
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id from public.prompter_payment_transactions
    where status = 'PENDING' and provider_payment_id is not null
      and created_at <= now() - p_min_age
      and (next_reconcile_at is null or next_reconcile_at <= now())
      and reconcile_attempts < 12
    order by coalesce(next_reconcile_at, created_at)
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  update public.prompter_payment_transactions t
  set reconcile_attempts = t.reconcile_attempts + 1,
      next_reconcile_at = now() + interval '5 minutes' * least(power(2, t.reconcile_attempts), 72)
  from picked
  where t.id = picked.id
  returning t.id, t.provider, t.provider_payment_id, t.amount, t.currency, t.plan, t.reconcile_attempts;
$$;

create or replace function public.fn_record_reconciliation_attempt(
  p_transaction_id uuid,
  p_result text,
  p_gateway_status text,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
begin
  if p_result not in ('NOT_PAID', 'ERROR') then
    raise exception 'invalid result';
  end if;
  select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;
  if not found then
    return;
  end if;
  if p_result = 'NOT_PAID' then
    update public.prompter_payment_transactions
    set last_reconciled_at = now(), gateway_status = left(p_gateway_status, 40)
    where id = v_txn.id;
  end if;
  perform public.fn_payment_ledger_add(v_txn.tenant_id, v_txn.id, v_txn.provider, v_txn.provider_payment_id, null,
    'RECONCILIATION', left(p_gateway_status, 40), null, null, 'RECORDED',
    case when p_result = 'ERROR' then 'RECONCILIATION_ERROR' else 'RECONCILED_NOT_PAID' end, p_detail);
  if p_result = 'ERROR' and v_txn.status = 'PENDING' and v_txn.reconcile_attempts >= 12 then
    perform public.fn_payment_flag_exception(v_txn.tenant_id, v_txn.id, v_txn.provider, v_txn.provider_payment_id,
      null, 'RECONCILIATION', left(p_gateway_status, 40), v_txn.amount, v_txn.currency, 'RECONCILIATION_EXHAUSTED', '{}'::jsonb);
  end if;
end;
$$;

-- Never expire a transaction the gateway has not been asked about. Same signature as the
-- existing sweep. A late PAID is still applied after expiry, so expiry no longer loses money;
-- this makes the common case (webhook lost) recoverable before it is even expired.
create or replace function public.fn_expire_stale_payment_transactions()
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.prompter_payment_transactions
    set status = 'EXPIRED', failure_reason = coalesce(failure_reason, 'CHECKOUT_TIMEOUT')
    where status = 'PENDING'
      and created_at < now() - interval '24 hours'
      and (
        provider_payment_id is null
        or last_reconciled_at >= created_at + interval '24 hours'
        or reconcile_attempts >= 12
        or created_at < now() - interval '7 days'
      )
    returning id
  )
  select count(*)::integer from expired;
$$;

-- Human resolution of a queued exception: explicit, ledgered. No money movement here.
create or replace function public.fn_resolve_payment_exception(
  p_exception_id uuid,
  p_resolution text,
  p_note text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ex public.prompter_payment_exceptions%rowtype;
begin
  if p_resolution not in ('RESOLVED', 'DISMISSED') or coalesce(p_note, '') = '' then
    raise exception 'resolution and note are required';
  end if;
  update public.prompter_payment_exceptions
  set status = p_resolution, resolved_at = now(), resolution_note = left(p_note, 500)
  where id = p_exception_id and status = 'OPEN'
  returning * into v_ex;
  if not found then
    return false;
  end if;
  perform public.fn_payment_ledger_add(v_ex.tenant_id, v_ex.transaction_id, 'internal', null, null, 'REVIEW',
    p_resolution, null, null, 'REVIEW_RESOLVED', v_ex.code, jsonb_build_object('note', left(p_note, 500)));
  return true;
end;
$$;

create or replace function public.fn_open_payment_exceptions()
returns table(out_code text, out_count bigint, out_oldest timestamptz)
language sql
security definer
set search_path = public
as $$
  select code, count(*), min(created_at)
  from public.prompter_payment_exceptions
  where status = 'OPEN'
  group by code
  order by min(created_at);
$$;

-- ---------------------------------------------------------------------------
-- 8. Privileges: service_role only for every entry point.
-- ---------------------------------------------------------------------------
revoke all on function public.fn_begin_checkout(uuid, uuid, text, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_record_checkout_session(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_mark_checkout_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_apply_payment_event(text, uuid, text, text, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.fn_claim_reconciliation_batch(integer, interval) from public, anon, authenticated;
revoke all on function public.fn_record_reconciliation_attempt(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fn_resolve_payment_exception(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fn_open_payment_exceptions() from public, anon, authenticated;
revoke all on function public.fn_expire_stale_payment_transactions() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_begin_checkout(uuid, uuid, text, numeric, text, text, text) to service_role;
    grant execute on function public.fn_record_checkout_session(uuid, text, text, timestamptz) to service_role;
    grant execute on function public.fn_mark_checkout_failed(uuid, text) to service_role;
    grant execute on function public.fn_apply_payment_event(text, uuid, text, text, text, numeric, text, text) to service_role;
    grant execute on function public.fn_claim_reconciliation_batch(integer, interval) to service_role;
    grant execute on function public.fn_record_reconciliation_attempt(uuid, text, text, jsonb) to service_role;
    grant execute on function public.fn_resolve_payment_exception(uuid, text, text) to service_role;
    grant execute on function public.fn_open_payment_exceptions() to service_role;
  end if;
end $$;
