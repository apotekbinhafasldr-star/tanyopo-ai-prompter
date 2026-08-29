import { describe, expect, it } from "vitest";
import { onboardingSchema } from "@/schemas/onboarding";

describe("onboardingSchema", () => {
  const valid = {
    brandName: "Kopi Nusantara",
    businessCategory: "PHYSICAL_PRODUCT",
    whatDoYouSell: "Kopi kemasan siap seduh",
    primaryGoal: "INCREASE_SALES",
  };

  it("accepts a complete valid submission", () => {
    expect(onboardingSchema.safeParse(valid).success).toBe(true);
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
