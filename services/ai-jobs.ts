import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { routeStructuredGeneration, AIRoutingNotConfiguredError } from "@/lib/ai/router";
import { AIProviderError } from "@/lib/ai/provider";
import { TASK_CLASS_BY_JOB_TYPE } from "@/lib/ai/task-classes";
import type { AiJobType, Database, Json } from "@/types/database";

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
  const { supabase, tenantId, actorUserId, jobType, schema, system, prompt, inputReference } = params;
  const taskClass = TASK_CLASS_BY_JOB_TYPE[jobType];

  const { data: job, error: insertError } = await supabase
    .from("prompter_ai_jobs")
    .insert({
      tenant_id: tenantId,
      actor_user_id: actorUserId ?? null,
      job_type: jobType,
      status: "PROCESSING",
      input_reference: inputReference as Json,
    })
    .select("id")
    .single();

  try {
    const result = await routeStructuredGeneration(taskClass, schema, { system, prompt });

    if (job) {
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
        .eq("id", job.id);
    }

    return {
      ok: true,
      data: result.data,
      jobId: job?.id ?? "",
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
    };
  } catch (err) {
    if (err instanceof AIRoutingNotConfiguredError) {
      // Nothing configured at all — this isn't a failed generation, it's
      // a NOT_CONFIGURED state. No job row should exist for it; if the
      // insert above raced ahead of this check, clean it up rather than
      // leaving a misleading FAILED row for a feature nobody tried to use.
      if (job) {
        await supabase.from("prompter_ai_jobs").delete().eq("id", job.id);
      }
      return {
        ok: false,
        error: "AI belum dikonfigurasi. Tambahkan OPENAI_API_KEY atau ANTHROPIC_API_KEY untuk mengaktifkan fitur ini.",
        jobId: null,
      };
    }

    const message = err instanceof Error ? err.message : "AI gagal memproses permintaan.";
    const category = err instanceof AIProviderError ? err.category : "UNKNOWN";

    if (insertError || !job) {
      return { ok: false, error: "Gagal membuat catatan AI job.", jobId: null };
    }

    await supabase
      .from("prompter_ai_jobs")
      .update({ status: "FAILED", error: message, error_category: category, completed_at: new Date().toISOString() })
      .eq("id", job.id);

    return { ok: false, error: message, jobId: job.id };
  }
}
