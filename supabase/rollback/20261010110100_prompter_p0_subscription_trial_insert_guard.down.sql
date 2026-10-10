-- ROLLBACK for 20261010110100_prompter_p0_subscription_trial_insert_guard.sql
-- NOT a migration: lives outside supabase/migrations and is never applied automatically.
-- Production had no trigger of this name before; rollback simply removes it.
-- Existing rows are not modified by the migration, so there is no data to restore.
-- WARNING: rolling back REOPENS P0-2/P0-2b (client-chosen trial period).

drop trigger if exists trg_prompter_subscriptions_enforce_trial_insert on public.prompter_subscriptions;
drop function if exists public.fn_enforce_trial_subscription_insert();
