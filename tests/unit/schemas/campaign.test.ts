import { describe, expect, it } from "vitest";
import { promoteWizardSchema, quickPromoteSchema } from "@/schemas/campaign";

describe("promoteWizardSchema", () => {
  const valid = {
    productId: "550e8400-e29b-41d4-a716-446655440000",
    objective: "INCREASE_SALES",
    channels: ["FACEBOOK", "INSTAGRAM"],
    targetCountry: "Indonesia",
    targetRegion: "",
    targetCity: "",
    audienceNotes: "",
    dailyBudget: "50000",
    totalBudget: "1000000",
    durationDays: "30",
    startDate: "",
  };

  it("accepts a valid wizard submission", () => {
    expect(promoteWizardSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-uuid productId", () => {
    const result = promoteWizardSchema.safeParse({ ...valid, productId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty channel list", () => {
    const result = promoteWizardSchema.safeParse({ ...valid, channels: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown channel", () => {
    const result = promoteWizardSchema.safeParse({ ...valid, channels: ["YOUTUBE"] });
    expect(result.success).toBe(false);
  });
});

describe("quickPromoteSchema", () => {
  const minimal = {
    productId: "550e8400-e29b-41d4-a716-446655440000",
    objective: "INCREASE_SALES",
    dailyBudget: "50000",
  };

  it("accepts product + objective + daily budget alone (no channels/audience required)", () => {
    expect(quickPromoteSchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts a total budget instead of a daily budget", () => {
    const result = quickPromoteSchema.safeParse({
      productId: minimal.productId,
      objective: minimal.objective,
      totalBudget: "1000000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when neither daily nor total budget is provided", () => {
    const result = quickPromoteSchema.safeParse({
      productId: minimal.productId,
      objective: minimal.objective,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing objective", () => {
    const result = quickPromoteSchema.safeParse({ productId: minimal.productId, dailyBudget: "50000" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid productId", () => {
    const result = quickPromoteSchema.safeParse({ ...minimal, productId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("accepts optional advanced fields (channels, audience) when provided", () => {
    const result = quickPromoteSchema.safeParse({
      ...minimal,
      channels: ["FACEBOOK"],
      targetCountry: "Indonesia",
      audienceNotes: "ibu-ibu usia 25-40",
    });
    expect(result.success).toBe(true);
  });
});
