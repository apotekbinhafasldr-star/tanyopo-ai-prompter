import type { z } from "zod";

export interface StructuredGenerationRequest {
  /** System prompt — brand/tenant context, task instructions, guardrails. */
  system: string;
  /** The user-facing request, already filled in with product/campaign data. */
  prompt: string;
  maxTokens?: number;
}

export interface StructuredGenerationResult<T> {
  data: T;
  model: string;
  tokensInput: number;
  tokensOutput: number;
}

/**
 * Vendor-neutral AI provider contract (docs/AI_SYSTEM.md). Business logic
 * (Marketing Blueprint, Campaign Proposal, Content Generation) calls only
 * this interface — never a vendor SDK directly — so the underlying model
 * provider can be swapped without touching feature code.
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
