import { describe, expect, it } from "vitest";
import { allocateDailyBudget, type AllocationRowInput } from "@/lib/campaigns/budget-allocation";
import type { Channel } from "@/types/database";

const row = (id: string, channel: Channel, budgetPercentage: number | null): AllocationRowInput => ({
  id,
  channel,
  budgetPercentage,
});

function expectOk(result: ReturnType<typeof allocateDailyBudget>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
  return result;
}

describe("allocateDailyBudget", () => {
  it("normalises over paid channels only (SEO takes no share)", () => {
    const r = expectOk(
      allocateDailyBudget(100000, [row("fb", "FACEBOOK", 40), row("tt", "TIKTOK", 30), row("seo", "SEO", 20), row("x", "X", 10)]),
    );
    expect(r.allocations).toEqual({ fb: 50000, tt: 37500, x: 12500 });
    expect(r.allocations.seo).toBeUndefined();
    expect(r.paidTotalPercentage).toBe(80);
  });

  it("gives FB and IG their own shares without duplicating the master budget", () => {
    const r = expectOk(
      allocateDailyBudget(100000, [
        row("fb", "FACEBOOK", 25),
        row("ig", "INSTAGRAM", 15),
        row("tt", "TIKTOK", 30),
        row("seo", "SEO", 20),
        row("x", "X", 10),
      ]),
    );
    expect(r.allocations).toEqual({ fb: 31250, ig: 18750, tt: 37500, x: 12500 });
    expect(r.allocations.fb + r.allocations.ig).toBe(50000);
    expect(Object.values(r.allocations).reduce((a, b) => a + b, 0)).toBe(100000);
  });

  it("uses largest remainder so the paid sum equals the master daily budget exactly", () => {
    const r = expectOk(allocateDailyBudget(33333, [row("fb", "FACEBOOK", 40), row("tt", "TIKTOK", 30), row("x", "X", 10), row("seo", "SEO", 20)]));
    expect(r.allocations).toEqual({ fb: 16666, tt: 12500, x: 4167 });
    expect(Object.values(r.allocations).reduce((a, b) => a + b, 0)).toBe(33333);
  });

  it("is deterministic regardless of row order, ties broken by weight then channel", () => {
    const rows = [row("a", "FACEBOOK", 50), row("b", "TIKTOK", 50)];
    const forward = expectOk(allocateDailyBudget(101, rows));
    const reversed = expectOk(allocateDailyBudget(101, [...rows].reverse()));
    expect(forward.allocations).toEqual(reversed.allocations);
    expect(forward.allocations).toEqual({ a: 51, b: 50 });
  });

  it("allocates the full budget to a single paid channel when others are SEO", () => {
    const r = expectOk(allocateDailyBudget(75000, [row("fb", "FACEBOOK", 60), row("seo", "SEO", 40)]));
    expect(r.allocations).toEqual({ fb: 75000 });
  });

  it.each([null, 0, -5, 1000.5, Number.NaN, Number.POSITIVE_INFINITY])("blocks invalid daily budget %s", (value) => {
    const r = allocateDailyBudget(value as number | null, [row("fb", "FACEBOOK", 100)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DAILY_BUDGET_INVALID");
  });

  it("blocks when there are no channel rows", () => {
    const r = allocateDailyBudget(1000, []);
    expect(r.ok).toBe(false);
  });

  it("blocks an unclassified channel (fail closed)", () => {
    const r = allocateDailyBudget(1000, [row("fb", "FACEBOOK", 50), row("li", "LINKEDIN" as Channel, 50)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CHANNEL_UNCLASSIFIED");
  });

  it.each([null, -1, 100.01, Number.NaN])("blocks invalid percentage %s on any row", (pct) => {
    const r = allocateDailyBudget(100000, [row("fb", "FACEBOOK", 50), row("seo", "SEO", pct as number | null)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PERCENTAGE_INVALID");
  });

  it("blocks the whole master when a paid channel has 0%", () => {
    const r = allocateDailyBudget(100000, [row("fb", "FACEBOOK", 100), row("tt", "TIKTOK", 0)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PAID_PERCENTAGE_ZERO");
  });

  it("allows a non-paid channel at 0% as long as the sum is 100", () => {
    const r = expectOk(allocateDailyBudget(1000, [row("fb", "FACEBOOK", 100), row("seo", "SEO", 0)]));
    expect(r.allocations).toEqual({ fb: 1000 });
  });

  it.each([
    [[50, 40]],
    [[60, 50]],
    [[33.33, 33.33, 33.33]],
  ])("blocks when percentages do not sum to exactly 100.00 (%j)", (pcts) => {
    const channels: Channel[] = ["FACEBOOK", "TIKTOK", "X"];
    const r = allocateDailyBudget(100000, pcts.map((p, i) => row(`r${i}`, channels[i], p)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PERCENTAGE_SUM_INVALID");
  });

  it("accepts percentages that sum to 100.00 with two decimals", () => {
    const r = expectOk(allocateDailyBudget(100000, [row("fb", "FACEBOOK", 33.33), row("tt", "TIKTOK", 33.33), row("x", "X", 33.34)]));
    expect(Object.values(r.allocations).reduce((a, b) => a + b, 0)).toBe(100000);
  });

  it("blocks when there is no paid channel", () => {
    const r = allocateDailyBudget(1000, [row("seo", "SEO", 100)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_PAID_CHANNELS");
  });

  it("blocks the whole master when any paid allocation would be < 1", () => {
    const r = allocateDailyBudget(1, [row("fb", "FACEBOOK", 50), row("tt", "TIKTOK", 50)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALLOCATION_BELOW_MINIMUM");
  });

  it("always sums exactly across many random-ish splits", () => {
    for (const daily of [1000, 7777, 99999, 100001, 1234567]) {
      const r = expectOk(
        allocateDailyBudget(daily, [row("a", "FACEBOOK", 17.5), row("b", "INSTAGRAM", 22.25), row("c", "TIKTOK", 31.1), row("d", "X", 9.15), row("e", "SEO", 20)]),
      );
      expect(Object.values(r.allocations).reduce((x, y) => x + y, 0)).toBe(daily);
    }
  });
});
