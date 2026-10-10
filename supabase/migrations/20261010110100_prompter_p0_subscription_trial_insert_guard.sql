-- P0-2 / P0-2b remediation: a client-initiated INSERT into
-- public.prompter_subscriptions must always be the canonical fresh trial,
-- timed by the SERVER clock.
--
-- Finding (verified against the production catalog, read-only): the INSERT
-- policy "Buat subscription tenant sendiri" pins status/plan/billing_provider/
-- payment_provider_customer_reference but NOT current_period_start,
-- current_period_end or created_at, and `authenticated` holds INSERT on those
-- columns. handle_new_user() does not create the subscription row; the app
-- creates it lazily, so every new tenant is briefly without a row and could
-- insert its own with:
--   * current_period_end = NULL or far in the future  -> trial never expires
--     (the expiry check only fires when current_period_end is not null);
--   * current_period_start / created_at in the future -> the trial AI window
--     starts in the future, the job count is 0 forever -> unlimited AI.
--
-- Fix: a BEFORE INSERT trigger that, for direct client inserts only
-- (current_user is anon/authenticated), overwrites the time and billing
-- fields with server-side values. The app's own insert
-- (services/billing.ts#getOrCreateSubscription: status TRIALING, now,
-- now + 14 days) is unchanged in effect.
--
-- The function is SECURITY INVOKER on purpose: inside a SECURITY DEFINER
-- function (payment webhooks, scheduled jobs) and for service_role,
-- current_user is not anon/authenticated, so those paths are NOT modified.
-- UPDATE behaviour (column-level `plan` only) is not touched.
--
-- 14 days = TRIAL_DURATION_DAYS in services/billing.ts. Change both together.
-- Rollback: supabase/rollback/20261010110100_prompter_p0_subscription_trial_insert_guard.down.sql

create or replace function public.fn_enforce_trial_subscription_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.status := 'TRIALING';
    new.plan := 'FREE';
    new.created_at := now();
    new.updated_at := now();
    new.current_period_start := now();
    new.current_period_end := now() + interval '14 days';

    -- Billing / commercial fields are never client-controlled.
    new.billing_provider := null;
    new.payment_provider_customer_reference := null;
    new.provider_subscription_id := null;
    new.success_fee_rate_bps := null;
    new.cancel_at_period_end := false;
    new.billing_country := null;
    new.invoice_currency := null;
    new.tax_metadata := '{}'::jsonb;
  end if;

  return new;
end;
$$;

comment on function public.fn_enforce_trial_subscription_insert() is
  'P0-2/P0-2b: forces a client INSERT into prompter_subscriptions to the canonical server-timed 14-day trial. Applies only when current_user is anon or authenticated; service_role, webhooks and scheduled jobs are unaffected.';

drop trigger if exists trg_prompter_subscriptions_enforce_trial_insert on public.prompter_subscriptions;
create trigger trg_prompter_subscriptions_enforce_trial_insert
  before insert on public.prompter_subscriptions
  for each row execute function public.fn_enforce_trial_subscription_insert();
