import { describe, expect, it } from "vitest";
import { computeProfitEstimate } from "@/lib/profit-estimate";

describe("computeProfitEstimate", () => {
  it("computes net profit when hpp is set", () => {
    const result = computeProfitEstimate({ revenue: 1_000_000, adSpend: 100_000, hpp: 200_000, unitsSold: 3 });
    // cogs = 200_000 * 3 = 600_000
    expect(result.cogs).toBe(600_000);
    expect(result.netProfit).toBe(1_000_000 - 600_000 - 100_000);
  });

  it("returns null cogs and netProfit when hpp is not set, rather than assuming zero cost", () => {
    const result = computeProfitEstimate({ revenue: 1_000_000, adSpend: 100_000, hpp: null, unitsSold: 3 });
    expect(result.cogs).toBeNull();
    expect(result.netProfit).toBeNull();
    expect(result.revenue).toBe(1_000_000);
    expect(result.adSpend).toBe(100_000);
  });

  it("handles zero units sold", () => {
    const result = computeProfitEstimate({ revenue: 0, adSpend: 50_000, hpp: 10_000, unitsSold: 0 });
    expect(result.cogs).toBe(0);
    expect(result.netProfit).toBe(-50_000);
  });

  it("can produce a negative net profit", () => {
    const result = computeProfitEstimate({ revenue: 100_000, adSpend: 200_000, hpp: 50_000, unitsSold: 1 });
    expect(result.netProfit).toBe(100_000 - 50_000 - 200_000);
    expect(result.netProfit).toBeLessThan(0);
  });
});
