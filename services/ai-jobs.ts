import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { routeStructuredGeneration, AIRoutingNotConfiguredError } from "@/lib/ai/router";
import { AIProviderError } from "@/lib/ai/provider";
import { TASK_CLASS_BY_JOB_TYPE } from "@/lib/ai/task-classes";
import { getOrCreateSubscription } from "@/services/billing";
import type { AiJobType, Database, Json } from "@/types/database";

interface CreateAiJobIfEntitledRow {
  job_id: string | null;
  allowed: boolean;
  reason: string | null;
  used_count: number;
  allowance: number;
}

/** User-facing Indonesian text for each `reason` code
 * fn_create_ai_job_if_entitled() (Batch B9) can return. Never tells the
 * user to "pilih paket" to lift a block — no self-service action can
 * actually restore access (see services/billing.ts#changePlan's own
 * docstring) — so the copy stays honest about that. */
function describeEntitlementBlock(row: CreateAiJobIfEntitledRow): string {
  switch (row.reason) {
    case "TRIAL_EXPIRED":
      return "Masa trial Anda telah berakhir. Pembayaran online belum tersedia, jadi fitur AI dijeda sementara.";
    case "AI_USAGE_LIMIT_REACHED":
      return `Anda telah mencapai batas ${row.allowance} permintaan AI untuk periode ini.`;
    case "NO_SUBSCRIPTION":
    case "NO_TENANT":
      return "Akun Anda belum memiliki data langganan yang valid. Silakan muat ulang halaman atau hubungi dukungan.";
    default:
      return "Akses AI tidak diizinkan untuk paket Anda saat ini.";
  }
}

interface RunAiJobParams<T> {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  /** The user who triggered this generation, when the call happens in a request context. */
  actorUserId?: string | null;
  jobType: AiJobType;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  inputReference: Record<string, unknown>;
}

export type RunAiJobResult<T> =
  | { ok: true; data: T; jobId: string; provider: string; model: string; fallbackUsed: boolean }
  | { ok: false; error: string; jobId: string | null };

/**
 * Wraps one AI Router (lib/ai/router.ts) structured-generation call with
 * the prompter_ai_jobs bookkeeping every AI generation must produce
 * (product spec §37, cost observability §91, AI usage accounting for
 * Free/Pro/Business/Growth/Agency plans). Creates the job row up front,
 * then marks it COMPLETED or FAILED — never leaves a job stuck QUEUED.
 *
 * The job's task class is derived from its job_type
 * (lib/ai/task-classes.ts) — callers never pick a provider themselves,
 * consistent with "business modules must not scatter provider calls."
 * When nothing is configured at all, no job row is created and a plain
 * NOT_CONFIGURED-style error is returned — the same UX every AI feature
 * had before the router existed.
 */
export async function runAiJob<T>(params: RunAiJobParams<T>): Promise<RunAiJobResult<T>> {
  // actorUserId is intentionally not read here — Batch B9's
  // fn_create_ai_job_if_entitled() derives it server-side from auth.uid()
  // (the same JWT tenantId itself comes from), never a caller-supplied
  // value, so it's still accepted on RunAiJobParams for callers/future
  // audit use but no longer trusted by this function.
  const { supabase, tenantId, jobType, schema, system, prompt, inputReference } = params;
  const taskClass = TASK_CLASS_BY_JOB_TYPE[jobType];

  // Ensures a subscription row exists (lazily starting a new tenant's
  // trial on first access) before the atomic entitlement check below —
  // unchanged from before Batch B9.
  await getOrCreateSubscription(supabase, tenantId);

  // Batch B9 P0-1/P1-2/P2-1 — every AI generation in the app funnels
  // through here, so this is the one place entitlement (trial expiry,
  // trial's 30-total-usage cap, and every paid plan's aiUsageAllowance
  // alike) is actually enforced. fn_create_ai_job_if_entitled() checks
  // entitlement AND inserts the job row in one atomic, tenant-locked
  // database transaction (supabase/migrations/20260912090000_prompter_b9_entitlement_enforcement.sql)
  // instead of a separate check-then-insert, closing the previous
  // check-then-act race. Tenant identity is derived server-side inside
  // that function (fn_current_tenant_id()), never sent as a parameter, so
  // this cannot be used to read or consume another tenant's allowance. A
  // failed RPC call (network/DB error) fails closed — no job is created
  // and no AI call is made — same "don't record a job nobody actually
  // ran" rule as the AIRoutingNotConfiguredError branch below.
  const { data: entitlementRows, error: entitlementError } = await supabase.rpc(
    "fn_create_ai_job_if_entitled",
    { p_job_type: jobType, p_input_reference: (inputReference as Json) ?? {} },
  );

  if (entitlementError) {
    return { ok: false, error: "Gagal memeriksa kuota AI. Silakan coba lagi.", jobId: null };
  }

  const entitlementRow = (
    Array.isArray(entitlementRows) ? entitlementRows[0] : entitlementRows
  ) as CreateAiJobIfEntitledRow | undefined;

  if (!entitlementRow || !entitlementRow.allowed || !entitlementRow.job_id) {
    return {
      ok: false,
      error: entitlementRow ? describeEntitlementBlock(entitlementRow) : "Gagal memeriksa kuota AI. Silakan coba lagi.",
      jobId: null,
    };
  }

  const jobId = entitlementRow.job_id;

  try {
    const result = await routeStructuredGeneration(taskClass, schema, { system, prompt });

    await supabase
      .from("prompter_ai_jobs")
      .update({
        status: "COMPLETED",
        provider: result.provider,
        model: result.model,
        tokens_input: result.tokensInput,
        tokens_output: result.tokensOutput,
        fallback_provider: result.fallbackUsed ? result.fallbackFrom : null,
        output_reference: result.data as unknown as Json,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return {
      ok: true,
      data: result.data,
      jobId,
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
    };
  } catch (err) {
    if (err instanceof AIRoutingNotConfiguredError) {
      // Nothing configured at all — this isn't a failed generation, it's
      // a NOT_CONFIGURED state. No job row should exist for it — the atomic
      // RPC above already consumed one unit of the tenant's allowance to
      // create it, so it's deleted here rather than left as a misleading
      // FAILED row for a feature nobody tried to use.
      await supabase.from("prompter_ai_jobs").delete().eq("id", jobId);
      return {
        ok: false,
        error: "AI belum dikonfigurasi. Tambahkan OPENAI_API_KEY atau ANTHROPIC_API_KEY untuk mengaktifkan fitur ini.",
        jobId: null,
      };
    }

    const message = err instanceof Error ? err.message : "AI gagal memproses permintaan.";
    const category = err instanceof AIProviderError ? err.category : "UNKNOWN";

    await supabase
      .from("prompter_ai_jobs")
      .update({ status: "FAILED", error: message, error_category: category, completed_at: new Date().toISOString() })
      .eq("id", jobId);

    return { ok: false, error: message, jobId };
  }
}
