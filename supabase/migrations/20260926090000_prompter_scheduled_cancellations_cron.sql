-- Batch B12 P0-3 remediation: wire the existing, already-correct
-- fn_apply_scheduled_cancellations() sweep (Batch B10) into pg_cron --
-- an extension already installed on this shared project and already
-- used by UMKMpro AI's own scheduled jobs (cron.job jobid 1-4).
-- Nothing about fn_apply_scheduled_cancellations() itself changes; this
-- migration only adds the missing schedule that invokes it.
--
-- Runs hourly, directly inside Postgres via cron.schedule() -- no new
-- Edge Function, no new HTTP endpoint, no new secret/env var. pg_cron
-- jobs on this project run as the `postgres` role, which already has
-- implicit privilege to call this SECURITY DEFINER function (function
-- owner/superuser is unaffected by the REVOKE ALL FROM anon/authenticated
-- already in place from Batch B10), so no new grant is required.
--
-- cron.schedule() with an existing job name updates that job in place
-- (pg_cron >= 1.4) rather than creating a duplicate, so this migration
-- is safe to re-run.
--
-- pg_cron is already enabled on the shared production project (used by
-- UMKMpro AI's own scheduled jobs), so this is a no-op there. It is
-- included so this migration is self-contained and portable to any
-- environment (e.g. a fresh local Supabase stack) where the extension
-- exists but has not been enabled yet.
create extension if not exists pg_cron;

select cron.schedule(
  'prompter-apply-scheduled-cancellations',
  '0 * * * *',
  $$select public.fn_apply_scheduled_cancellations();$$
);
