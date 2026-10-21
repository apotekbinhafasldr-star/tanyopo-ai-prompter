import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, JobType } from "@/types/database";
import type { EnqueueJobInput, EnqueueJobResult, Job, JobQueueProvider, JobRef } from "@/lib/jobs/job-queue";
import { computeBackoffSeconds } from "@/lib/jobs/backoff";

const UNIQUE_VIOLATION = "23505";

/** A job is only addressable by a non-empty id AND tenant; anything else is rejected before any query. */
function isValidRef(job: JobRef | null | undefined): job is JobRef {
  return !!job && typeof job.id === "string" && job.id.length > 0 && typeof job.tenantId === "string" && job.tenantId.length > 0;
}

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

  async complete(job: JobRef, result?: Record<string, unknown>): Promise<{ applied: boolean }> {
    if (!isValidRef(job)) return { applied: false };

    const { data } = await this.admin
      .from("prompter_jobs")
      .update({
        status: "SUCCEEDED",
        finished_at: new Date().toISOString(),
        result: (result ?? null) as Database["public"]["Tables"]["prompter_jobs"]["Update"]["result"],
        error: null,
      })
      .eq("id", job.id)
      .eq("tenant_id", job.tenantId)
      .eq("status", "RUNNING")
      .select("id")
      .maybeSingle();

    return { applied: !!data };
  }

  /**
   * Re-reads attempts/max_attempts fresh (for THIS tenant's RUNNING job only) rather than trusting a
   * caller-supplied value, so backoff scheduling is always based on the real current attempt count.
   */
  async fail(job: JobRef, errorMessage: string): Promise<{ applied: boolean; terminal: boolean }> {
    if (!isValidRef(job)) return { applied: false, terminal: false };

    const { data: row } = await this.admin
      .from("prompter_jobs")
      .select("attempts, max_attempts")
      .eq("id", job.id)
      .eq("tenant_id", job.tenantId)
      .eq("status", "RUNNING")
      .maybeSingle();

    if (!row) return { applied: false, terminal: false };

    const terminal = row.attempts >= row.max_attempts;
    const patch = terminal
      ? { status: "FAILED" as const, finished_at: new Date().toISOString(), error: errorMessage }
      : {
          status: "PENDING" as const,
          run_at: new Date(Date.now() + computeBackoffSeconds(row.attempts) * 1000).toISOString(),
          error: errorMessage,
        };

    const { data: updated } = await this.admin
      .from("prompter_jobs")
      .update(patch)
      .eq("id", job.id)
      .eq("tenant_id", job.tenantId)
      .eq("status", "RUNNING")
      .select("id")
      .maybeSingle();

    return { applied: !!updated, terminal: !!updated && terminal };
  }

  /** Only PENDING -> CANCELED, and only for the job's own tenant; a RUNNING job's external call is never interrupted. */
  async cancel(job: JobRef): Promise<{ canceled: boolean }> {
    if (!isValidRef(job)) return { canceled: false };

    const { data } = await this.admin
      .from("prompter_jobs")
      .update({ status: "CANCELED", finished_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("tenant_id", job.tenantId)
      .eq("status", "PENDING")
      .select("id")
      .maybeSingle();

    return { canceled: !!data };
  }
}
