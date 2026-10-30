-- Rollback for 20261030100100_prompter_b1_trial_remainder_carryover.sql
-- Removes the trial-remainder carryover trigger. Effect: the first paid period no longer adds the unused trial days
-- (the behaviour before B1). Subscriptions already activated keep the period they were given; no row is modified.
set local lock_timeout = '3s';

drop trigger if exists trg_prompter_subscriptions_trial_carryover on public.prompter_subscriptions;
drop function if exists public.fn_subscription_trial_carryover();
