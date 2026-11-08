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

  // Contract change (Quick Promote): budget is OPTIONAL when creating the AI
  // strategy. The old "rejects when neither budget is provided" case encoded the
  // bug that disabled "Buat Strategi dengan AI" for organic/free strategies.
  // A budget is still required before a PAID LAUNCH — see
  // tests/unit/features/quick-promote-optional-budget.test.tsx
  // (allocateDailyBudget rejects a missing/zero daily budget).
  it("accepts product + objective with NO budget at all (organic/free strategy)", () => {
    const result = quickPromoteSchema.safeParse({
      productId: minimal.productId,
      objective: minimal.objective,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty-string and zero budgets (treated as not set)", () => {
    expect(quickPromoteSchema.safeParse({ ...minimal, dailyBudget: "", totalBudget: "" }).success).toBe(true);
    expect(quickPromoteSchema.safeParse({ ...minimal, dailyBudget: "0", totalBudget: "0" }).success).toBe(true);
  });

  it("still rejects a negative or non-numeric budget when one is given", () => {
    expect(quickPromoteSchema.safeParse({ ...minimal, dailyBudget: "-1" }).success).toBe(false);
    expect(quickPromoteSchema.safeParse({ ...minimal, totalBudget: "-5" }).success).toBe(false);
    expect(quickPromoteSchema.safeParse({ ...minimal, dailyBudget: "abc" }).success).toBe(false);
  });

  it("rejects a missing objective", () => {
    const result = quickPromoteSchema.safeParse({ productId: minimal.productId, dailyBudget: "50000" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid productId", () => {
    const result = quickPromoteSchema.safeParse({ ...minimal, productId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("accepts a real-world Quick Promote happy-path submission with every unfilled Advanced field simply absent (undefined), matching what QuickPromoteWizard actually submits after the fix", () => {
    // Regression test for the exact production bug: QuickPromoteWizard
    // never renders channels/targetCountry/.../startDate as form fields
    // when the user never opens "Pengaturan Lanjutan" beyond their initial
    // empty state, and the fixed action normalizes every missing FormData
    // key to undefined before calling safeParse — never a bare `null`.
    const result = quickPromoteSchema.safeParse({
      productId: "550e8400-e29b-41d4-a716-446655440000",
      objective: "INCREASE_SALES",
      dailyBudget: "50000",
      totalBudget: undefined,
      channels: [],
      targetCountry: "",
      targetRegion: "",
      targetCity: "",
      audienceNotes: "",
      durationDays: undefined,
      startDate: undefined,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a literal null for startDate — this is exactly the bug that shipped: formData.get() on a field the form never renders returns null, not undefined, and z.optional() rejects null", () => {
    const result = quickPromoteSchema.safeParse({ ...minimal, startDate: null });
    expect(result.success).toBe(false);
  });

  it("never surfaces a raw Zod default message — every failure reports one of this schema's own Indonesian messages", () => {
    const badChannel = quickPromoteSchema.safeParse({ ...minimal, channels: ["YOUTUBE"] });
    expect(badChannel.success).toBe(false);
    if (!badChannel.success) {
      expect(badChannel.error.issues[0]?.message).not.toMatch(/invalid/i);
    }

    const badDuration = quickPromoteSchema.safeParse({ ...minimal, durationDays: "400" });
    expect(badDuration.success).toBe(false);
    if (!badDuration.success) {
      expect(badDuration.error.issues[0]?.message).toBe("Durasi maksimal 365 hari");
    }
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
