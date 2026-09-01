import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  AIProviderError,
  type AIProvider,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from "@/lib/ai/provider";

const DEFAULT_MODEL = "claude-opus-5";
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
        model: request.model ?? DEFAULT_MODEL,
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
        throw new AIProviderError("Anthropic menolak kredensial. Periksa ANTHROPIC_API_KEY.", "AUTH");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new AIProviderError("Anthropic sedang sibuk. Coba lagi sebentar lagi.", "RATE_LIMIT");
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new AIProviderError("Tidak dapat menghubungi Anthropic. Periksa koneksi jaringan.", "CONNECTION");
      }
      if (err instanceof Anthropic.APIError) {
        throw new AIProviderError(`Anthropic mengembalikan error (${err.status}).`, "API");
      }
      throw err;
    }

    if (message.stop_reason === "refusal") {
      throw new AIProviderError(
        `AI menolak membuat konten ini${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}.`,
        "REFUSAL",
      );
    }

    if (!message.parsed_output) {
      throw new AIProviderError("Respons Anthropic tidak sesuai format yang diharapkan.", "INVALID_OUTPUT");
    }

    return {
      data: message.parsed_output,
      provider: this.name,
      model: message.model,
      tokensInput: message.usage.input_tokens,
      tokensOutput: message.usage.output_tokens,
    };
  }
}
