import { describe, expect, it } from "vitest";
import { manualConversionSchema } from "@/schemas/conversion";

describe("manualConversionSchema", () => {
  const valid = {
    campaignId: "550e8400-e29b-41d4-a716-446655440000",
    eventType: "PURCHASE",
    value: "150000",
    customerReference: "081234567890",
    occurredAt: "",
  };

  it("accepts a valid manual conversion", () => {
    expect(manualConversionSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an empty campaignId (not tied to a campaign)", () => {
    const result = manualConversionSchema.safeParse({ ...valid, campaignId: "" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown event type", () => {
    const result = manualConversionSchema.safeParse({ ...valid, eventType: "REFUND" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative value", () => {
    const result = manualConversionSchema.safeParse({ ...valid, value: "-1" });
    expect(result.success).toBe(false);
  });
});
