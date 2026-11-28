import { describe, expect, it } from "vitest";
import { buildCampaignReadiness, metaLaunchInputReasons, type ReadinessInput } from "@/lib/campaigns/draft-readiness";

const NOW = new Date("2026-11-28T00:00:00Z");
const GOOD_ROWS = [
  { id: "a", channel: "FACEBOOK" as const, budgetPercentage: 60 },
  { id: "b", channel: "INSTAGRAM" as const, budgetPercentage: 40 },
];

const BASE: ReadinessInput = {
  status: "AWAITING_APPROVAL",
  quality: "PASS",
  destination: "valid",
  hostsConfigured: true,
  channels: ["FACEBOOK", "INSTAGRAM"],
  connectedPlatforms: new Set(["META"]),
  createAdEnabledPlatforms: new Set(["META"]),
  launchMedia: "PLAUSIBLE",
  budgetWriteEnabled: { META: true },
  canRegenerate: false,
};

describe("metaLaunchInputReasons (F-03/F-01: shown before approval, same resolvers as launch)", () => {
  it("is empty when country, run length and split are fine", () => {
    expect(
      metaLaunchInputReasons({ targetCountry: "Indonesia", durationDays: 7, totalBudget: 700000, allocation: GOOD_ROWS }, NOW),
    ).toEqual([]);
  });

  it("reports every problem separately: empty country, 1 day, total budget without duration, bad split", () => {
    const reasons = metaLaunchInputReasons(
      { targetCountry: "", durationDays: 1, totalBudget: null, allocation: [{ id: "a", channel: "FACEBOOK", budgetPercentage: 99.9 }] },
      NOW,
    );
    expect(reasons).toHaveLength(3);
    expect(reasons.join(" ")).toMatch(/Negara/);
    expect(reasons.join(" ")).toMatch(/2 sampai 365/);
    expect(reasons.join(" ")).toMatch(/Alokasi budget channel belum konsisten/);
    expect(
      metaLaunchInputReasons({ targetCountry: "ID", durationDays: null, totalBudget: 500000, allocation: GOOD_ROWS }, NOW).join(" "),
    ).toMatch(/durasi campaign belum diisi/);
  });

  it("a failed read of the channel rows is shown as a problem, never as fine", () => {
    const reasons = metaLaunchInputReasons({ targetCountry: "ID", durationDays: 3, totalBudget: null, allocation: "read_failed" }, NOW);
    expect(reasons.join(" ")).toMatch(/gagal dibaca/);
  });

  it("without launchInputs nothing is added (previous behaviour)", () => {
    expect(metaLaunchInputReasons(undefined, NOW)).toEqual([]);
  });
});

describe("buildCampaignReadiness with launchInputs", () => {
  it("an approved-pending Meta campaign with an empty country is not 'siap' and says why", () => {
    const r = buildCampaignReadiness({
      ...BASE,
      launchInputs: { targetCountry: null, durationDays: 7, totalBudget: null, allocation: GOOD_ROWS },
    });
    expect(r.launch?.ready).toBe(false);
    expect((r.launch?.reasons ?? []).join(" ")).toMatch(/Meta \(Facebook\/Instagram\): Negara target/);
  });

  it("SCHEDULED stays not ready while an input problem exists, and becomes ready when it is fixed", () => {
    const bad = buildCampaignReadiness({
      ...BASE,
      status: "SCHEDULED",
      launchInputs: { targetCountry: "ID", durationDays: 7, totalBudget: null, allocation: [{ id: "a", channel: "FACEBOOK", budgetPercentage: 50 }] },
    });
    expect(bad.launch?.ready).toBe(false);
    const good = buildCampaignReadiness({
      ...BASE,
      status: "SCHEDULED",
      launchInputs: { targetCountry: "ID", durationDays: 7, totalBudget: null, allocation: GOOD_ROWS },
    });
    expect(good.launch?.ready).toBe(true);
  });

  it("a non-Meta campaign does not get Meta input reasons", () => {
    const r = buildCampaignReadiness({
      ...BASE,
      channels: ["TIKTOK"],
      launchInputs: { targetCountry: null, durationDays: 1, totalBudget: null, allocation: "read_failed" },
    });
    expect((r.launch?.reasons ?? []).join(" ")).not.toMatch(/Negara target/);
  });
});
