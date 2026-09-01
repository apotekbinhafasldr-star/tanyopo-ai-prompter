import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimNextJob, completeJob, failJob } from "@/services/jobs";
import { apiError, apiSuccess } from "@/lib/api/response";
import { isAuthorizedProcessorRequest } from "@/lib/jobs/authorize-processor";
import type { Job } from "@/lib/jobs/job-queue";
import type { JobType } from "@/types/database";

/**
 * Claims and runs up to `batchSize` due jobs from the queue. Requires a
 * bearer secret (JOBS_PROCESSOR_SECRET) — unset (the state in every
 * environment this app has run in) means this always responds
 * NOT_CONFIGURED, regardless of caller. Even once set, nothing in this
 * app calls this endpoint on a schedule; an external scheduler (Vercel
 * Cron, pg_cron, ...) has to be configured separately to actually drive
 * production queue execution, which is why "the architecture exists" and
 * "jobs run autonomously in production" are two different, independently
 * NOT_CONFIGURED, things here.
 *
 * JOB_HANDLERS starts empty on purpose — see the comment below. No
 * existing feature enqueues anything into this queue yet (services/jobs.ts),
 * so in every environment this app has actually run in, claimNextJob()
 * always returns null and this route is a no-op even if it were called.
 */
type JobHandler = (job: Job) => Promise<Record<string, unknown> | void>;

/**
 * Deliberately empty. A handler is only ever added here alongside the
 * feature that starts enqueueing that job_type — until then, a claimed
 * job of that type fails immediately with a clear "no handler
 * registered" error rather than this route guessing what to do with it.
 * This is also the "no uncontrolled AI loops" boundary: an AI_GENERATION
 * job can only ever run through whatever governed pipeline (Budget
 * Guard, Approval Center, runAiJob()) its future handler is written to
 * call — the queue itself never grants an AI call new authority.
 */
const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = {};

export async function POST(request: NextRequest) {
  if (!serverEnv.jobs.processorSecret) {
    return apiError("NOT_CONFIGURED", "Job processor belum dikonfigurasi (JOBS_PROCESSOR_SECRET kosong).", 503);
  }

  if (!isAuthorizedProcessorRequest(request.headers.get("authorization"), serverEnv.jobs.processorSecret)) {
    return apiError("UNAUTHORIZED", "Token processor tidak valid.", 401);
  }

  const admin = createAdminClient();
  if (!admin) {
    return apiError("NOT_CONFIGURED", "Server belum dikonfigurasi (SUPABASE_SECRET_KEY kosong).", 503);
  }

  const batchSize = 5;
  const processed: { jobId: string; status: string }[] = [];

  for (let i = 0; i < batchSize; i++) {
    const job = await claimNextJob(admin);
    if (!job) break;

    const handler = JOB_HANDLERS[job.job_type];

    if (!handler) {
      await failJob(admin, job, `Tidak ada handler terdaftar untuk job_type '${job.job_type}'.`);
      processed.push({ jobId: job.id, status: "FAILED" });
      continue;
    }

    try {
      const result = await handler(job);
      await completeJob(admin, job.id, result ?? undefined);
      processed.push({ jobId: job.id, status: "SUCCEEDED" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Job gagal dijalankan.";
      await failJob(admin, job, message);
      processed.push({ jobId: job.id, status: "FAILED" });
    }
  }

  return apiSuccess({ processed });
}
