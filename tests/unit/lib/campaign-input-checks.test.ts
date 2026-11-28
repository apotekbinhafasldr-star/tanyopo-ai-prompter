import { describe, expect, it } from "vitest";
import { checkCampaignCountry, checkCampaignFlight, mayLaunchOnMeta } from "@/lib/campaigns/campaign-input-checks";

const NOW = new Date("2026-11-28T00:00:00Z");

describe("checkCampaignCountry (F-03)", () => {
  it("refuses an empty country when a budget is entered (paid intent), never defaults", () => {
    for (const country of ["", "   ", null, undefined]) {
      const r = checkCampaignCountry({ country, paidIntent: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/Negara target wajib diisi/);
    }
  });

  it("allows an empty country for a strategy without budget", () => {
    expect(checkCampaignCountry({ country: "", paidIntent: false })).toEqual({ ok: true });
  });

  it("accepts a name or an ISO alpha-2 code and refuses an unknown value", () => {
    expect(checkCampaignCountry({ country: "Indonesia", paidIntent: true })).toEqual({ ok: true });
    expect(checkCampaignCountry({ country: "id", paidIntent: true })).toEqual({ ok: true });
    expect(checkCampaignCountry({ country: "Negeri Antah Berantah", paidIntent: false }).ok).toBe(false);
    expect(checkCampaignCountry({ country: "ZZ", paidIntent: true }).ok).toBe(false);
  });
});

describe("checkCampaignFlight (Meta: daily_budget needs duration > 24 h; lifetime/total needs an end)", () => {
  it("refuses 1 day for a Meta channel and for an undecided (AI-picked) channel list", () => {
    for (const channels of [["FACEBOOK"], ["INSTAGRAM", "SEO"], [], undefined]) {
      const r = checkCampaignFlight({ channels, durationDays: 1, totalBudget: null, now: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/2 sampai 365/);
    }
  });

  it("refuses a total budget without a duration for Meta", () => {
    const r = checkCampaignFlight({ channels: ["FACEBOOK"], durationDays: undefined, totalBudget: 500000, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Budget total memerlukan durasi/);
  });

  it("accepts 2 days, and no duration without a total budget", () => {
    expect(checkCampaignFlight({ channels: ["FACEBOOK"], durationDays: 2, totalBudget: 500000, now: NOW })).toEqual({ ok: true });
    expect(checkCampaignFlight({ channels: ["FACEBOOK"], durationDays: undefined, totalBudget: null, now: NOW })).toEqual({ ok: true });
  });

  it("does not apply the Meta rule to non-Meta channels", () => {
    expect(checkCampaignFlight({ channels: ["TIKTOK", "X"], durationDays: 1, totalBudget: 1000, now: NOW })).toEqual({ ok: true });
  });

  it("mayLaunchOnMeta", () => {
    expect(mayLaunchOnMeta(["TIKTOK"])).toBe(false);
    expect(mayLaunchOnMeta(["FACEBOOK"])).toBe(true);
    expect(mayLaunchOnMeta([])).toBe(true);
  });
});
