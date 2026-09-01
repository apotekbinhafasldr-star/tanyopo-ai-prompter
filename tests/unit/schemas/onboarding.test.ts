import { describe, expect, it } from "vitest";
import { onboardingSchema } from "@/schemas/onboarding";

describe("onboardingSchema", () => {
  const valid = {
    brandName: "Kopi Nusantara",
    countryCode: "ID",
    language: "id",
    timezone: "Asia/Jakarta",
    currency: "IDR",
    businessCategory: "PHYSICAL_PRODUCT",
    whatDoYouSell: "Kopi kemasan siap seduh",
    primaryGoal: "INCREASE_SALES",
  };

  it("accepts a complete valid submission", () => {
    expect(onboardingSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an international submission with an explicit target market", () => {
    const result = onboardingSchema.safeParse({
      ...valid,
      countryCode: "us",
      language: "en",
      timezone: "America/New_York",
      currency: "USD",
      targetMarketCountryCode: "SG",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed country code", () => {
    const result = onboardingSchema.safeParse({ ...valid, countryCode: "USA" });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported currency", () => {
    const result = onboardingSchema.safeParse({ ...valid, currency: "JPY" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown business category", () => {
    const result = onboardingSchema.safeParse({ ...valid, businessCategory: "NOT_REAL" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown primary goal", () => {
    const result = onboardingSchema.safeParse({ ...valid, primaryGoal: "WORLD_DOMINATION" });
    expect(result.success).toBe(false);
  });

  it("rejects a brand name that is too short", () => {
    const result = onboardingSchema.safeParse({ ...valid, brandName: "K" });
    expect(result.success).toBe(false);
  });
});
