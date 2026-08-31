import "server-only";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type {
  AIProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "@/lib/ai/provider";

const MODEL = "gpt-5.1";
const DEFAULT_MAX_TOKENS = 4000;

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
    let completion;
    try {
      completion = await this.client.chat.completions.parse({
        model: MODEL,
        max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        response_format: zodResponseFormat(schema, "structured_output"),
      });
    } catch (err) {
      // Most-specific-first: distinguish retryable from non-retryable
      // failures rather than surfacing one generic message.
      if (err instanceof OpenAI.AuthenticationError) {
        throw new Error("AI provider menolak kredensial. Periksa OPENAI_API_KEY.");
      }
      if (err instanceof OpenAI.RateLimitError) {
        throw new Error("AI provider sedang sibuk. Coba lagi sebentar lagi.");
      }
      if (err instanceof OpenAI.APIConnectionError) {
        throw new Error("Tidak dapat menghubungi AI provider. Periksa koneksi jaringan.");
      }
      if (err instanceof OpenAI.APIError) {
        throw new Error(`AI provider mengembalikan error (${err.status}).`);
      }
      throw err;
    }

    const choice = completion.choices[0];

    if (choice?.message.refusal) {
      throw new Error(`AI menolak membuat konten ini (${choice.message.refusal}).`);
    }

    if (!choice?.message.parsed) {
      throw new Error("Respons AI tidak sesuai format yang diharapkan.");
    }

    return {
      data: choice.message.parsed,
      model: completion.model,
      tokensInput: completion.usage?.prompt_tokens ?? 0,
      tokensOutput: completion.usage?.completion_tokens ?? 0,
    };
  }
}
