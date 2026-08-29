import { describe, expect, it } from "vitest";
import { promoteWizardSchema } from "@/schemas/campaign";

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
