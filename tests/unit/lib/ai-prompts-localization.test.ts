import { describe, expect, it } from "vitest";
import { buildSystemPreamble } from "@/lib/ai/prompts";
import type { Database } from "@/types/database";

type BrandProfile = Database["public"]["Tables"]["prompter_brand_profiles"]["Row"];

function makeBrandProfile(overrides: Partial<BrandProfile> = {}): BrandProfile {
  return {
    tenant_id: "t1",
    brand_name: null,
    business_description: null,
    what_do_you_sell: null,
    business_category: null,
    primary_goal: null,
    tone_of_voice: null,
    target_market: null,
    prohibited_claims: null,
    default_language: "id",
    default_location: null,
    default_currency: "IDR",
    default_timezone: "Asia/Jakarta",
    country_code: null,
    region: null,
    billing_country: null,
    logo_url: null,
    website_url: null,
    onboarding_completed: true,
    onboarding_step: 8,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("buildSystemPreamble — AI localization (product spec §9)", () => {
  it("writes in Indonesian by default (null brand profile — unchanged pre-Global-Edition behavior)", () => {
    const preamble = buildSystemPreamble(null);
    expect(preamble).toContain("Tulis dalam Bahasa Indonesia");
    expect(preamble).not.toContain("Write in natural English");
  });

  it("writes in Indonesian when default_language is 'id'", () => {
    const preamble = buildSystemPreamble(makeBrandProfile({ default_language: "id" }));
    expect(preamble).toContain("Tulis dalam Bahasa Indonesia");
  });

  it("writes in English when default_language is 'en' — a real language switch, not a translation instruction bolted onto Indonesian", () => {
    const preamble = buildSystemPreamble(makeBrandProfile({ default_language: "en" }));
    expect(preamble).toContain("Write in natural English");
    expect(preamble).not.toContain("Tulis dalam Bahasa Indonesia");
  });

  it("includes the localization guardrails against discriminatory targeting, compliance claims, fabricated stats, and promised results — in both languages", () => {
    const idPreamble = buildSystemPreamble(makeBrandProfile({ default_language: "id" }));
    const enPreamble = buildSystemPreamble(makeBrandProfile({ default_language: "en" }));

    for (const preamble of [idPreamble, enPreamble]) {
      expect(preamble.toLowerCase()).toMatch(/karakteristik dilindungi|protected characteristics/);
      expect(preamble.toLowerCase()).toMatch(/kepatuhan hukum|legal\/regulatory compliance/);
      expect(preamble.toLowerCase()).toMatch(/mengarang statistik|fabricate local market statistics/);
      expect(preamble.toLowerCase()).toMatch(/menjanjikan hasil|promise a specific result/);
    }
  });

  it("includes the business home market (country_code) in the localized language", () => {
    const idPreamble = buildSystemPreamble(makeBrandProfile({ default_language: "id", country_code: "ID" }));
    const enPreamble = buildSystemPreamble(makeBrandProfile({ default_language: "en", country_code: "US" }));

    expect(idPreamble).toContain("Pasar asal bisnis (negara): ID");
    expect(enPreamble).toContain("Business home market (country): US");
  });
});
