-- Rollback for 20261030140000_prompter_b2_double_payment_safety.sql
-- Restores the B10 v1 fn_apply_verified_payment and the B1 v1 fn_begin_checkout, drops fn_resolve_review_payment and the
-- one-open-invoice index, and removes the REVIEW status. v1 has the double-payment weaknesses described in the B2 audit.
-- Fail-closed: refuses while ANY transaction is in REVIEW (that is customer-payment evidence; resolve or export it first),
-- so no row can lose its status. No row is modified by this script.
set local lock_timeout = '3s';

do $$ begin
  if exists (select 1 from public.prompter_payment_transactions where status = 'REVIEW') then
    raise exception 'rollback refused: transactions in REVIEW exist (customer payments awaiting reconciliation). Resolve them first.';
  end if;
end $$;

drop function if exists public.fn_resolve_review_payment(uuid, numeric, text);
drop index if exists public.uq_prompter_payment_txn_one_pending_per_tenant;

create or replace function public.fn_apply_verified_payment(
  p_transaction_id uuid,
  p_provider_payment_id text,
  p_provider_event_id text,
  p_verified_amount numeric,
  p_verified_currency text
)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;

  if not found then
    return query select false, 'TRANSACTION_NOT_FOUND'::text;
    return;
  end if;

  if v_txn.status = 'PAID' then
    -- Idempotent redelivery of a webhook already processed -- never
    -- double-activate or extend the period a second time.
    return query select true, 'ALREADY_PROCESSED'::text;
    return;
  end if;

  if v_txn.status <> 'PENDING' then
    -- FAILED/EXPIRED/CANCELLED transaction receiving a late "paid" event
    -- is treated as a mismatch, not silently accepted.
    return query select false, ('TRANSACTION_' || v_txn.status)::text;
    return;
  end if;

  if v_txn.amount <> p_verified_amount or v_txn.currency <> p_verified_currency then
    update public.prompter_payment_transactions
    set status = 'FAILED', failure_reason = 'AMOUNT_OR_CURRENCY_MISMATCH', provider_payment_id = p_provider_payment_id, provider_event_id = p_provider_event_id
    where id = p_transaction_id;
    return query select false, 'AMOUNT_OR_CURRENCY_MISMATCH'::text;
    return;
  end if;

  v_period_start := now();
  v_period_end := now() + interval '1 month';

  update public.prompter_payment_transactions
  set status = 'PAID', provider_payment_id = p_provider_payment_id, provider_event_id = p_provider_event_id, paid_at = now()
  where id = p_transaction_id;

  update public.prompter_subscriptions
  set
    plan = v_txn.plan,
    status = 'ACTIVE',
    billing_provider = v_txn.provider,
    current_period_start = v_period_start,
    current_period_end = v_period_end,
    cancel_at_period_end = false
  where tenant_id = v_txn.tenant_id;

  insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
  values (
    v_txn.tenant_id,
    v_txn.user_id,
    'payment.succeeded',
    'prompter_payment_transactions',
    v_txn.id,
    jsonb_build_object('plan', v_txn.plan, 'amount', v_txn.amount, 'currency', v_txn.currency, 'provider', v_txn.provider)
  );

  return query select true, null::text;
end;
$$;

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

revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.fn_begin_checkout(uuid, uuid, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) to service_role;
    grant execute on function public.fn_begin_checkout(uuid, uuid, text, text) to service_role;
  end if;
end $$;

alter table public.prompter_payment_transactions drop constraint if exists prompter_payment_transactions_status_check;
alter table public.prompter_payment_transactions
  add constraint prompter_payment_transactions_status_check
  check (status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED'));
