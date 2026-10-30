-- Rollback for 20261030100000_prompter_b1_server_only_checkout.sql
-- WARNING: this RE-OPENS the P0 hole (an Owner could insert a PENDING payment transaction with any amount / plan over REST).
-- FAIL-CLOSED: it only runs when explicitly confirmed. Replace the placeholder below with exactly
--   I_UNDERSTAND_THIS_REOPENS_CLIENT_TXN_INSERT
-- Restores ONLY what the legacy app code (services/checkout.ts before B1) needs: the INSERT policy + INSERT privilege.
-- UPDATE / DELETE / TRUNCATE are deliberately NOT re-granted. prompter_plan_prices is kept (data only, no client access).
-- Prefer a forward fix. If you must roll back, deploy the app version that still inserts through the tenant client first.
set local lock_timeout = '3s';

do $$
declare
  v_confirm text := 'REPLACE_WITH_CONFIRMATION';
begin
  if v_confirm is distinct from 'I_UNDERSTAND_THIS_REOPENS_CLIENT_TXN_INSERT' then
    raise exception 'rollback refused: confirmation missing (this re-opens client-side transaction creation)';
  end if;
end
$$;

drop trigger if exists trg_prompter_payment_txn_insert_guard on public.prompter_payment_transactions;
drop function if exists public.fn_payment_txn_insert_guard();
drop function if exists public.fn_begin_checkout(uuid, uuid, text, text);

grant insert on public.prompter_payment_transactions to authenticated;
drop policy if exists "Buat payment transaction tenant sendiri" on public.prompter_payment_transactions;
create policy "Buat payment transaction tenant sendiri"
  on public.prompter_payment_transactions for insert
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() = 'owner'
    and status = 'PENDING'
    and provider_payment_id is null
    and provider_event_id is null
    and paid_at is null
  );
