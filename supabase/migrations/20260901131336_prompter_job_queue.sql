-- Tanyopo AI Promoter — provider-neutral background job queue.
--
-- Additive only. This is a DB-backed "local/development" queue
-- implementation behind a swappable runtime interface
-- (lib/jobs/job-queue.ts) — nothing in the app is rewired to depend on
-- it yet (see services/jobs.ts docblock), so this migration changes no
-- existing behavior. A real external queue provider (SQS, Cloud Tasks,
-- a Redis-backed queue, ...) could replace the DB-backed claim/complete/
-- fail logic later without any caller changing, same pattern as every
-- other provider-neutral abstraction in this app (connectors, AI
-- router, payment provider).
create table if not exists public.prompter_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_type text not null check (job_type in (
    'AI_GENERATION', 'CONTENT_GENERATION', 'CAMPAIGN_EXECUTION', 'ANALYTICS_SYNC',
    'WEBHOOK_PROCESSING', 'SEO_JOB', 'OPTIMIZATION_JOB', 'EXTERNAL_API_RETRY'
  )),
  status text not null default 'PENDING' check (
    status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED')
  ),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  -- Nullable, and multiple NULLs are mutually non-conflicting (Postgres
  -- treats NULLs as distinct in a unique constraint) — only a caller
  -- that actually wants idempotency sets this, same pattern used
  -- throughout this schema (prompter_products, prompter_webhook_events).
  idempotency_key text,
  created_by uuid references auth.users(id),
  -- Next eligible execution time. Set to now() on enqueue; pushed
  -- forward by lib/jobs/backoff.ts's exponential backoff on each retry.
  run_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_jobs_max_attempts_positive check (max_attempts >= 1),
  constraint prompter_jobs_idempotency_unique unique (tenant_id, job_type, idempotency_key)
);

comment on table public.prompter_jobs is
  'Tanyopo AI Promoter: provider-neutral background job queue (DB-backed default implementation). No existing feature is wired to enqueue into this yet -- see services/jobs.ts.';

create index if not exists idx_prompter_jobs_tenant on public.prompter_jobs (tenant_id, created_at desc);
create index if not exists idx_prompter_jobs_claim on public.prompter_jobs (status, run_at) where status = 'PENDING';

drop trigger if exists trg_prompter_jobs_updated_at on public.prompter_jobs;
create trigger trg_prompter_jobs_updated_at
  before update on public.prompter_jobs
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_jobs enable row level security;

drop policy if exists "Lihat job tenant sendiri" on public.prompter_jobs;
create policy "Lihat job tenant sendiri"
  on public.prompter_jobs for select
  using (tenant_id = public.fn_current_tenant_id());

-- No INSERT/UPDATE/DELETE policy for anon/authenticated -- enqueue/claim/
-- complete/fail/cancel all go through the service-role client
-- (services/jobs.ts), so state transitions stay controlled and atomic
-- (see prompter_claim_next_job below) rather than something any tenant
-- session could corrupt.

-- ============================================================================
-- prompter_claim_next_job(p_job_types)
-- Atomically claims one PENDING, due (run_at <= now()) job — `for update
-- skip locked` so concurrent claimers never race for the same row or
-- block on each other. SECURITY DEFINER is required for this to see
-- across tenants (a queue worker is not scoped to one tenant the way a
-- normal request is), so unlike the RLS-scoped SELECT policy above,
-- access to this function itself is locked down explicitly below —
-- revoked from anon/authenticated, granted only to service_role. This
-- is the same SECURITY DEFINER pattern already used elsewhere in this
-- shared project (fn_current_tenant_id(), fn_current_role()), but with
-- explicit grants added rather than left at the Postgres default (grant
-- to PUBLIC), which is what the get_advisors security scan flags on
-- several pre-existing UMKMpro functions unrelated to this app.
--
-- Verified live (2026-09-01): enqueue -> claim (status PENDING->RUNNING,
-- attempts 0->1) -> second claim on the same job_type returns null (no
-- double-claim) -> complete -> idempotent re-insert on the same
-- (tenant_id, job_type, idempotency_key) raises 23505 as expected. Test
-- row deleted after verification, no data left behind.
-- ============================================================================
create or replace function public.prompter_claim_next_job(p_job_types text[] default null)
returns public.prompter_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.prompter_jobs;
begin
  select * into v_job
  from public.prompter_jobs
  where status = 'PENDING'
    and run_at <= now()
    and (p_job_types is null or job_type = any(p_job_types))
  order by run_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return null;
  end if;

  update public.prompter_jobs
  set status = 'RUNNING', started_at = now(), attempts = attempts + 1, updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.prompter_claim_next_job(text[]) from public;
revoke all on function public.prompter_claim_next_job(text[]) from anon;
revoke all on function public.prompter_claim_next_job(text[]) from authenticated;
grant execute on function public.prompter_claim_next_job(text[]) to service_role;
