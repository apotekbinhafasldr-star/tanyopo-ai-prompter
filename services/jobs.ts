import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, JobType } from "@/types/database";
import { getJobQueue } from "@/lib/jobs/get-job-queue";
import type { EnqueueJobInput, EnqueueJobResult, Job } from "@/lib/jobs/job-queue";

/**
 * Thin orchestration layer over lib/jobs/get-job-queue.ts's provider:
 * adds the prompter_audit_logs write every enqueue and every terminal
 * transition (permanent failure, cancellation) needs, without baking
 * Postgres-specific audit logging into the provider interface itself —
 * a future non-Supabase provider (SQS, Cloud Tasks, ...) wouldn't
 * necessarily have (or want) that coupling. Retries and completions
 * aren't separately audit-logged here — prompter_jobs.attempts/result
 * already is that record, same reasoning services/ai-jobs.ts uses for
 * not audit-logging every AI job.
 *
 * No existing feature calls enqueueJob() yet — this is the architecture,
 * ready to adopt for a genuinely async/retryable need (e.g. a metrics
 * sync retry) as a deliberate follow-up, not rewired into any of the
 * already-verified synchronous, Budget-Guard/Approval-Center-gated
 * flows (campaign submission, campaign launch, AI generation) in this
 * pass.
 */
export async function enqueueJob(
  admin: SupabaseClient<Database>,
  input: EnqueueJobInput,
): Promise<EnqueueJobResult> {
  const queue = getJobQueue(admin);
  if (!queue) {
    throw new Error("Job queue tidak dikonfigurasi (SUPABASE_SECRET_KEY kosong).");
  }

  const result = await queue.enqueue(input);

  if (!result.alreadyExisted) {
    await admin.from("prompter_audit_logs").insert({
      tenant_id: input.tenantId,
      actor_user_id: input.createdBy ?? null,
      action: "job.enqueued",
      resource_type: "prompter_jobs",
      resource_id: result.jobId,
      context: { job_type: input.jobType },
    });
  }

  return result;
}

export async function claimNextJob(
  admin: SupabaseClient<Database>,
  jobTypes?: JobType[],
): Promise<Job | null> {
  const queue = getJobQueue(admin);
  if (!queue) return null;
  return queue.claimNext(jobTypes);
}

export async function completeJob(
  admin: SupabaseClient<Database>,
  jobId: string,
  result?: Record<string, unknown>,
): Promise<void> {
  const queue = getJobQueue(admin);
  if (!queue) return;
  await queue.complete(jobId, result);
}

export async function failJob(
  admin: SupabaseClient<Database>,
  job: Pick<Job, "id" | "tenant_id" | "job_type" | "attempts" | "max_attempts">,
  errorMessage: string,
): Promise<void> {
  const queue = getJobQueue(admin);
  if (!queue) return;

  await queue.fail(job.id, errorMessage);

  if (job.attempts >= job.max_attempts) {
    await admin.from("prompter_audit_logs").insert({
      tenant_id: job.tenant_id,
      actor_user_id: null,
      action: "job.failed_permanently",
      resource_type: "prompter_jobs",
      resource_id: job.id,
      context: { job_type: job.job_type, attempts: job.attempts, error: errorMessage },
    });
  }
}

export async function cancelJob(
  admin: SupabaseClient<Database>,
  tenantId: string,
  jobId: string,
): Promise<{ canceled: boolean }> {
  const queue = getJobQueue(admin);
  if (!queue) return { canceled: false };

  const result = await queue.cancel(jobId);

  if (result.canceled) {
    await admin.from("prompter_audit_logs").insert({
      tenant_id: tenantId,
      actor_user_id: null,
      action: "job.canceled",
      resource_type: "prompter_jobs",
      resource_id: jobId,
      context: {},
    });
  }

  return result;
}
