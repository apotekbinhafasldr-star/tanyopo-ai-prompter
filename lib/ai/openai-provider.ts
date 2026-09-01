import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import {
  AIProviderError,
  type AIProvider,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from "@/lib/ai/provider";

const DEFAULT_MAX_OUTPUT_TOKENS = 4000;

/**
 * OpenAI adapter for the AIProvider contract, via the Responses API
 * (client.responses.parse()) — OpenAI's current structured-output
 * surface, mirroring the same "throw on anything that isn't a validated
 * structured result" discipline as lib/ai/anthropic-provider.ts.
 *
 * Unlike Anthropic, this provider has no hardcoded default model — no
 * OpenAI model id has been chosen/verified in this codebase before, so a
 * caller (via the AI Router, lib/ai/router.ts) must always supply one via
 * request.model. Guessing a model id here would risk a silent
 * "NOT_CONFIGURED but running anyway" failure mode this app never allows.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generateStructured<T>(
    schema: z.ZodType<T>,
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResult<T>> {
    if (!request.model) {
      throw new AIProviderError(
        "Tidak ada model OpenAI yang dikonfigurasi untuk permintaan ini.",
        "CONFIG",
      );
    }

    let response;
    try {
      response = await this.client.responses.parse({
        model: request.model,
        instructions: request.system,
        input: request.prompt,
        max_output_tokens: request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        text: { format: zodTextFormat(schema, "result") },
      });
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) {
        throw new AIProviderError("OpenAI menolak kredensial. Periksa OPENAI_API_KEY.", "AUTH");
      }
      if (err instanceof OpenAI.RateLimitError) {
        throw new AIProviderError("OpenAI sedang sibuk. Coba lagi sebentar lagi.", "RATE_LIMIT");
      }
      if (err instanceof OpenAI.APIConnectionError) {
        throw new AIProviderError("Tidak dapat menghubungi OpenAI. Periksa koneksi jaringan.", "CONNECTION");
      }
      if (err instanceof OpenAI.APIError) {
        throw new AIProviderError(`OpenAI mengembalikan error (${err.status}).`, "API");
      }
      throw err;
    }

    const refusal = extractRefusal(response.output);
    if (refusal) {
      throw new AIProviderError(`AI menolak membuat konten ini (${refusal}).`, "REFUSAL");
    }

    if (!response.output_parsed) {
      throw new AIProviderError("Respons OpenAI tidak sesuai format yang diharapkan.", "INVALID_OUTPUT");
    }

    return {
      data: response.output_parsed,
      provider: this.name,
      model: response.model,
      tokensInput: response.usage?.input_tokens ?? 0,
      tokensOutput: response.usage?.output_tokens ?? 0,
    };
  }
}

/** Responses API refusals surface as a `refusal`-type content item, not a top-level stop reason. */
function extractRefusal(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "message") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "refusal") {
        return String((part as { refusal?: unknown }).refusal ?? "refused");
      }
    }
  }
  return null;
}
