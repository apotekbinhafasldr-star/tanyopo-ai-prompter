import { describe, expect, it } from "vitest";
import { checkChannelAllocation, normalizeChannelPercentages } from "@/lib/campaigns/channel-allocation";
import { allocateDailyBudget } from "@/lib/campaigns/budget-allocation";

const sum = (m: Map<string, number | null>) =>
  Math.round([...m.values()].reduce<number>((s, v) => s + (v ?? 0), 0) * 100) / 100;

describe("normalizeChannelPercentages (F-01)", () => {
  it("keeps a valid split unchanged", () => {
    const m = normalizeChannelPercentages(["FACEBOOK", "INSTAGRAM"], [
      { channel: "FACEBOOK", percentage: 60 },
      { channel: "INSTAGRAM", percentage: 40 },
    ]);
    expect(m.get("FACEBOOK")).toBe(60);
    expect(m.get("INSTAGRAM")).toBe(40);
  });

  it("33.3 x 3 becomes exactly 100.00", () => {
    const m = normalizeChannelPercentages(["FACEBOOK", "INSTAGRAM", "TIKTOK"], [
      { channel: "FACEBOOK", percentage: 33.3 },
      { channel: "INSTAGRAM", percentage: 33.3 },
      { channel: "TIKTOK", percentage: 33.3 },
    ]);
    expect(sum(m)).toBe(100);
  });

  it("drops channels the user did not select and rescales the rest to 100", () => {
    const m = normalizeChannelPercentages(["FACEBOOK", "INSTAGRAM"], [
      { channel: "FACEBOOK", percentage: 50 },
      { channel: "INSTAGRAM", percentage: 30 },
      { channel: "TIKTOK", percentage: 20 },
    ]);
    expect(m.has("TIKTOK")).toBe(false);
    expect(sum(m)).toBe(100);
    expect(m.get("FACEBOOK")).toBe(62.5);
  });

  it("never invents a share: a selected channel the AI did not allocate stays null", () => {
    const m = normalizeChannelPercentages(["FACEBOOK", "INSTAGRAM"], [{ channel: "FACEBOOK", percentage: 100 }]);
    expect(m.get("INSTAGRAM")).toBeNull();
    expect(m.get("FACEBOOK")).toBe(100);
  });

  it("all null when no selected channel has a positive valid share", () => {
    const m = normalizeChannelPercentages(["FACEBOOK"], [
      { channel: "TIKTOK", percentage: 100 },
      { channel: "FACEBOOK", percentage: Number.NaN },
    ]);
    expect(m.get("FACEBOOK")).toBeNull();
  });

  it("the normalized rows pass the launch allocation (allocateDailyBudget) when every channel was allocated", () => {
    const channels = ["FACEBOOK", "INSTAGRAM", "TIKTOK"] as const;
    const m = normalizeChannelPercentages(channels, [
      { channel: "FACEBOOK", percentage: 33.3 },
      { channel: "INSTAGRAM", percentage: 33.3 },
      { channel: "TIKTOK", percentage: 33.3 },
    ]);
    const rows = channels.map((c, i) => ({ id: `r${i}`, channel: c, budgetPercentage: m.get(c) ?? null }));
    expect(allocateDailyBudget(100000, rows).ok).toBe(true);
  });
});

describe("checkChannelAllocation (same rules as the launch)", () => {
  const row = (id: string, channel: "FACEBOOK" | "INSTAGRAM" | "SEO", budgetPercentage: number | null) => ({ id, channel, budgetPercentage });

  it("accepts rows that add up to 100", () => {
    expect(checkChannelAllocation([row("1", "FACEBOOK", 70), row("2", "INSTAGRAM", 30)])).toEqual({ ok: true });
  });

  it("refuses 99.9, a missing share, a paid channel at 0 and no rows, with a clear message", () => {
    for (const rows of [
      [row("1", "FACEBOOK", 33.3), row("2", "INSTAGRAM", 33.3), row("3", "SEO", 33.3)],
      [row("1", "FACEBOOK", 100), row("2", "INSTAGRAM", null)],
      [row("1", "FACEBOOK", 100), row("2", "INSTAGRAM", 0)],
      [],
    ]) {
      const r = checkChannelAllocation(rows);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Alokasi budget channel belum konsisten/);
    }
  });
});
