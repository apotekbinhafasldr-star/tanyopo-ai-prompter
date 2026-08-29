import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type {
  AIProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "@/lib/ai/provider";

const MODEL = "claude-opus-5";
const DEFAULT_MAX_TOKENS = 4000;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateStructured<T>(
    schema: z.ZodType<T>,
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResult<T>> {
    let message;
    try {
      message = await this.client.messages.parse({
        model: MODEL,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          format: zodOutputFormat(schema),
        },
      });
    } catch (err) {
      // Most-specific-first: distinguish retryable from non-retryable
      // failures rather than surfacing one generic message.
      if (err instanceof Anthropic.AuthenticationError) {
        throw new Error("AI provider menolak kredensial. Periksa AI_PROVIDER_API_KEY.");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new Error("AI provider sedang sibuk. Coba lagi sebentar lagi.");
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new Error("Tidak dapat menghubungi AI provider. Periksa koneksi jaringan.");
      }
      if (err instanceof Anthropic.APIError) {
        throw new Error(`AI provider mengembalikan error (${err.status}).`);
      }
      throw err;
    }

    if (message.stop_reason === "refusal") {
      throw new Error(
        `AI menolak membuat konten ini${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}.`,
      );
    }

    if (!message.parsed_output) {
      throw new Error("Respons AI tidak sesuai format yang diharapkan.");
    }

    return {
      data: message.parsed_output,
      model: message.model,
      tokensInput: message.usage.input_tokens,
      tokensOutput: message.usage.output_tokens,
    };
  }
}
