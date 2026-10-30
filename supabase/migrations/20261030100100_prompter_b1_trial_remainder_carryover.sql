-- LINOE Billing B1 (part 2, independently applicable): unused trial time is NOT lost on the first payment.
-- NOT APPLIED to any database by the PR that adds this file.
--
-- Today fn_apply_verified_payment sets current_period_end = now() + 1 month on the TRIALING -> ACTIVE transition, which
-- silently discards the days the customer still had left of the 14-day trial. This trigger adds the unused remainder
-- (capped at 14 days, the unchanged trial length) to that first paid period. It does not change the trial length, the
-- trial entitlements, or any other transition: renewals (ACTIVE -> ACTIVE), replays and expired trials are unaffected.
-- Works for fn_apply_verified_payment (current) and any later payment function that moves the same columns.
-- Rollback: supabase/rollback/20261030100100_prompter_b1_trial_remainder_carryover.down.sql

set local lock_timeout = '3s';

create or replace function public.fn_subscription_trial_carryover()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_remaining interval;
begin
  if old.status = 'TRIALING' and new.status = 'ACTIVE'
     and old.current_period_end is not null and old.current_period_end > now()
     and new.current_period_end is not null
     and new.current_period_end is distinct from old.current_period_end then
    v_remaining := least(old.current_period_end - now(), interval '14 days');
    new.current_period_end := new.current_period_end + v_remaining;
  end if;
  return new;
end;
$$;

comment on function public.fn_subscription_trial_carryover() is
  'Billing B1: adds the unused trial time (max 14 days) to the first paid period on TRIALING -> ACTIVE when the writer also moved current_period_end. No other transition is affected.';

drop trigger if exists trg_prompter_subscriptions_trial_carryover on public.prompter_subscriptions;
create trigger trg_prompter_subscriptions_trial_carryover
  before update of status, current_period_end on public.prompter_subscriptions
  for each row execute function public.fn_subscription_trial_carryover();
