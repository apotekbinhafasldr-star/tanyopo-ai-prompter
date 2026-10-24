-- LINOE — AI Jobs quota guard (part 2 of 2): DELETE guard. Additive.
--
-- WHY: the quota is the number of prompter_ai_jobs rows in the period, so a client that can DELETE its own rows
-- resets its quota (reproduced locally on main: 30/30 used -> delete -> 30 more).
--
-- PREREQUISITE (fail-closed): PR #31 (20261019100000_prompter_p0_ai_jobs_lockdown) must already be applied and its
-- app code deployed. On main today services/ai-jobs.ts releases an unconfigured-AI job with a USER-client DELETE;
-- blocking that before #31's server-side release (admin client) is live would leave those rows counted against the
-- tenant. So this migration REFUSES to run while `authenticated` still holds DELETE on prompter_ai_jobs.
--
-- WHAT: BEFORE DELETE row trigger -> anon/authenticated can never delete a job row, whatever the grants say
-- (defence in depth against a privilege rollback / default-privilege regression). service_role (the release path),
-- the table owner and FK cascades (tenant deletion) are not restricted.
-- Rollback: supabase/rollback/20261021120100_prompter_ai_jobs_delete_guard.down.sql

do $prereq$
begin
  if has_table_privilege('authenticated', 'public.prompter_ai_jobs', 'DELETE') then
    raise exception 'prerequisite missing: apply PR #31 (ai_jobs lockdown) and deploy its server-side job release first; authenticated still has DELETE on prompter_ai_jobs';
  end if;
  if position('ROLE_NOT_ALLOWED' in pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure)) = 0 then
    raise exception 'prerequisite missing: part 1 (quota guard) is not live in fn_create_ai_job_if_entitled -- was it overwritten by an older migration? re-apply part 1';
  end if;
end
$prereq$;

create or replace function public.fn_guard_ai_job_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'prompter_ai_jobs: rows cannot be deleted by the client (releases go through the server)'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.fn_guard_ai_job_delete() from public, anon, authenticated;

drop trigger if exists trg_prompter_ai_jobs_no_delete on public.prompter_ai_jobs;
create trigger trg_prompter_ai_jobs_no_delete
  before delete on public.prompter_ai_jobs
  for each row execute function public.fn_guard_ai_job_delete();
