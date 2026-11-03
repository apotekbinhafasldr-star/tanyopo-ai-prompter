-- Rollback for 20261103170000_prompter_p0_2_payment_invoices.sql
-- Restores the B2 v2 fn_apply_verified_payment and removes the transaction link + its unique index.
-- Fail-closed: refuses while ANY invoice is linked to a transaction (that is customer proof of payment; export or keep it).
-- No invoice row is modified or deleted. The REVOKE of client write privileges is deliberately NOT undone (safer state).
set local lock_timeout = '3s';

do $$ begin
  if to_regclass('public.prompter_invoices') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'prompter_invoices' and column_name = 'transaction_id')
     and exists (select 1 from public.prompter_invoices where transaction_id is not null) then
    raise exception 'rollback refused: invoices linked to payment transactions exist (customer proof of payment). Keep or export them first.';
  end if;
end $$;

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

revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) to service_role;
  end if;
end $$;

drop index if exists public.uq_prompter_invoices_transaction;
alter table public.prompter_invoices drop column if exists transaction_id;
