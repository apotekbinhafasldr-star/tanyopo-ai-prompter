import { describe, expect, it } from "vitest";
import { calculateSuccessFee } from "@/lib/billing/success-fee";

describe("calculateSuccessFee", () => {
  it("returns NOT_CONFIGURED when no rate has been decided, regardless of verified value", () => {
    const result = calculateSuccessFee({ rateBasisPoints: null, verifiedAttributedValue: 10_000_000 });
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.amount).toBeNull();
  });

  it("calculates the fee as rateBasisPoints/10000 of the verified attributed value", () => {
    // 500 bps = 5%
    const result = calculateSuccessFee({ rateBasisPoints: 500, verifiedAttributedValue: 1_000_000 });
    expect(result.status).toBe("CALCULATED");
    expect(result.amount).toBe(50_000);
  });

  it("returns zero when there is no verified attributed value, even with a rate configured", () => {
    const result = calculateSuccessFee({ rateBasisPoints: 500, verifiedAttributedValue: 0 });
    expect(result.status).toBe("CALCULATED");
    expect(result.amount).toBe(0);
  });

  it("rounds to two decimal places", () => {
    const result = calculateSuccessFee({ rateBasisPoints: 333, verifiedAttributedValue: 1000 });
    // 1000 * 333 / 10000 = 33.3
    expect(result.amount).toBe(33.3);
  });
});
