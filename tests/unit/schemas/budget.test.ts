import { describe, expect, it } from "vitest";
import { budgetPolicySchema } from "@/schemas/budget";

describe("budgetPolicySchema", () => {
  it("accepts all fields empty (no limits configured)", () => {
    expect(budgetPolicySchema.safeParse({}).success).toBe(true);
  });

  it("coerces numeric strings", () => {
    const result = budgetPolicySchema.safeParse({ dailyLimit: "100000", campaignLimit: "5000000" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dailyLimit).toBe(100000);
      expect(result.data.campaignLimit).toBe(5000000);
    }
  });

  it("rejects a negative limit", () => {
    const result = budgetPolicySchema.safeParse({ dailyLimit: "-100" });
    expect(result.success).toBe(false);
  });
});
