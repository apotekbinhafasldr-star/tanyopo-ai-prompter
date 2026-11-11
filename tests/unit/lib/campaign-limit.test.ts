import { describe, expect, it } from "vitest";
import { checkCampaignLimitCoverage } from "@/lib/campaigns/campaign-limit";

const base = { campaignLimit: 1_000_000, dailyBudget: 100_000, totalBudget: null, durationDays: 10 };

describe("checkCampaignLimitCoverage", () => {
  it.each([null, undefined] as unknown[])("limit %s: nothing to enforce", (campaignLimit) => {
    expect(checkCampaignLimitCoverage({ ...base, campaignLimit, durationDays: null })).toEqual({ ok: true });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "1000000", {}] as unknown[])("unreadable limit %j fails closed", (campaignLimit) => {
    const result = checkCampaignLimitCoverage({ ...base, campaignLimit });
    expect(result).toMatchObject({ ok: false, code: "LIMIT_UNREADABLE" });
  });

  it("a total budget is left to Budget Guard (even above the limit here)", () => {
    expect(checkCampaignLimitCoverage({ ...base, totalBudget: 9_000_000, durationDays: null })).toEqual({ ok: true });
  });

  it("no total, projected spend equal to the limit passes", () => {
    expect(checkCampaignLimitCoverage(base)).toEqual({ ok: true });
  });

  it("no total, projected spend above the limit is refused", () => {
    expect(checkCampaignLimitCoverage({ ...base, durationDays: 11 })).toMatchObject({ ok: false, code: "PROJECTED_EXCEEDS_LIMIT" });
  });

  it.each([
    ["no duration", { durationDays: null }],
    ["no daily budget", { dailyBudget: null }],
    ["zero duration", { durationDays: 0 }],
    ["fractional daily budget", { dailyBudget: 100.5 }],
    ["non-number duration", { durationDays: "10" }],
    ["product beyond a safe integer", { dailyBudget: Number.MAX_SAFE_INTEGER, durationDays: 2 }],
  ] as [string, Record<string, unknown>][])("no total and %s: spend cannot be bounded, refused", (_label, patch) => {
    expect(checkCampaignLimitCoverage({ ...base, ...patch })).toMatchObject({ ok: false, code: "SPEND_UNBOUNDED" });
  });

  it("messages never echo a number from the input", () => {
    const result = checkCampaignLimitCoverage({ ...base, campaignLimit: 123_456_789, durationDays: 999 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/123456789|123\.456\.789|999/);
  });
});
