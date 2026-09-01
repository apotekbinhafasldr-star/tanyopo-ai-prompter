import type { z } from "zod";

export interface StructuredGenerationRequest {
  /** System prompt — brand/tenant context, task instructions, guardrails. */
  system: string;
  /** The user-facing request, already filled in with product/campaign data. */
  prompt: string;
  maxTokens?: number;
  /**
   * Model override chosen by the AI Router (lib/ai/router.ts) for the
   * calling task class. When omitted, the provider adapter uses its own
   * built-in default — this keeps a provider usable with zero model
   * configuration, matching the behavior every phase before the AI Router
   * existed already relied on.
   */
  model?: string;
}

export interface StructuredGenerationResult<T> {
  data: T;
  /** Which provider actually produced this result — "anthropic", "openai". */
  provider: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
}

/** Coarse, provider-agnostic failure category for AI usage accounting. */
export type AIErrorCategory =
  | "AUTH"
  | "RATE_LIMIT"
  | "CONNECTION"
  | "API"
  | "REFUSAL"
  | "INVALID_OUTPUT"
  | "CONFIG"
  | "UNKNOWN";

/**
 * Thrown by an AIProvider implementation instead of a plain Error so the
 * AI Router and prompter_ai_jobs bookkeeping (services/ai-jobs.ts) can
 * record *why* a call failed without parsing vendor-specific error text.
 */
export class AIProviderError extends Error {
  readonly category: AIErrorCategory;

  constructor(message: string, category: AIErrorCategory) {
    super(message);
    this.name = "AIProviderError";
    this.category = category;
  }
}

/**
 * Vendor-neutral AI provider contract (docs/AI_SYSTEM.md). Business logic
 * (Marketing Blueprint, Campaign Proposal, Content Generation, ...) never
 * calls a vendor SDK directly, and as of the multi-provider AI Router
 * (lib/ai/router.ts) it never even picks *which* provider runs — it only
 * declares a task class. This interface is what the Router calls.
 *
 * Every generation method returns data already validated against the
 * caller's Zod schema. If the model's output doesn't validate, the call
 * throws rather than returning a best-effort guess — see
 * docs/AI_SYSTEM.md "Structured output only".
 */
export interface AIProvider {
  readonly name: string;
  generateStructured<T>(
    schema: z.ZodType<T>,
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResult<T>>;
}
