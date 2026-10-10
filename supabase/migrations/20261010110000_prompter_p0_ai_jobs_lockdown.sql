-- P0-1 remediation: a tenant must not be able to reset its own AI quota.
--
-- Finding (verified against the production catalog, read-only): the trial and
-- plan AI quota is counted from rows of public.prompter_ai_jobs
-- (fn_create_ai_job_if_entitled: count(*) ... created_at >= period start).
-- The table's RLS policy "Owner/marketing buat & ubah ai job" is FOR ALL, and
-- `authenticated` holds table-level INSERT/UPDATE/DELETE, so an owner or
-- marketing user could, with their own JWT through the REST API, DELETE their
-- job rows or PATCH created_at and bring the count back to zero.
--
-- Fix: privileges, not policy. The RLS policy and tenant isolation are left
-- untouched.
--   * INSERT: only fn_create_ai_job_if_entitled() creates jobs. It is
--     SECURITY DEFINER owned by postgres, so it is unaffected by this revoke.
--   * DELETE / TRUNCATE: no client path. (The only legitimate delete, the
--     "AI not configured" branch in services/ai-jobs.ts, no longer exists:
--     configuration is now checked BEFORE a job is created, and the
--     unreachable fallback uses the server-side admin client.)
--   * UPDATE: restricted to the bookkeeping columns services/ai-jobs.ts
--     writes after the model call. created_at, tenant_id, job_type,
--     actor_user_id, input_reference and estimated_cost become immutable for
--     clients, so a job row can no longer be moved out of the counting window
--     or re-assigned.
--
-- service_role is not touched (it keeps its grants). No data is changed.
-- Rollback: supabase/rollback/20261010110000_prompter_p0_ai_jobs_lockdown.down.sql

revoke insert, delete, truncate on public.prompter_ai_jobs from authenticated, anon;

-- Revoking the table-level UPDATE also clears any column-level UPDATE grants.
revoke update on public.prompter_ai_jobs from authenticated, anon;

grant update (
  status,
  provider,
  model,
  tokens_input,
  tokens_output,
  fallback_provider,
  output_reference,
  error,
  error_category,
  completed_at
) on public.prompter_ai_jobs to authenticated;
