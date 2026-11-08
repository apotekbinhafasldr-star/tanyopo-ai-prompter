import { describe, expect, it } from "vitest";
import { AI_MODEL_PRICING, estimateCostUsd, lookupModelPrice, type ModelPricingTable } from "@/lib/ai/pricing";

// Fixture prices are fictional round numbers used only to exercise the maths.
const TABLE: ModelPricingTable = {
  "anthropic:model-a": { inputPerMTok: 2, outputPerMTok: 10 },
  "openai:model-b": { inputPerMTok: 0.5, outputPerMTok: 4 },
  "openai:free-model": { inputPerMTok: 0, outputPerMTok: 0 },
  "openai:broken": { inputPerMTok: Number.NaN, outputPerMTok: 1 },
};

describe("estimateCostUsd", () => {
  it("computes (in * inPrice + out * outPrice) / 1M", () => {
    // 1,000 in * $2/M + 500 out * $10/M = 0.002 + 0.005
    expect(estimateCostUsd("anthropic", "model-a", 1000, 500, TABLE)).toBe(0.007);
    expect(estimateCostUsd("openai", "model-b", 2_000_000, 1_000_000, TABLE)).toBe(5);
  });

  it("rounds to 4 decimals, the scale of prompter_ai_jobs.estimated_cost", () => {
    // 123 in * $2/M = 0.000246 -> 0.0002
    expect(estimateCostUsd("anthropic", "model-a", 123, 0, TABLE)).toBe(0.0002);
  });

  it("returns null for an unknown model instead of guessing", () => {
    expect(estimateCostUsd("anthropic", "model-unknown", 1000, 1000, TABLE)).toBeNull();
    expect(estimateCostUsd("openai", "model-a", 1000, 1000, TABLE)).toBeNull();
    expect(estimateCostUsd("google", "model-a", 1000, 1000, TABLE)).toBeNull();
  });

  it("does not fuzzy/prefix match model names", () => {
    expect(estimateCostUsd("anthropic", "model-a-mini", 1000, 1000, TABLE)).toBeNull();
    expect(estimateCostUsd("anthropic", "model", 1000, 1000, TABLE)).toBeNull();
  });

  it("matches provider/model case-insensitively and ignores surrounding spaces", () => {
    expect(estimateCostUsd(" Anthropic ", " MODEL-A ", 1000, 500, TABLE)).toBe(0.007);
  });

  it("accepts a dated snapshot of a known model (yyyymmdd and yyyy-mm-dd) but not other suffixes", () => {
    expect(estimateCostUsd("anthropic", "model-a-20260101", 1000, 500, TABLE)).toBe(0.007);
    expect(estimateCostUsd("openai", "model-b-2026-01-01", 2_000_000, 1_000_000, TABLE)).toBe(5);
    expect(estimateCostUsd("openai", "model-b-preview", 1000, 1000, TABLE)).toBeNull();
  });

  it("returns null for unusable token counts", () => {
    expect(estimateCostUsd("anthropic", "model-a", -1, 10, TABLE)).toBeNull();
    expect(estimateCostUsd("anthropic", "model-a", 10, Number.NaN, TABLE)).toBeNull();
    expect(estimateCostUsd("anthropic", "model-a", Number.POSITIVE_INFINITY, 10, TABLE)).toBeNull();
  });

  it("returns 0 for zero tokens or a genuinely free model", () => {
    expect(estimateCostUsd("anthropic", "model-a", 0, 0, TABLE)).toBe(0);
    expect(estimateCostUsd("openai", "free-model", 5000, 5000, TABLE)).toBe(0);
  });

  it("treats a malformed table entry as unknown rather than producing NaN", () => {
    expect(lookupModelPrice("openai", "broken", TABLE)).toBeNull();
    expect(estimateCostUsd("openai", "broken", 1000, 1000, TABLE)).toBeNull();
  });

  it("does not resolve inherited object keys such as constructor", () => {
    expect(estimateCostUsd("", "", 1, 1, TABLE)).toBeNull();
    expect(lookupModelPrice("a", "constructor", TABLE)).toBeNull();
  });

  it("the shipped default table only contains well-formed entries", () => {
    for (const [key, price] of Object.entries(AI_MODEL_PRICING)) {
      expect(key, key).toMatch(/^[a-z]+:[^\s]+$/);
      expect(Number.isFinite(price.inputPerMTok) && price.inputPerMTok >= 0, key).toBe(true);
      expect(Number.isFinite(price.outputPerMTok) && price.outputPerMTok >= 0, key).toBe(true);
    }
  });
});
