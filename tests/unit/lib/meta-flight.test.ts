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
  const endOf = (input: Parameters<typeof resolveMetaFlightEndTime>[0]) => {
    const r = resolveMetaFlightEndTime(input);
    if (!r.ok) throw new Error(r.message);
    return r.endTime;
  };

  it("the ad set starts when launched (no start_time is sent), so the end is always now + durationDays", () => {
    expect(endOf({ durationDays: 10, now: NOW })).toBe(nowSeconds + 10 * DAY);
  });

  it("start_date is not an input: a future or past start_date cannot move the end", () => {
    // @ts-expect-error startDate is intentionally not part of the contract
    const future = endOf({ startDate: "2027-03-01", durationDays: 7, now: NOW });
    // @ts-expect-error startDate is intentionally not part of the contract
    const past = endOf({ startDate: "2020-01-01", durationDays: 7, now: NOW });
    expect(future).toBe(nowSeconds + 7 * DAY);
    expect(past).toBe(nowSeconds + 7 * DAY);
  });

  it("the run never exceeds durationDays: end - now equals exactly durationDays * 24h (no calendar/time-zone effect)", () => {
    // Around the WIB midnight boundary and a UTC day boundary.
    for (const iso of ["2026-11-10T16:59:59Z", "2026-11-10T17:00:00Z", "2026-12-31T23:59:59Z", "2026-03-29T01:30:00Z"]) {
      const now = new Date(iso);
      expect(endOf({ durationDays: 3, now })).toBe(Math.floor(now.getTime() / 1000) + 3 * DAY);
    }
  });

  it("sub-second clock is floored, so rounding can only end the run earlier", () => {
    const now = new Date("2026-11-11T00:00:00.999Z");
    const end = endOf({ durationDays: 2, now }) as number;
    expect(end * 1000).toBeLessThanOrEqual(now.getTime() + 2 * DAY * 1000);
  });

  it("the minimum accepted duration (2 days) ends more than 24 hours after now (Meta daily-budget rule)", () => {
    expect((endOf({ durationDays: 2, now: NOW }) as number) - nowSeconds).toBeGreaterThan(DAY);
  });

  it("the maximum accepted duration (365 days) is accepted", () => {
    expect(endOf({ durationDays: 365, now: NOW })).toBe(nowSeconds + 365 * DAY);
  });

  it("neither duration nor total_budget: no end_time (ongoing, as before)", () => {
    expect(resolveMetaFlightEndTime({ durationDays: null, now: NOW })).toEqual({ ok: true, endTime: null });
    expect(resolveMetaFlightEndTime({ durationDays: undefined, totalBudget: null, now: NOW })).toEqual({ ok: true, endTime: null });
  });

  it("total_budget without duration fails closed (daily spend could not be bounded)", () => {
    const r = resolveMetaFlightEndTime({ durationDays: null, totalBudget: 1_000_000, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/durasi campaign belum diisi/);
  });

  it.each([1, 0, -3, 1.5, 366, 10_000, Number.NaN, Number.POSITIVE_INFINITY, "7", {}, true])(
    "durationDays %j fails closed (never silently ongoing)",
    (durationDays) => {
      const r = resolveMetaFlightEndTime({ durationDays, now: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/Durasi campaign tidak valid/);
    },
  );

  it("an invalid reference date fails closed and never throws", () => {
    expect(resolveMetaFlightEndTime({ durationDays: 7, now: new Date("nope") }).ok).toBe(false);
  });

  it("returns a safe positive integer of seconds that resolveMetaEndTime accepts", () => {
    const end = endOf({ durationDays: 30, now: NOW });
    expect(Number.isSafeInteger(end)).toBe(true);
    expect(resolveMetaEndTime(end as number)).toEqual({ ok: true, value: end });
  });

  it("budget bound: with the accepted duration, daily x duration <= total_budget is what checkTotalBudgetCoverage enforces together", () => {
    for (const days of [2, 7, 365]) {
      const daily = 100_000;
      expect(endOf({ durationDays: days, totalBudget: daily * days, now: NOW })).not.toBeNull();
      expect(checkTotalBudgetCoverage({ dailyBudget: daily, totalBudget: daily * days, durationDays: days })).toEqual({ ok: true });
      expect(checkTotalBudgetCoverage({ dailyBudget: daily, totalBudget: daily * days - 1, durationDays: days }).ok).toBe(false);
    }
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
