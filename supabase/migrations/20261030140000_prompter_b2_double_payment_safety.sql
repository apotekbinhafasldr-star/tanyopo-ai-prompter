-- LINOE Billing B2: double-payment safety + payment idempotency. NOT APPLIED to any database by the PR that adds it.
--
-- Closes (B2 audit, 30 Oct 2026):
--   1. Two paid invoices gave ONE month (fn_apply_verified_payment overwrote current_period_end with now()+1 month).
--   2. A paid invoice for another plan silently changed the plan.
--   3. A PAID transaction could exist without any subscription change (UPDATE matched 0 rows, no error).
--   4. A paid notification for an EXPIRED / CANCELLED / FAILED invoice, or with a wrong amount, was dropped:
--      the customer's money was neither applied nor visible anywhere.
--   5. Several PENDING invoices per tenant could be open at once.
--
-- Founder rules implemented:
--   * Same plan while ACTIVE and the paid period is still running: ONE period (1 month) is ADDED to the existing
--     current_period_end. An expired period restarts from the activation time. The unused-trial bonus (carryover
--     trigger, 20261030100100) still applies exactly once, only on TRIALING -> ACTIVE.
--   * Different plan while a paid period is running: fn_begin_checkout refuses (PLAN_CHANGE_NOT_ALLOWED) and an old
--     invoice that is paid anyway is NOT applied -- it becomes REVIEW (money recorded, nothing silently changed).
--   * At most ONE open PENDING invoice per tenant (partial unique index = race-proof). An identical request within
--     30 minutes returns the same invoice (EXISTING); a different plan/provider supersedes the old one (CANCELLED).
--   * The subscription UPDATE must affect exactly one row, otherwise the whole call fails and nothing is marked PAID.
--   * A paid notification that cannot be applied safely is never ignored and never trusted blindly: the transaction
--     becomes REVIEW (new status) with the reason, the provider ids and the reported amount kept as evidence.
--     fn_resolve_review_payment() (service_role) applies a REVIEW transaction only after the caller has verified the
--     payment with the gateway (B3). Without that verification it stays REVIEW for manual reconciliation.
--
-- Compatible with #74 (client cannot write subscriptions), #75 (txns only via fn_begin_checkout) and the carryover
-- trigger. No PUBLOE / UMKMpro object is touched. Does not modify any existing row.
-- Rollback: supabase/rollback/20261030140000_prompter_b2_double_payment_safety.down.sql (refuses while REVIEW rows exist).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. New transaction status REVIEW.
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.prompter_payment_transactions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%PENDING%'
  loop
    execute format('alter table public.prompter_payment_transactions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.prompter_payment_transactions
  add constraint prompter_payment_transactions_status_check
  check (status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVIEW'));

-- ---------------------------------------------------------------------------
-- 2. At most one open PENDING invoice per tenant (fails the whole migration if duplicates already exist).
-- ---------------------------------------------------------------------------
create unique index if not exists uq_prompter_payment_txn_one_pending_per_tenant
  on public.prompter_payment_transactions (tenant_id)
  where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- 3. fn_apply_verified_payment v2 (same signature / grants as v1).
-- ---------------------------------------------------------------------------
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
  v_sub public.prompter_subscriptions%rowtype;
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_rows integer;
  v_review text;
begin
  select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;

  if not found then
    return query select false, 'TRANSACTION_NOT_FOUND'::text;
    return;
  end if;

  if v_txn.status = 'PAID' then
    -- Idempotent redelivery: never activate or extend a second time.
    return query select true, 'ALREADY_PROCESSED'::text;
    return;
  end if;

  if v_txn.status = 'REVIEW' then
    -- Already recorded for manual reconciliation; a redelivery changes nothing.
    return query select false, 'NEEDS_REVIEW'::text;
    return;
  end if;

  if v_txn.status <> 'PENDING' then
    v_review := 'LATE_PAYMENT_' || v_txn.status;
  elsif v_txn.amount <> p_verified_amount or v_txn.currency <> p_verified_currency then
    v_review := 'AMOUNT_OR_CURRENCY_MISMATCH';
  else
    -- Serialise every payment of this tenant on the subscription row (txn row first, then subscription row).
    select * into v_sub from public.prompter_subscriptions where tenant_id = v_txn.tenant_id for update;
    if not found then
      v_review := 'NO_SUBSCRIPTION';
    elsif v_sub.status = 'ACTIVE' and v_sub.current_period_end is not null
          and v_sub.current_period_end > v_now and v_sub.plan <> v_txn.plan then
      v_review := 'PLAN_CONFLICT_ACTIVE_PERIOD';
    end if;
  end if;

  if v_review is not null then
    -- The customer's money may have moved but the subscription must not change: keep the evidence and stop.
    update public.prompter_payment_transactions t
    set status = 'REVIEW',
        failure_reason = v_review,
        provider_payment_id = case
          when p_provider_payment_id is null then t.provider_payment_id
          when exists (select 1 from public.prompter_payment_transactions o
                       where o.provider = t.provider and o.provider_payment_id = p_provider_payment_id and o.id <> t.id)
            then t.provider_payment_id
          else p_provider_payment_id end,
        provider_event_id = coalesce(p_provider_event_id, t.provider_event_id),
        metadata = t.metadata || jsonb_build_object('review', jsonb_build_object(
          'reason', v_review, 'previous_status', v_txn.status,
          'reported_amount', p_verified_amount, 'reported_currency', p_verified_currency, 'at', v_now))
    where t.id = v_txn.id;

    insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
    values (v_txn.tenant_id, v_txn.user_id, 'payment.needs_review', 'prompter_payment_transactions', v_txn.id,
            jsonb_build_object('reason', v_review, 'previous_status', v_txn.status, 'plan', v_txn.plan,
                               'amount', v_txn.amount, 'reported_amount', p_verified_amount, 'provider', v_txn.provider));

    return query select false, 'NEEDS_REVIEW'::text;
    return;
  end if;

  if v_sub.status = 'ACTIVE' and v_sub.current_period_end is not null and v_sub.current_period_end > v_now then
    -- Same plan, paid period still running: ADD one period, never overwrite what the customer already paid for.
    v_start := coalesce(v_sub.current_period_start, v_now);
    v_end := v_sub.current_period_end + interval '1 month';
  else
    v_start := v_now;
    v_end := v_now + interval '1 month';
  end if;

  update public.prompter_payment_transactions
  set status = 'PAID', provider_payment_id = p_provider_payment_id, provider_event_id = p_provider_event_id, paid_at = v_now
  where id = v_txn.id;

  update public.prompter_subscriptions
  set plan = v_txn.plan,
      status = 'ACTIVE',
      billing_provider = v_txn.provider,
      current_period_start = v_start,
      current_period_end = v_end,
      cancel_at_period_end = false
  where tenant_id = v_txn.tenant_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    -- Rolls back the PAID mark above: nothing is reported as applied, the gateway retries.
    raise exception 'SUBSCRIPTION_UPDATE_AFFECTED_% (expected 1)', v_rows using errcode = 'P0001';
  end if;

  insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
  values (
    v_txn.tenant_id, v_txn.user_id, 'payment.succeeded', 'prompter_payment_transactions', v_txn.id,
    jsonb_build_object('plan', v_txn.plan, 'amount', v_txn.amount, 'currency', v_txn.currency, 'provider', v_txn.provider)
  );

  return query select true, null::text;
end;
$$;

comment on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) is
  'Billing B2 (supersedes B10 v1): the only path that may set prompter_subscriptions.status = ACTIVE. Idempotent per transaction; stacks one period onto a running same-plan paid period; never changes the plan during a paid period; marks any payment it cannot apply safely as REVIEW (never drops it); the subscription UPDATE must affect exactly one row. service_role only.';

revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. fn_resolve_review_payment: apply a REVIEW transaction ONLY after the caller verified it with the gateway.
--    p_gateway_verified_amount / currency MUST come from the gateway's own status API (B3), never from the webhook body.
-- ---------------------------------------------------------------------------
create or replace function public.fn_resolve_review_payment(
  p_transaction_id uuid,
  p_gateway_verified_amount numeric,
  p_gateway_verified_currency text
)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
begin
  select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;
  if not found then
    return query select false, 'TRANSACTION_NOT_FOUND'::text;
    return;
  end if;
  if v_txn.status <> 'REVIEW' then
    return query select false, 'NOT_IN_REVIEW'::text;
    return;
  end if;
  if v_txn.amount <> p_gateway_verified_amount or v_txn.currency <> p_gateway_verified_currency then
    return query select false, 'AMOUNT_OR_CURRENCY_MISMATCH'::text;
    return;
  end if;
  if exists (select 1 from public.prompter_payment_transactions o where o.tenant_id = v_txn.tenant_id and o.status = 'PENDING') then
    return query select false, 'OTHER_PENDING_INVOICE'::text;
    return;
  end if;

  -- Re-run the normal, fully guarded activation path (it may legitimately send it back to REVIEW).
  update public.prompter_payment_transactions set status = 'PENDING', failure_reason = null where id = v_txn.id;
  return query select * from public.fn_apply_verified_payment(
    v_txn.id, v_txn.provider_payment_id, v_txn.provider_event_id, p_gateway_verified_amount, p_gateway_verified_currency);
end;
$$;

comment on function public.fn_resolve_review_payment(uuid, numeric, text) is
  'Billing B2: applies a REVIEW transaction after the CALLER verified amount/currency with the payment gateway. Re-runs fn_apply_verified_payment (so every safety rule still holds). service_role only.';

revoke all on function public.fn_resolve_review_payment(uuid, numeric, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_resolve_review_payment(uuid, numeric, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. fn_begin_checkout v2 (same signature / grants as B1; adds the B2 rules).
--    Outcomes: CREATED | EXISTING | INVALID | NOT_MEMBER | NOT_OWNER | PLAN_NOT_PURCHASABLE | PLAN_NOT_AVAILABLE |
--              NO_SUBSCRIPTION | PLAN_CHANGE_NOT_ALLOWED | TOO_MANY_PENDING
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
  v_sub_status text;
  v_sub_plan text;
  v_sub_end timestamptz;
  v_attempts integer;
  v_open public.prompter_payment_transactions%rowtype;
  v_new uuid;
begin
  if p_tenant_id is null or p_user_id is null
     or coalesce(p_plan, '') = ''
     or p_provider is null or p_provider !~ '^[A-Za-z0-9_-]{2,40}$' then
    return query select null::uuid, null::numeric, null::text, 'INVALID'::text;
    return;
  end if;

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

  select status, plan, current_period_end into v_sub_status, v_sub_plan, v_sub_end
  from public.prompter_subscriptions where tenant_id = p_tenant_id;
  if not found then
    return query select null::uuid, null::numeric, null::text, 'NO_SUBSCRIPTION'::text;
    return;
  end if;

  -- MVP rule: no plan change while a paid period is running.
  if v_sub_status = 'ACTIVE' and v_sub_end is not null and v_sub_end > now() and v_sub_plan is distinct from p_plan then
    return query select null::uuid, null::numeric, null::text, 'PLAN_CHANGE_NOT_ALLOWED'::text;
    return;
  end if;

  -- Serialise checkout creation per tenant.
  perform pg_advisory_xact_lock(hashtext('prompter_checkout:' || p_tenant_id::text));

  select * into v_open from public.prompter_payment_transactions
  where tenant_id = p_tenant_id and status = 'PENDING' for update;
  if found and v_open.plan = p_plan and v_open.provider = p_provider and v_open.created_at > now() - interval '30 minutes' then
    return query select v_open.id, v_open.amount, v_open.currency, 'EXISTING'::text;
    return;
  end if;

  -- Spam / enumeration guard on creation churn (any status). Checked BEFORE anything is changed.
  select count(*) into v_attempts
  from public.prompter_payment_transactions
  where tenant_id = p_tenant_id and created_at > now() - interval '1 hour';
  if v_attempts >= 20 then
    return query select null::uuid, null::numeric, null::text, 'TOO_MANY_PENDING'::text;
    return;
  end if;

  if v_open.id is not null then
    -- A different / older request replaces the open invoice. If it is paid anyway it ends in REVIEW, never lost.
    update public.prompter_payment_transactions
    set status = 'CANCELLED', failure_reason = 'SUPERSEDED_BY_NEWER_CHECKOUT'
    where id = v_open.id;
  end if;

  insert into public.prompter_payment_transactions (tenant_id, user_id, provider, plan, amount, currency)
  values (p_tenant_id, p_user_id, p_provider, p_plan, v_price, v_currency)
  returning id into v_new;

  return query select v_new, v_price::numeric, v_currency, 'CREATED'::text;
end;
$$;

comment on function public.fn_begin_checkout(uuid, uuid, text, text) is
  'Billing B2 (supersedes B1 v1): creates the single open PENDING invoice of a tenant, priced from prompter_plan_prices (no amount parameter). Returns the same invoice for an identical request within 30 minutes (EXISTING), supersedes a different one, refuses a plan change during a paid period. service_role only.';

revoke all on function public.fn_begin_checkout(uuid, uuid, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_begin_checkout(uuid, uuid, text, text) to service_role;
  end if;
end $$;
