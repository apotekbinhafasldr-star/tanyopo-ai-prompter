/**
 * Pure cost estimation for AI calls (E1). No I/O, no env access, no network.
 *
 * Prices are USD per 1,000,000 tokens and live in AI_MODEL_PRICING below.
 * The table is intentionally EMPTY until someone copies prices from the
 * providers' official pricing pages: a wrong number would be written into an
 * immutable column (prompter_ai_jobs.estimated_cost), and a model we have no
 * price for must yield `null`, never a guess. To add a model, add one entry
 * keyed by the exact model id the provider returns (snapshot date suffixes
 * such as "-20260101" or "-2026-01-01" are stripped before lookup), and note
 * the source + date in a comment next to it.
 *
 * Example entry (illustrative shape only, NOT a real price):
 *   "anthropic:some-model-id": { inputPerMTok: 1, outputPerMTok: 5 },
 */

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number;
}

export type ModelPricingTable = Readonly<Record<string, ModelPrice>>;

/** Key format: `${provider}:${model}`, both lowercase. */
export const AI_MODEL_PRICING: ModelPricingTable = {};

/** prompter_ai_jobs.estimated_cost is numeric(10,4). */
const COST_DECIMALS = 4;

const SNAPSHOT_SUFFIX = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

export function pricingKey(provider: string, model: string): string {
  return `${provider.trim().toLowerCase()}:${model.trim().toLowerCase()}`;
}

/** Exact match first, then the same id without a trailing snapshot date. No prefix/fuzzy matching. */
export function lookupModelPrice(
  provider: string,
  model: string,
  table: ModelPricingTable = AI_MODEL_PRICING,
): ModelPrice | null {
  if (!provider || !model) return null;
  const exact = pricingKey(provider, model);
  const candidates = [exact, exact.replace(SNAPSHOT_SUFFIX, "")];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      const price = table[key];
      if (isValidPrice(price)) return price;
    }
  }
  return null;
}

function isValidPrice(price: ModelPrice | undefined): price is ModelPrice {
  return (
    !!price &&
    Number.isFinite(price.inputPerMTok) &&
    Number.isFinite(price.outputPerMTok) &&
    price.inputPerMTok >= 0 &&
    price.outputPerMTok >= 0
  );
}

function isValidTokenCount(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Estimated USD cost of one call, rounded to 4 decimals (the column's scale),
 * or `null` when the model has no known price or the token counts are not
 * usable. It is an ESTIMATE from reported token counts: it ignores prompt
 * caching discounts, batch pricing and any provider-side surcharges.
 */
export function estimateCostUsd(
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  table: ModelPricingTable = AI_MODEL_PRICING,
): number | null {
  if (!isValidTokenCount(tokensIn) || !isValidTokenCount(tokensOut)) return null;
  const price = lookupModelPrice(provider, model, table);
  if (!price) return null;

  const raw = (tokensIn * price.inputPerMTok + tokensOut * price.outputPerMTok) / 1_000_000;
  const factor = 10 ** COST_DECIMALS;
  return Math.round(raw * factor) / factor;
}
