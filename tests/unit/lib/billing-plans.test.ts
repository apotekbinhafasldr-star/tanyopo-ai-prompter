import { describe, expect, it } from "vitest";
import { PLAN_TIERS, FEATURE_CATEGORIES, findPlanTier, type PlanTierId } from "@/lib/billing/plans";

describe("PLAN_TIERS — LINOE Pricing v1.0 (Batch B8)", () => {
  it("lists exactly the six public tiers, in ascending price order", () => {
    const ids = PLAN_TIERS.map((t) => t.id);
    expect(ids).toEqual(["FREE", "STARTER", "GROWTH", "PRO", "BUSINESS", "AGENCY"]);
  });

  it("never includes UMKMPRO_BUNDLE — that's a separate special bundle, not part of the public pricing page", () => {
    const ids = PLAN_TIERS.map((t) => t.id) as string[];
    expect(ids).not.toContain("UMKMPRO_BUNDLE");
  });

  it("prices strictly increase from Free through Business", () => {
    const activeOrdered = PLAN_TIERS.filter((t) => t.id !== "AGENCY");
    for (let i = 1; i < activeOrdered.length; i++) {
      expect(activeOrdered[i].priceIDR).toBeGreaterThan(activeOrdered[i - 1].priceIDR);
    }
  });

  it("Free Trial is priced at 0 (never invents a hidden fee)", () => {
    expect(findPlanTier("FREE")?.priceIDR).toBe(0);
  });

  it("only Growth carries the 'PALING POPULER' badge", () => {
    const badged = PLAN_TIERS.filter((t) => t.badge);
    expect(badged).toHaveLength(1);
    expect(badged[0].id).toBe("GROWTH");
  });

  it("only Agency is COMING_SOON — every other tier is sellable as an active plan today", () => {
    const comingSoon = PLAN_TIERS.filter((t) => t.availability === "COMING_SOON");
    expect(comingSoon).toHaveLength(1);
    expect(comingSoon[0].id).toBe("AGENCY");
  });

  it("Agency's price is marked as a target, never presented as a live rate", () => {
    expect(findPlanTier("AGENCY")?.isPriceTarget).toBe(true);
  });

  it("Agency never fabricates an exact product/campaign cap the brief didn't give — null, not an invented number", () => {
    const agency = findPlanTier("AGENCY");
    expect(agency?.limits.maxActiveProducts).toBeNull();
    expect(agency?.limits.maxActiveCampaigns).toBeNull();
    expect(agency?.limits.maxUsers).toBe(20);
  });

  it("every tier declares a positive AI usage allowance and every other numeric limit is a positive number or null", () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.limits.aiUsageAllowance).toBeGreaterThan(0);
      for (const key of ["maxActiveProducts", "maxActiveCampaigns", "maxUsers"] as const) {
        const value = tier.limits[key];
        if (value !== null) expect(value).toBeGreaterThan(0);
      }
    }
  });

  it("findPlanTier resolves every PlanTierId and returns undefined for UMKMPRO_BUNDLE", () => {
    const ids: PlanTierId[] = ["FREE", "STARTER", "GROWTH", "PRO", "BUSINESS", "AGENCY"];
    for (const id of ids) {
      expect(findPlanTier(id)?.id).toBe(id);
    }
    expect(findPlanTier("UMKMPRO_BUNDLE")).toBeUndefined();
  });
});

describe("FEATURE_CATEGORIES — Batch B8 feature comparison", () => {
  const EXPECTED_CATEGORIES = [
    "AI Marketing",
    "Produk",
    "Campaign",
    "Content",
    "Scheduling",
    "SEO & Discovery",
    "Growth",
    "Analytics",
    "Team",
    "Automation",
    "Creative",
    "Support",
  ];

  it("covers exactly the categories named in the B8 brief, with no duplicates", () => {
    const categories = FEATURE_CATEGORIES.map((c) => c.category);
    expect(new Set(categories).size).toBe(categories.length);
    expect(categories.sort()).toEqual([...EXPECTED_CATEGORIES].sort());
  });

  it("never marks a category AVAILABLE unless it's genuinely shipped and ungated today (Team/Support are COMING_SOON — no invite flow or support-tier exists)", () => {
    const team = FEATURE_CATEGORIES.find((c) => c.category === "Team");
    const support = FEATURE_CATEGORIES.find((c) => c.category === "Support");
    expect(team?.status).toBe("COMING_SOON");
    expect(support?.status).toBe("COMING_SOON");
  });

  it("marks the actually-shipped feature areas AVAILABLE (audited: none of these are gated by plan in code)", () => {
    for (const category of ["AI Marketing", "Content", "Scheduling", "SEO & Discovery", "Growth", "Analytics", "Creative"]) {
      expect(FEATURE_CATEGORIES.find((c) => c.category === category)?.status).toBe("AVAILABLE");
    }
  });
});
