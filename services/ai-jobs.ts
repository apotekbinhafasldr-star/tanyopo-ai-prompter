import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { AIProvider } from "@/lib/ai/provider";
import type { AiJobType, Database, Json } from "@/types/database";

interface RunAiJobParams<T> {
  supabase: SupabaseClient<Database>;
  provider: AIProvider;
  tenantId: string;
  jobType: AiJobType;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  inputReference: Record<string, unknown>;
}

export type RunAiJobResult<T> =
  | { ok: true; data: T; jobId: string; model: string }
  | { ok: false; error: string; jobId: string | null };

/**
 * Wraps a single AIProvider.generateStructured() call with the
 * prompter_ai_jobs bookkeeping every AI generation must produce (product
 * spec §37, cost observability §91). Creates the job row up front, then
 * marks it COMPLETED or FAILED — never leaves a job stuck QUEUED.
 */
export async function runAiJob<T>(params: RunAiJobParams<T>): Promise<RunAiJobResult<T>> {
  const { supabase, provider, tenantId, jobType, schema, system, prompt, inputReference } = params;

  const { data: job, error: insertError } = await supabase
    .from("prompter_ai_jobs")
    .insert({
      tenant_id: tenantId,
      job_type: jobType,
      status: "PROCESSING",
      input_reference: inputReference as Json,
    })
    .select("id")
    .single();

  if (insertError || !job) {
    return { ok: false, error: "Gagal membuat catatan AI job.", jobId: null };
  }

  try {
    const result = await provider.generateStructured(schema, { system, prompt });

    await supabase
      .from("prompter_ai_jobs")
      .update({
        status: "COMPLETED",
        model: result.model,
        tokens_input: result.tokensInput,
        tokens_output: result.tokensOutput,
        output_reference: result.data as unknown as Json,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return { ok: true, data: result.data, jobId: job.id, model: result.model };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI gagal memproses permintaan.";

    await supabase
      .from("prompter_ai_jobs")
      .update({ status: "FAILED", error: message, completed_at: new Date().toISOString() })
      .eq("id", job.id);

    return { ok: false, error: message, jobId: job.id };
  }
}
