-- Rollback for 20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql
-- WARNING: this RE-OPENS the P0 hole (an Owner could change `plan` for free through REST).
-- FAIL-CLOSED: it only runs when explicitly confirmed. Replace the placeholder below with exactly
--   I_UNDERSTAND_THIS_REOPENS_PLAN_TAMPERING
-- DELETE/TRUNCATE are deliberately NOT re-granted (re-granting would let any user wipe every tenant's subscription).
-- Prefer a forward fix. If you must roll back, deploy the app version that still calls .update({ plan }) first.
set local lock_timeout = '3s';

do $$
declare
  v_confirm text := 'REPLACE_WITH_CONFIRMATION';
begin
  if v_confirm is distinct from 'I_UNDERSTAND_THIS_REOPENS_PLAN_TAMPERING' then
    raise exception 'rollback refused: confirmation missing (this re-opens the plan tampering hole)';
  end if;
end
$$;

drop trigger if exists trg_prompter_subscriptions_block_client_update on public.prompter_subscriptions;
drop function if exists public.fn_block_client_subscription_update();
drop function if exists public.fn_set_trial_plan_preference(text);

drop policy if exists "Owner kelola subscription" on public.prompter_subscriptions;
create policy "Owner kelola subscription"
  on public.prompter_subscriptions for update
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');
grant update (plan) on public.prompter_subscriptions to authenticated;
