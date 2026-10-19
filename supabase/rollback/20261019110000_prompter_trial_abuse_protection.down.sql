-- ROLLBACK for 20261019110000_prompter_trial_abuse_protection.sql
-- NOT a migration: never applied automatically. Restores the PR #31 trigger function (no hold check),
-- then drops the trial anti-abuse functions and tables. Ledger data (pseudonymous digests) is deleted.
-- Safe to run when the feature was never switched on. Subscriptions already created with a hold keep
-- their (expired) period: run fn_trial_release_hold for those attempts BEFORE rolling back if any exist.

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

drop function if exists public.fn_trial_abuse_purge(integer);
drop function if exists public.fn_trial_release_hold(uuid, text);
drop function if exists public.fn_trial_hold_active(uuid);
drop function if exists public.fn_trial_signup_finalize(uuid, uuid, boolean);
drop function if exists public.fn_trial_signup_gate(text, integer, text, text, text, text);
drop function if exists public.fn_trial_bucket_hit(text, text, integer);
drop table if exists public.prompter_trial_rate_buckets;
drop table if exists public.prompter_trial_signup_attempts;
