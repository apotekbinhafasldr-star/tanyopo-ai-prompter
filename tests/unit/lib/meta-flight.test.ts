import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { checkTotalBudgetCoverage, resolveMetaFlightEndTime } from "@/lib/campaigns/meta-flight";
import { resolveMetaEndTime } from "@/lib/connectors/meta-connector-contract";

describe("checkTotalBudgetCoverage", () => {
  it("ok when daily x duration is within the total budget", () => {
    expect(checkTotalBudgetCoverage({ dailyBudget: 100_000, totalBudget: 1_000_000, durationDays: 10 })).toEqual({ ok: true });
  });

  it("ok when daily x duration equals the total budget exactly", () => {
    expect(checkTotalBudgetCoverage({ dailyBudget: 100_000, totalBudget: 700_000, durationDays: 7 })).toEqual({ ok: true });
  });

  it("refused when daily x duration is above the total budget, with our own message", () => {
    const result = checkTotalBudgetCoverage({ dailyBudget: 100_000, totalBudget: 699_999, durationDays: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/melebihi budget total/);
      expect(result.message).not.toContain("699999");
    }
  });

  it.each([
    ["no total budget", { dailyBudget: 100_000, totalBudget: null, durationDays: 7 }],
    ["no duration", { dailyBudget: 100_000, totalBudget: 1, durationDays: null }],
    ["no daily budget", { dailyBudget: null, totalBudget: 1, durationDays: 7 }],
    ["everything undefined", { dailyBudget: undefined, totalBudget: undefined, durationDays: undefined }],
  ])("nothing to compare (%s): ok, behaves as before", (_label, input) => {
    expect(checkTotalBudgetCoverage(input)).toEqual({ ok: true });
  });

  it.each([
    ["zero total", { dailyBudget: 1, totalBudget: 0, durationDays: 1 }],
    ["fractional duration", { dailyBudget: 1, totalBudget: 10, durationDays: 1.5 }],
    ["negative daily", { dailyBudget: -5, totalBudget: 10, durationDays: 1 }],
    ["string total", { dailyBudget: 1, totalBudget: "10", durationDays: 1 }],
    ["NaN daily", { dailyBudget: Number.NaN, totalBudget: 10, durationDays: 1 }],
  ])("a set but invalid value (%s) fails closed", (_label, input) => {
    const result = checkTotalBudgetCoverage(input);
    expect(result.ok).toBe(false);
  });

  it("an overflowing product fails closed", () => {
    const result = checkTotalBudgetCoverage({ dailyBudget: 2 ** 52, totalBudget: 2 ** 53 - 1, durationDays: 365 });
    expect(result.ok).toBe(false);
  });
});

describe("resolveMetaFlightEndTime", () => {
  const NOW = new Date("2026-11-11T00:00:00Z");
  const DAY = 86_400;
  const nowSeconds = NOW.getTime() / 1000;

  it("future start_date: the run starts at 00:00 WIB of that date and lasts durationDays", () => {
    const start = Date.parse("2026-12-01T00:00:00+07:00") / 1000;
    expect(resolveMetaFlightEndTime({ startDate: "2026-12-01", durationDays: 10, now: NOW })).toBe(start + 10 * DAY);
  });

  it("past start_date: the run is counted from now, never from the past", () => {
    expect(resolveMetaFlightEndTime({ startDate: "2026-01-01", durationDays: 7, now: NOW })).toBe(nowSeconds + 7 * DAY);
  });

  it("no start_date: counted from now", () => {
    expect(resolveMetaFlightEndTime({ startDate: null, durationDays: 3, now: NOW })).toBe(nowSeconds + 3 * DAY);
    expect(resolveMetaFlightEndTime({ startDate: undefined, durationDays: 3, now: NOW })).toBe(nowSeconds + 3 * DAY);
  });

  it("the end is always strictly after now by more than 24 hours", () => {
    const end = resolveMetaFlightEndTime({ startDate: null, durationDays: 2, now: NOW });
    expect(end).not.toBeNull();
    expect((end as number) - nowSeconds).toBeGreaterThan(DAY);
  });

  it.each([null, undefined, 0, 1, -3, 1.5, 366, Number.NaN, "7"])("durationDays %j gives no end_time (ongoing, as before)", (durationDays) => {
    expect(resolveMetaFlightEndTime({ startDate: null, durationDays, now: NOW })).toBeNull();
  });

  it.each(["2026-13-45", "01/12/2026", "2026-12-01T00:00:00Z", " 2026-12-01", 20261201, {}])(
    "an unreadable start_date %j gives no end_time",
    (startDate) => {
      expect(resolveMetaFlightEndTime({ startDate, durationDays: 7, now: NOW })).toBeNull();
    },
  );

  it("an invalid reference date gives no end_time and never throws", () => {
    expect(resolveMetaFlightEndTime({ startDate: null, durationDays: 7, now: new Date("nope") })).toBeNull();
  });

  it("returns a safe positive integer of seconds that resolveMetaEndTime accepts", () => {
    const end = resolveMetaFlightEndTime({ startDate: "2026-12-01", durationDays: 30, now: NOW });
    expect(Number.isSafeInteger(end)).toBe(true);
    expect(resolveMetaEndTime(end)).toEqual({ ok: true, value: end });
  });
});

describe("resolveMetaEndTime (connector contract)", () => {
  it("absent -> nothing is added", () => {
    expect(resolveMetaEndTime(undefined)).toEqual({ ok: true, value: null });
  });

  it("a positive safe integer passes through", () => {
    expect(resolveMetaEndTime(1_800_000_000)).toEqual({ ok: true, value: 1_800_000_000 });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1800000000", null, {}, 2 ** 60])(
    "%j is refused (0 is Meta's 'ongoing' sentinel and is never sent)",
    (value) => {
      expect(resolveMetaEndTime(value)).toEqual({ ok: false });
    },
  );
});

describe("meta-flight module is pure and opens nothing", () => {
  it("has no imports, network, database, environment or gate access", () => {
    const src = readFileSync("lib/campaigns/meta-flight.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.match(/^import .*$/gm)).toBeNull();
    expect(code).not.toMatch(/supabase|process\.env|fetch\(|server-only|graph\.facebook|BUDGET_WRITE_ENABLED_PLATFORMS|connector/i);
  });
});
