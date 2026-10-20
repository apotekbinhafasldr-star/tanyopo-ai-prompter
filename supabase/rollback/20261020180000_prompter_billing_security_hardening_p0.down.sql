-- Rollback for 20261020180000. Restores the previous (vulnerable) grants/policies exactly as
-- they were on main. Prefer fixing forward; this exists for emergency compatibility only.
drop trigger if exists trg_prompter_subscriptions_trial_carryover on public.prompter_subscriptions;
drop function if exists public.fn_subscription_trial_carryover();
drop function if exists public.fn_set_trial_plan_preference(text);

grant update (plan) on public.prompter_subscriptions to authenticated;
drop policy if exists "Owner kelola subscription" on public.prompter_subscriptions;
create policy "Owner kelola subscription"
  on public.prompter_subscriptions for update
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner');

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

-- Supabase default privileges (what these tables had before the hardening).
grant insert, update, delete, truncate on public.prompter_payment_transactions to authenticated, anon;
grant insert, update, delete, truncate on public.prompter_invoices to authenticated, anon;
grant insert, update, delete, truncate on public.prompter_webhook_events to authenticated, anon;
grant update, delete, truncate on public.prompter_audit_logs to authenticated, anon;
grant insert on public.prompter_audit_logs to anon;
