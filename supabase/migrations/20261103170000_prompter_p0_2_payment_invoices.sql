-- LINOE P0-2: invoice / payment receipt per verified payment. NOT APPLIED to any database by the PR that adds it.
--
-- Problem (audit 3 Nov 2026): fn_apply_verified_payment (B2 v2) activates the plan but never writes prompter_invoices,
-- and nothing else does (services/billing.ts recordInvoiceFromProvider has no caller). A paying customer's invoice list
-- stays empty and there is no proof of payment.
--
-- Change (additive, no table is re-created, no old migration is edited, no existing row is modified):
--   1. prompter_invoices.transaction_id (nullable FK, NO ACTION so tenant deletion still cascades) + a partial UNIQUE index
--      = one invoice per payment transaction (the idempotency key, race-proof).
--   2. fn_apply_verified_payment v3 = B2 v2 plus ONE invoice INSERT placed after the subscription UPDATE and before the
--      audit row, inside the same function call = the same transaction. Same signature, same return shape, same grants.
--        * The invoice is PAID only on the path that already requires a gateway-verified PAID + matching amount/currency.
--        * REVIEW / ALREADY_PROCESSED / TRANSACTION_NOT_FOUND paths write no invoice.
--        * period_end is read from UPDATE ... RETURNING, i.e. AFTER the trial-carryover trigger (20261030100100).
--        * ON CONFLICT (transaction_id) DO NOTHING; any other failure (e.g. a clash on (provider, external_invoice_id))
--          aborts the whole call: the PAID mark and the activation roll back and the gateway retries.
--   3. Defence in depth: INSERT / UPDATE / DELETE / TRUNCATE on prompter_invoices revoked from anon + authenticated.
--      SELECT and the tenant RLS policy are unchanged. service_role still writes.
-- No numbering scheme (Founder decision D1: deferred); the invoice is identified by its internal id. No tax claim is made.
-- A pre-flight guard aborts if fn_apply_verified_payment is not the known B2 v2 (or this v3) body, so a drifted production
-- function is never silently overwritten. No PUBLOE / UMKMpro object is touched. No backfill is performed.
-- Rollback: supabase/rollback/20261103170000_prompter_p0_2_payment_invoices.down.sql (refuses while linked invoices exist).

set local lock_timeout = '3s';

do $$
declare v_src text;
begin
  if to_regclass('public.prompter_invoices') is null or to_regclass('public.prompter_payment_transactions') is null then
    raise exception 'DIBATALKAN: prompter_invoices / prompter_payment_transactions tidak ada.';
  end if;
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_apply_verified_payment'
    and pg_get_function_identity_arguments(p.oid) = 'p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text';
  if v_src is null then
    raise exception 'DIBATALKAN: fn_apply_verified_payment tidak ada (B2 belum diterapkan).';
  end if;
  if md5(regexp_replace(v_src, '\s+', '', 'g')) not in ('dbd3a48a43c2959bbc02ad0575b23803', 'fed9cc40c66292168cf7d26b53adaec0') then
    raise exception 'DIBATALKAN: badan fn_apply_verified_payment bukan B2 v2 yang dikenal. Tidak ditimpa.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'fn_resolve_review_payment') then
    raise exception 'DIBATALKAN: fn_resolve_review_payment tidak ada (B2 belum diterapkan).';
  end if;
end $$;

-- 1. Link + idempotency key.
alter table public.prompter_invoices
  add column if not exists transaction_id uuid references public.prompter_payment_transactions(id);

create unique index if not exists uq_prompter_invoices_transaction
  on public.prompter_invoices (transaction_id)
  where transaction_id is not null;

comment on column public.prompter_invoices.transaction_id is
  'P0-2: the verified payment transaction this invoice documents. Unique when set = one invoice per transaction.';

-- 2. Defence in depth: clients can read their own invoices, nothing more.
revoke insert, update, delete, truncate on public.prompter_invoices from anon, authenticated;

-- 3. fn_apply_verified_payment v3.
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
  v_final_end timestamptz;
  v_paid_from timestamptz;
  v_invoice_id uuid;
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
    v_paid_from := v_sub.current_period_end;
  else
    v_start := v_now;
    v_end := v_now + interval '1 month';
    v_paid_from := v_now;
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
  where tenant_id = v_txn.tenant_id
  returning current_period_end into v_final_end;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    -- Rolls back the PAID mark above: nothing is reported as applied, the gateway retries.
    raise exception 'SUBSCRIPTION_UPDATE_AFFECTED_% (expected 1)', v_rows using errcode = 'P0001';
  end if;

  -- P0-2: exactly one PAID invoice per transaction, written in the SAME transaction as the activation. v_final_end is
  -- read back from the UPDATE ... RETURNING, i.e. AFTER the trial-carryover trigger ran. tenant_id / amount / currency
  -- come from the transaction row (amount and currency were just verified equal to the gateway's answer).
  insert into public.prompter_invoices (
    tenant_id, transaction_id, provider, external_invoice_id, status, amount, currency, description,
    period_start, period_end, issued_at, paid_at)
  values (
    v_txn.tenant_id, v_txn.id, v_txn.provider, coalesce(p_provider_payment_id, v_txn.id::text), 'PAID',
    v_txn.amount, v_txn.currency, 'Langganan LINOE paket ' || v_txn.plan || ' (1 bulan)',
    v_paid_from, v_final_end, v_now, v_now)
  on conflict (transaction_id) where transaction_id is not null do nothing
  returning id into v_invoice_id;
  if v_invoice_id is null then
    select i.id into v_invoice_id from public.prompter_invoices i where i.transaction_id = v_txn.id;
  end if;

  insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
  values (
    v_txn.tenant_id, v_txn.user_id, 'payment.succeeded', 'prompter_payment_transactions', v_txn.id,
    jsonb_build_object('plan', v_txn.plan, 'amount', v_txn.amount, 'currency', v_txn.currency, 'provider', v_txn.provider,
                       'invoice_id', v_invoice_id)
  );

  return query select true, null::text;
end;
$$;

comment on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) is
  'Billing B2 + P0-2: the only path that may set prompter_subscriptions.status = ACTIVE. Idempotent per transaction; stacks one period onto a running same-plan paid period; anything it cannot apply safely becomes a REVIEW transaction. P0-2: in the same transaction it writes exactly one PAID prompter_invoices row (unique per transaction_id) whose period_end is the subscription end AFTER the trial-carryover trigger.';

revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) to service_role;
  end if;
end $$;
