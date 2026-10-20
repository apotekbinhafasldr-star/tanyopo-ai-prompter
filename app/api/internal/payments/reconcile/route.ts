import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, apiSuccess } from "@/lib/api/response";
import { isAuthorizedProcessorRequest } from "@/lib/jobs/authorize-processor";
import { runPaymentReconciliation } from "@/services/payment-reconciliation-job";

/**
 * Billing Financial Safety — lost-webhook recovery endpoint. Same bearer
 * secret and the same NOT_CONFIGURED discipline as
 * app/api/internal/jobs/process/route.ts: with JOBS_PROCESSOR_SECRET unset
 * it always answers 503, and nothing in this app schedules a call to it —
 * an external scheduler must be configured separately (Founder decision,
 * see docs/BILLING_FINANCIAL_SAFETY.md). With no payment provider
 * configured the run is a no-op, so deploying this route activates nothing.
 */
export async function POST(request: NextRequest) {
  if (!serverEnv.jobs.processorSecret) {
    return apiError("NOT_CONFIGURED", "Processor belum dikonfigurasi (JOBS_PROCESSOR_SECRET kosong).", 503);
  }

  if (!isAuthorizedProcessorRequest(request.headers.get("authorization"), serverEnv.jobs.processorSecret)) {
    return apiError("UNAUTHORIZED", "Token processor tidak valid.", 401);
  }

  const admin = createAdminClient();
  if (!admin) {
    return apiError("NOT_CONFIGURED", "Server belum dikonfigurasi (SUPABASE_SECRET_KEY kosong).", 503);
  }

  const summary = await runPaymentReconciliation(admin);
  return apiSuccess(summary);
}
