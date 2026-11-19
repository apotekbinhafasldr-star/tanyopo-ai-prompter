import { describe, expect, it } from "vitest";
import {
  CLICK_BASED_ACTIONS,
  OPTIMIZATION_DATA_THRESHOLDS,
  assessDataSufficiency,
  buildInsufficientDataMessage,
  enforceDataThresholds,
  isActionAllowedByData,
  summarizeChannelMetrics,
} from "@/lib/campaigns/optimization-data-sufficiency";

describe("proposed thresholds (UNVERIFIED: usulan, belum divalidasi)", () => {
  it("are the proposed starting values, named and frozen", () => {
    expect(OPTIMIZATION_DATA_THRESHOLDS).toEqual({ minDays: 3, minImpressions: 1000, minClicksForClickBasedActions: 100 });
    expect(Object.isFrozen(OPTIMIZATION_DATA_THRESHOLDS)).toBe(true);
    expect(CLICK_BASED_ACTIONS).toContain("INCREASE_BUDGET");
  });
});

describe("summarizeChannelMetrics: rates are computed in code", () => {
  it("sums rows, counts distinct delivery days, and derives CTR and CPC", () => {
    const s = summarizeChannelMetrics([
      { spend: 100, impressions: 1000, clicks: 25, reach: 800, date: "2026-10-01" },
      { spend: 50, impressions: 1000, clicks: 15, reach: 700, date: "2026-10-02" },
      { spend: 0, impressions: 0, clicks: 0, reach: 0, date: "2026-10-03" },
    ]);
    expect(s).toEqual({ spend: 150, impressions: 2000, clicks: 40, reach: 1500, days: 2, ctrPercent: 2, cpc: 3.75 });
  });

  it("returns null rates (never a made-up number) when there are no impressions or no clicks", () => {
    expect(summarizeChannelMetrics([])).toMatchObject({ impressions: 0, clicks: 0, days: 0, ctrPercent: null, cpc: null });
    expect(summarizeChannelMetrics([{ spend: 10, impressions: 500, clicks: 0, date: "2026-10-01" }])).toMatchObject({ ctrPercent: 0, cpc: null });
  });

  it("treats missing, null, negative or non-finite values as zero and ignores rows without a date for the day count", () => {
    const s = summarizeChannelMetrics([
      { spend: null, impressions: 1000, clicks: undefined, reach: -5, date: null },
      { spend: Number.NaN, impressions: Number.POSITIVE_INFINITY, clicks: 3, date: "2026-10-01" },
    ]);
    expect(s).toMatchObject({ spend: 0, impressions: 1000, clicks: 3, reach: 0, days: 0 });
  });

  it("counts the same date twice only once", () => {
    const s = summarizeChannelMetrics([
      { impressions: 600, date: "2026-10-01" },
      { impressions: 600, date: "2026-10-01" },
    ]);
    expect(s.days).toBe(1);
  });
});

describe("assessDataSufficiency", () => {
  const summary = (over: Partial<ReturnType<typeof summarizeChannelMetrics>>) => ({
    spend: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    days: 0,
    ctrPercent: null,
    cpc: null,
    ...over,
  });

  it("is enough only at the thresholds, and says what is missing in Indonesian", () => {
    expect(assessDataSufficiency(summary({ days: 3, impressions: 1000, clicks: 100 }))).toEqual({ enough: true, clickBasedOk: true, shortfalls: [] });
    const short = assessDataSufficiency(summary({ days: 2, impressions: 999, clicks: 500 }));
    expect(short.enough).toBe(false);
    expect(short.clickBasedOk).toBe(false);
    expect(short.shortfalls).toEqual(["2 dari minimal 3 hari data", "999 dari minimal 1000 impresi"]);
  });

  it("enough data but too few clicks: analysable, but click-based actions are not allowed", () => {
    const r = assessDataSufficiency(summary({ days: 5, impressions: 8000, clicks: 99 }));
    expect(r.enough).toBe(true);
    expect(r.clickBasedOk).toBe(false);
    expect(r.shortfalls).toEqual(["99 dari minimal 100 klik (untuk aksi berbasis klik)"]);
    expect(isActionAllowedByData("INCREASE_BUDGET", r)).toBe(false);
    expect(isActionAllowedByData("DECREASE_BUDGET", r)).toBe(true);
    expect(isActionAllowedByData("PAUSE_CHANNEL", r)).toBe(true);
    expect(isActionAllowedByData("NO_ACTION", r)).toBe(true);
  });

  it("the thresholds are parameters, not hidden constants", () => {
    const loose = { minDays: 1, minImpressions: 10, minClicksForClickBasedActions: 1 };
    expect(assessDataSufficiency(summary({ days: 1, impressions: 10, clicks: 1 }), loose).clickBasedOk).toBe(true);
  });
});

describe("enforceDataThresholds", () => {
  const rec = (channel: string, action_type: string) => ({
    channel,
    action_type,
    rationale: "Alasan model.",
    suggested_daily_budget: action_type === "INCREASE_BUDGET" ? 200000 : null,
    risk_level: "LOW",
  });
  const ok = { enough: true, clickBasedOk: true, shortfalls: [] as string[] };
  const noClicks = { enough: true, clickBasedOk: false, shortfalls: ["x"] };
  const thin = { enough: false, clickBasedOk: false, shortfalls: ["x"] };

  it("turns INCREASE_BUDGET into NO_ACTION (budget cleared, reason appended) below the thresholds and leaves everything else", () => {
    const out = enforceDataThresholds(
      [rec("FACEBOOK", "INCREASE_BUDGET"), rec("INSTAGRAM", "INCREASE_BUDGET"), rec("TIKTOK", "INCREASE_BUDGET"), rec("X", "DECREASE_BUDGET")],
      new Map([
        ["FACEBOOK", ok],
        ["INSTAGRAM", noClicks],
        ["TIKTOK", thin],
        ["X", thin],
      ]),
    );
    expect(out[0]).toMatchObject({ action_type: "INCREASE_BUDGET", suggested_daily_budget: 200000 });
    for (const i of [1, 2]) {
      expect(out[i].action_type).toBe("NO_ACTION");
      expect(out[i].suggested_daily_budget).toBeNull();
      expect(out[i].rationale).toContain("Alasan model.");
      expect(out[i].rationale).toMatch(/usulan, belum divalidasi/);
      expect(out[i].risk_level).toBe("LOW");
    }
    expect(out[3].action_type).toBe("DECREASE_BUDGET");
  });

  it("a channel with no data entry at all is not allowed INCREASE_BUDGET", () => {
    const out = enforceDataThresholds([rec("FACEBOOK", "INCREASE_BUDGET")], new Map());
    expect(out[0].action_type).toBe("NO_ACTION");
  });

  it("does not mutate its input", () => {
    const input = [rec("FACEBOOK", "INCREASE_BUDGET")];
    const snapshot = JSON.stringify(input);
    enforceDataThresholds(input, new Map([["FACEBOOK", thin]]));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("buildInsufficientDataMessage", () => {
  it("states the proposed thresholds, the per-channel gap and that no AI quota was used", () => {
    const msg = buildInsufficientDataMessage([
      {
        channel: "FACEBOOK",
        summary: summarizeChannelMetrics([]),
        sufficiency: { enough: false, clickBasedOk: false, shortfalls: ["0 dari minimal 3 hari data"] },
      },
    ]);
    expect(msg).toMatch(/^Data belum cukup/);
    expect(msg).toContain("FACEBOOK: 0 dari minimal 3 hari data");
    expect(msg).toMatch(/usulan, belum divalidasi/);
    expect(msg).toMatch(/Tidak ada kuota AI yang dipakai/);
  });
});
