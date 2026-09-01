import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, JobType } from "@/types/database";
import type { EnqueueJobInput, EnqueueJobResult, Job, JobQueueProvider } from "@/lib/jobs/job-queue";
import { computeBackoffSeconds } from "@/lib/jobs/backoff";

const UNIQUE_VIOLATION = "23505";

/**
 * DB-backed default JobQueueProvider — prompter_jobs +
 * prompter_claim_next_job() (the atomic `for update skip locked` claim
 * RPC, service_role-only). Every write goes through the service-role
 * (admin) client, matching every other cross-tenant-writing service in
 * this app (services/umkmpro.ts, lib/connectors/oauth-callback.ts) —
 * regular tenant sessions can only read their own tenant's jobs (RLS
 * SELECT policy), never claim/complete/fail/cancel one directly.
 */
export class SupabaseJobQueue implements JobQueueProvider {
  readonly name = "supabase";

  constructor(private readonly admin: SupabaseClient<Database>) {}

  /**
   * Idempotent on (tenant_id, job_type, idempotency_key) when a key is
   * given — insert-then-catch-unique-violation-then-fetch-existing, same
   * pattern as services/umkmpro.ts#createPromotionHandoff().
   */
  async enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    const { data: inserted, error: insertError } = await this.admin
      .from("prompter_jobs")
      .insert({
        tenant_id: input.tenantId,
        job_type: input.jobType,
        payload: (input.payload ?? {}) as Database["public"]["Tables"]["prompter_jobs"]["Insert"]["payload"],
        idempotency_key: input.idempotencyKey ?? null,
        max_attempts: input.maxAttempts ?? 5,
        created_by: input.createdBy ?? null,
      })
      .select("id")
      .single();

    if (!insertError && inserted) {
      return { jobId: inserted.id, alreadyExisted: false };
    }

    if (insertError?.code === UNIQUE_VIOLATION && input.idempotencyKey) {
      const { data: existing, error: fetchError } = await this.admin
        .from("prompter_jobs")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("job_type", input.jobType)
        .eq("idempotency_key", input.idempotencyKey)
        .single();

      if (!fetchError && existing) {
        return { jobId: existing.id, alreadyExisted: true };
      }
    }

    throw new Error(insertError?.message ?? "Gagal menambahkan job ke antrian.");
  }

  async claimNext(jobTypes?: JobType[]): Promise<Job | null> {
    const { data, error } = await this.admin.rpc("prompter_claim_next_job", {
      p_job_types: jobTypes ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }

    return data ?? null;
  }

  async complete(jobId: string, result?: Record<string, unknown>): Promise<void> {
    await this.admin
      .from("prompter_jobs")
      .update({
        status: "SUCCEEDED",
        finished_at: new Date().toISOString(),
        result: (result ?? null) as Database["public"]["Tables"]["prompter_jobs"]["Update"]["result"],
        error: null,
      })
      .eq("id", jobId);
  }

  /**
   * Re-reads attempts/max_attempts fresh rather than trusting a caller-
   * supplied value, so backoff scheduling is always based on the real
   * current attempt count.
   */
  async fail(jobId: string, errorMessage: string): Promise<void> {
    const { data: job } = await this.admin
      .from("prompter_jobs")
      .select("attempts, max_attempts")
      .eq("id", jobId)
      .single();

    if (!job) return;

    if (job.attempts >= job.max_attempts) {
      await this.admin
        .from("prompter_jobs")
        .update({ status: "FAILED", finished_at: new Date().toISOString(), error: errorMessage })
        .eq("id", jobId);
      return;
    }

    const backoffSeconds = computeBackoffSeconds(job.attempts);
    const nextRunAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    await this.admin
      .from("prompter_jobs")
      .update({ status: "PENDING", run_at: nextRunAt, error: errorMessage })
      .eq("id", jobId);
  }

  /** Only PENDING -> CANCELED; a RUNNING job's external call is never interrupted. */
  async cancel(jobId: string): Promise<{ canceled: boolean }> {
    const { data } = await this.admin
      .from("prompter_jobs")
      .update({ status: "CANCELED", finished_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "PENDING")
      .select("id")
      .maybeSingle();

    return { canceled: !!data };
  }
}
