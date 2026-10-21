-- ROLLBACK for 20261021120100_prompter_ai_jobs_delete_guard.sql
-- Removes only the DELETE trigger + its function. Touches no grant/table/policy/data: it does NOT give
-- `authenticated` DELETE back (that is PR #31's REVOKE and stays in force).
-- Not in supabase/migrations on purpose (never auto-applied).

drop trigger if exists trg_prompter_ai_jobs_no_delete on public.prompter_ai_jobs;
drop function if exists public.fn_guard_ai_job_delete();
