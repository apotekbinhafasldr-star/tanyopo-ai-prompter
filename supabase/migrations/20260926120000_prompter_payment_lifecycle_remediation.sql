-- Payment Remediation (post-B11 payment-readiness audit) — closes two
-- lifecycle gaps found in the paid-subscription/payment-transaction
-- state machine. Additive only: no existing table, column, function
-- signature, RLS policy, or grant is altered. Does NOT touch
-- fn_apply_verified_payment(), fn_schedule_cancellation(),
-- fn_apply_scheduled_cancellations() (P0-3, FROZEN), the B9 entitlement
-- functions, or the Trial Expiry fix (FROZEN) — this migration only adds
-- two new sweep functions and two new, separately-named pg_cron jobs.
--
-- Gap 1 — Subscription period expiry: fn_apply_verified_payment() sets
-- status='ACTIVE' with a one-month current_period_end, but nothing ever
-- moved a subscription off ACTIVE once that date passed without a new
-- payment (the B10 migration's own comment anticipated this as "a future
-- renewal-failure path" that was never built). Fix: fn_apply_expired_subscriptions()
-- mirrors fn_apply_scheduled_cancellations()'s exact shape and moves any
-- ACTIVE subscription whose current_period_end has passed to the
-- already-existing PAST_DUE status -- a status the B9 entitlement
-- functions (fn_create_ai_job_if_entitled, fn_activate_product,
-- fn_reserve_active_campaign_slot) already deny paid entitlement for,
-- unchanged. No new status is introduced. A subscription that renews
-- (fn_apply_verified_payment runs again) is picked back up to ACTIVE
-- with a fresh period regardless of what this function most recently set
-- it to, so a renewal racing this sweep is always resolved correctly.
--
-- Gap 2 — Stale PENDING payment transactions: a checkout that's started
-- but never completed (or never resolved by a webhook) stays PENDING
-- forever today -- confirmed live in production (a PENDING transaction
-- from days earlier). Fix: fn_expire_stale_payment_transactions() moves
-- a PENDING transaction older than 24 hours (this app has no stored
-- provider-side expiry timestamp yet, so created_at + a fixed window is
-- the most honest authoritative timestamp available without inventing a
-- new column) to the already-existing EXPIRED status. PAID/FAILED/
-- CANCELLED/already-EXPIRED rows are never touched -- the WHERE clause
-- only ever matches status = 'PENDING'.

create or replace function public.fn_apply_expired_subscriptions()
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.prompter_subscriptions
    set status = 'PAST_DUE'
    where status = 'ACTIVE'
      and current_period_end is not null
      and current_period_end < now()
    returning tenant_id
  )
  select count(*)::integer from expired;
$$;

comment on function public.fn_apply_expired_subscriptions() is
  'Payment Remediation -- idempotent sweep: moves every ACTIVE subscription whose current_period_end has already passed to PAST_DUE (an existing status B9''s entitlement functions already deny paid access for). Intended to be called periodically by pg_cron (service_role only); safe to call repeatedly or not at all in the interim.';

revoke all on function public.fn_apply_expired_subscriptions() from public;
revoke all on function public.fn_apply_expired_subscriptions() from anon;
revoke all on function public.fn_apply_expired_subscriptions() from authenticated;

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

comment on function public.fn_expire_stale_payment_transactions() is
  'Payment Remediation -- idempotent sweep: moves a PENDING payment transaction older than 24 hours to EXPIRED. Never touches PAID/FAILED/CANCELLED/already-EXPIRED rows. Intended to be called periodically by pg_cron (service_role only).';

revoke all on function public.fn_expire_stale_payment_transactions() from public;
revoke all on function public.fn_expire_stale_payment_transactions() from anon;
revoke all on function public.fn_expire_stale_payment_transactions() from authenticated;

-- pg_cron is already enabled on this shared production project (see
-- 20260926090000_prompter_scheduled_cancellations_cron.sql) -- this
-- statement is a no-op there and only matters for a fresh environment
-- (e.g. a local Supabase stack) where it hasn't been enabled yet.
create extension if not exists pg_cron;

-- Two separate, distinctly-named jobs -- neither reuses nor modifies the
-- P0-3 job ('prompter-apply-scheduled-cancellations'), which stays
-- exactly as it is (FROZEN).
select cron.schedule(
  'prompter-apply-expired-subscriptions',
  '0 * * * *',
  $$select public.fn_apply_expired_subscriptions();$$
);

select cron.schedule(
  'prompter-expire-stale-payment-transactions',
  '0 * * * *',
  $$select public.fn_expire_stale_payment_transactions();$$
);
