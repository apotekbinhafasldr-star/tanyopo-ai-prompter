/**
 * Provider-neutral background job queue contract — same discipline as
 * lib/connectors/types.ts's PlatformConnector and
 * lib/billing/payment-provider.ts's PaymentProvider: business logic
 * (a future call site that wants to enqueue an AI generation, a content
 * job, a campaign execution retry, an analytics sync, webhook
 * processing, an SEO job, an optimization job, or a generic retryable
 * external API call — see types/database.ts#JobType for the full list)
 * depends only on this interface, never on how jobs are actually
 * claimed/run.
 *
 * Today's only implementation (lib/jobs/providers/supabase-job-queue.ts)
 * is a DB-backed "local/development" queue: prompter_jobs +
 * prompter_claim_next_job() (an atomic `for update skip locked` claim,
 * SECURITY DEFINER, locked to service_role only). A real external
 * provider (SQS, Cloud Tasks, a Redis-backed queue, ...) could implement
 * this same interface later without any caller changing. No existing
 * feature is rewired to use this yet — see services/jobs.ts.
 */

import type { Database, JobType } from "@/types/database";

export type Job = Database["public"]["Tables"]["prompter_jobs"]["Row"];

/** Identifies one job row: its id AND the tenant that owns it (both from a trusted source). */
export interface JobRef {
  id: string;
  tenantId: string;
}

export interface EnqueueJobInput {
  tenantId: string;
  jobType: JobType;
  payload?: Record<string, unknown>;
  /** Same-shaped enqueue call with the same key is a no-op, not a duplicate job. */
  idempotencyKey?: string;
  maxAttempts?: number;
  createdBy?: string | null;
}

export interface EnqueueJobResult {
  jobId: string;
  /** True when idempotencyKey matched an existing job rather than creating a new one. */
  alreadyExisted: boolean;
}

export interface JobQueueProvider {
  readonly name: string;

  enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult>;

  /** Atomically claims and marks RUNNING the next due job, or null if none is due. */
  claimNext(jobTypes?: JobType[]): Promise<Job | null>;

  /**
   * Marks a RUNNING job SUCCEEDED. The job is addressed by BOTH its id and its tenant (taken from
   * the claimed job, never from request input) and must still be RUNNING: a wrong tenant, an unknown
   * id or a job in any other state is left untouched and reported as `applied: false`.
   */
  complete(job: JobRef, result?: Record<string, unknown>): Promise<{ applied: boolean }>;

  /**
   * Records a failure of a RUNNING job (same tenant + RUNNING guard as complete()). Schedules a
   * backoff-delayed retry (status back to PENDING, run_at pushed forward) while attempts <
   * max_attempts; otherwise marks the job terminally FAILED (`terminal: true`). Never retries
   * forever — see lib/jobs/backoff.ts. `applied: false` means nothing was written.
   */
  fail(job: JobRef, errorMessage: string): Promise<{ applied: boolean; terminal: boolean }>;

  /** Only ever cancels a job of the given tenant that is still PENDING — a RUNNING job's in-flight
   * external call is never killed uncontrolled. Returns canceled: false for a job that isn't
   * PENDING (already running/finished/canceled) or that belongs to another tenant. */
  cancel(job: JobRef): Promise<{ canceled: boolean }>;
}
