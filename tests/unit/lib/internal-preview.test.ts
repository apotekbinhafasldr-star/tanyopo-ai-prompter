import { describe, expect, it } from "vitest";
import { buildInternalPreview, type InternalPreviewInput } from "@/lib/campaigns/internal-preview";

const BASE: InternalPreviewInput = {
  aiProposal: {
    positioning: " Premium lokal ",
    marketing_angle: "Hemat waktu",
    value_proposition: "Praktis",
    customer_pain: "Repot",
    audience_summary: "Ibu rumah tangga",
    headline: "Judul",
    hook: "Hook",
    primary_text: "Teks",
    cta: "Beli",
    creative_concept: "Foto produk",
    budget_allocation: [
      { channel: "FACEBOOK", percentage: 30 },
      { channel: "INSTAGRAM", percentage: 20 },
      { channel: "TIKTOK", percentage: 50 },
    ],
  },
  audienceNotes: "  ",
  targetCity: "Bandung",
  targetRegion: null,
  targetCountry: "ID",
  targetLanguage: "id",
  dailyBudget: 100000,
  totalBudget: 700000,
  currency: "IDR",
  durationDays: 7,
  channelShares: [],
};

describe("buildInternalPreview", () => {
  it("summarises strategy, creative, audience and budget with trimming", () => {
    const p = buildInternalPreview(BASE);
    expect(p.hasProposal).toBe(true);
    expect(p.strategy.positioning).toBe("Premium lokal");
    expect(p.creative.cta).toBe("Beli");
    expect(p.audience.notes).toBeNull();
    expect(p.audience.location).toBe("Bandung, ID");
    expect(p.audience.language).toBe("Indonesia");
  });

  it("estimates only COST from the budget (Meta share x duration)", () => {
    const p = buildInternalPreview(BASE);
    expect(p.budget.metaSharePercent).toBe(50);
    expect(p.budget.metaDailyAmount).toBe(50000);
    expect(p.estimate.metaCostForDuration).toBe(350000);
    expect(JSON.stringify(p)).not.toMatch(/reach|jangkauan|konversi|conversion/i);
  });

  it("prefers stored channel rows over the proposal", () => {
    const p = buildInternalPreview({
      ...BASE,
      channelShares: [
        { channel: "FACEBOOK", percentage: 40 },
        { channel: "TIKTOK", percentage: 60 },
      ],
    });
    expect(p.budget.metaSharePercent).toBe(40);
    expect(p.budget.metaDailyAmount).toBe(40000);
  });

  it("is fail-closed on bad data: no estimate rather than a guess", () => {
    expect(buildInternalPreview({ ...BASE, channelShares: [{ channel: "FACEBOOK", percentage: null }] }).budget.metaSharePercent).toBeNull();
    expect(buildInternalPreview({ ...BASE, channelShares: [{ channel: "FACEBOOK", percentage: 150 }] }).budget.metaSharePercent).toBeNull();
    expect(buildInternalPreview({ ...BASE, dailyBudget: null }).estimate.metaCostForDuration).toBeNull();
    expect(buildInternalPreview({ ...BASE, dailyBudget: 1.5 }).budget.dailyBudget).toBeNull();
    expect(buildInternalPreview({ ...BASE, durationDays: null }).estimate.metaCostForDuration).toBeNull();
    expect(buildInternalPreview({ ...BASE, durationDays: 0 }).estimate.durationDays).toBeNull();
    expect(
      buildInternalPreview({ ...BASE, aiProposal: { budget_allocation: [{ channel: "FACEBOOK", percentage: "x" }] } }).budget.metaSharePercent,
    ).toBeNull();
  });

  it("no Meta channel => no share and no estimate", () => {
    const p = buildInternalPreview({ ...BASE, aiProposal: { budget_allocation: [{ channel: "TIKTOK", percentage: 100 }] } });
    expect(p.budget.metaSharePercent).toBeNull();
    expect(p.estimate.metaCostForDuration).toBeNull();
  });

  it("tolerates a missing or malformed proposal", () => {
    for (const bad of [null, undefined, "x", 5, [], { headline: 3 }]) {
      const p = buildInternalPreview({ ...BASE, aiProposal: bad });
      expect(p.creative.headline).toBeNull();
    }
    expect(buildInternalPreview({ ...BASE, aiProposal: null }).hasProposal).toBe(false);
  });
});
