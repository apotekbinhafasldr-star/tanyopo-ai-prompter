-- Rollback for 20261020160000_prompter_billing_financial_safety.sql.
-- PREFER A FORWARD FIX: the ledger is financial history. This script refuses to run
-- while the ledger or exception queue holds rows, or any transaction was activated by
-- the v2 path, unless the operator explicitly sets
--   set app.allow_financial_history_drop = 'yes';
-- in the same session AFTER exporting prompter_payment_ledger / prompter_payment_exceptions.
do $$
declare
  v_rows bigint := 0;
begin
  if to_regclass('public.prompter_payment_ledger') is not null then
    execute 'select count(*) from public.prompter_payment_ledger' into v_rows;
  end if;
  if to_regclass('public.prompter_payment_exceptions') is not null then
    v_rows := v_rows + (select count(*) from public.prompter_payment_exceptions);
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'prompter_payment_transactions' and column_name = 'activation_state') then
    v_rows := v_rows + (select count(*) from public.prompter_payment_transactions where activation_state <> 'NONE');
  end if;
  if v_rows > 0 and coalesce(current_setting('app.allow_financial_history_drop', true), '') <> 'yes' then
    raise exception 'rollback refused: % financial history rows exist. Export them and set app.allow_financial_history_drop=yes, or forward-fix instead.', v_rows;
  end if;
end $$;

drop function if exists public.fn_open_payment_exceptions();
drop function if exists public.fn_resolve_payment_exception(uuid, text, text);
drop function if exists public.fn_record_reconciliation_attempt(uuid, text, text, jsonb);
drop function if exists public.fn_claim_reconciliation_batch(integer, interval);
drop function if exists public.fn_apply_payment_event(text, uuid, text, text, text, numeric, text, text);
drop function if exists public.fn_mark_checkout_failed(uuid, text);
drop function if exists public.fn_record_checkout_session(uuid, text, text, timestamptz);
drop function if exists public.fn_begin_checkout(uuid, uuid, text, numeric, text, text, text);
drop function if exists public.fn_payment_flag_exception(uuid, uuid, text, text, text, text, text, numeric, text, text, jsonb);
drop function if exists public.fn_payment_ledger_add(uuid, uuid, text, text, text, text, text, numeric, text, text, text, jsonb);

drop table if exists public.prompter_payment_exceptions;
drop table if exists public.prompter_payment_ledger;
drop function if exists public.fn_payment_ledger_immutable();

drop index if exists public.idx_prompter_payment_txn_reconcile;
drop index if exists public.uq_prompter_payment_txn_tenant_intent;

alter table public.prompter_payment_transactions
  drop constraint if exists prompter_payment_transactions_activation_state_check,
  drop constraint if exists prompter_payment_transactions_intent_key_check,
  drop column if exists gateway_status,
  drop column if exists last_reconciled_at,
  drop column if exists next_reconcile_at,
  drop column if exists reconcile_attempts,
  drop column if exists applied_at,
  drop column if exists activation_state,
  drop column if exists checkout_expires_at,
  drop column if exists checkout_url,
  drop column if exists intent_key;

-- Restore the previous sweep body (20260926113000_prompter_payment_lifecycle_remediation.sql).
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
    returning id
  )
  select count(*)::integer from expired;
$$;
revoke all on function public.fn_expire_stale_payment_transactions() from public, anon, authenticated;
