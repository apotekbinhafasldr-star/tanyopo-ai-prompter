-- ROLLBACK for 20261010110000_prompter_p0_ai_jobs_lockdown.sql
-- NOT a migration: lives outside supabase/migrations and is never applied automatically.
-- Restores the grants observed on production before the lockdown
-- (read-only catalog check, 2026-10-10): anon and authenticated each held
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.
-- WARNING: rolling back REOPENS P0-1 (tenant can reset its AI quota).

revoke update on public.prompter_ai_jobs from authenticated, anon;
grant delete, insert, references, select, trigger, truncate, update
  on public.prompter_ai_jobs to anon, authenticated;
