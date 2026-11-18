import { describe, expect, it } from "vitest";
import { evaluateCampaignQuality } from "@/lib/ai/campaign-quality-gate";
import {
  KOPI_ROBUSTA_IMPROVED,
  KOPI_ROBUSTA_SIMULASI,
  KOPI_ROBUSTA_WEAK,
} from "@/tests/fixtures/ai/kopi-robusta-aceh-simulasi";
import { REAL_PRODUCT_FIXTURE } from "@/tests/fixtures/ai/produk-nyata";

const ctx = {
  productName: KOPI_ROBUSTA_SIMULASI.productName,
  knownFacts: KOPI_ROBUSTA_SIMULASI.knownFacts,
  isSimulation: KOPI_ROBUSTA_SIMULASI.isSimulation,
};

describe("rubric regression — scenario A: simulated Kopi Robusta Aceh", () => {
  const weak = evaluateCampaignQuality(KOPI_ROBUSTA_WEAK, ctx);
  const improved = evaluateCampaignQuality(KOPI_ROBUSTA_IMPROVED, ctx);

  it("catches every known failure mode in the weak, template-like proposal", () => {
    expect(weak.status).toBe("FAIL");
    const codes = weak.issues.map((i) => i.code);
    for (const expected of [
      "GUARANTEED_RESULT",
      "FALSE_URGENCY",
      "UNVERIFIED_PROOF",
      "UNSUPPORTED_SPEC",
      "URL_IN_COPY",
      "PHONE_IN_COPY",
      "GENERIC_FILLER",
      "CANDIDATES_TOO_SIMILAR",
      "TRANSACTION_IN_SIMULATION",
      "ALLOCATION_NOT_100",
      "WEAK_HOOK",
      "AUDIENCE_TOO_BROAD",
    ]) {
      expect(codes).toContain(expected);
    }
  });

  it("scores the improved proposal clean and far above the weak one", () => {
    expect(improved.issues).toEqual([]);
    expect(improved.status).toBe("PASS");
    expect(improved.score).toBe(100);
    expect(weak.score).toBeLessThan(60);
    expect(improved.score - weak.score).toBeGreaterThanOrEqual(30);
  });

  it("never lets a FAIL or REVIEW proposal reach a higher score band", () => {
    expect(weak.score).toBeLessThanOrEqual(59);
    const needsReview = evaluateCampaignQuality({ ...KOPI_ROBUSTA_IMPROVED, primary_text: `${KOPI_ROBUSTA_IMPROVED.primary_text} Stok terbatas.` }, ctx);
    expect(needsReview.status).toBe("REVIEW");
    expect(needsReview.score).toBeLessThanOrEqual(89);
  });

  it("does not let a simulated product lead to a transaction, but allows the same copy for a real one", () => {
    const withBuy = { ...KOPI_ROBUSTA_IMPROVED, cta: "Beli sekarang" };
    const sim = evaluateCampaignQuality({ ...withBuy, candidates: [{ ...withBuy.candidates[0], cta: "Beli sekarang" }, withBuy.candidates[1], withBuy.candidates[2]] }, ctx);
    expect(sim.issues.map((i) => i.code)).toContain("TRANSACTION_IN_SIMULATION");
    expect(sim.status).toBe("FAIL");
    const real = evaluateCampaignQuality(
      { ...withBuy, candidates: [{ ...withBuy.candidates[0], cta: "Beli sekarang" }, withBuy.candidates[1], withBuy.candidates[2]] },
      { ...ctx, isSimulation: false },
    );
    expect(real.issues.map((i) => i.code)).not.toContain("TRANSACTION_IN_SIMULATION");
  });

  it("flags a specification that is not in the product facts, and accepts one that is", () => {
    const invented = { ...KOPI_ROBUSTA_IMPROVED, primary_text: `${KOPI_ROBUSTA_IMPROVED.primary_text} Ditanam di ketinggian 1.200 mdpl.` };
    expect(evaluateCampaignQuality(invented, ctx).issues.map((i) => i.code)).toContain("UNSUPPORTED_SPEC");
    const given = evaluateCampaignQuality(KOPI_ROBUSTA_IMPROVED, ctx).issues.filter((i) => i.code === "UNSUPPORTED_SPEC");
    expect(given).toHaveLength(0); // "200 gram" IS in the facts
  });

  it("scores hook strength and audience clarity as their own dimensions", () => {
    const id = (r: typeof weak, d: string) => r.dimensions.find((x) => x.id === d)?.status;
    expect(id(weak, "hook_strength")).not.toBe("PASS");
    expect(id(weak, "audience_fit")).not.toBe("PASS");
    expect(id(improved, "hook_strength")).toBe("PASS");
    expect(id(improved, "audience_fit")).toBe("PASS");
    const vague = evaluateCampaignQuality({ ...KOPI_ROBUSTA_IMPROVED, audience_summary: "Semua orang yang suka minum." }, ctx);
    expect(vague.issues.map((i) => i.code)).toContain("AUDIENCE_TOO_BROAD");
  });

  it("covers every dimension the Founder asked for", () => {
    const ids = improved.dimensions.map((d) => d.id);
    for (const d of ["relevance", "hook_strength", "differentiation", "audience_fit", "cta_strength", "claim_risk"]) {
      expect(ids).toContain(d);
    }
  });

  it("is deterministic across runs (stable regression signal)", () => {
    expect(evaluateCampaignQuality(KOPI_ROBUSTA_WEAK, ctx)).toEqual(weak);
    expect(evaluateCampaignQuality(KOPI_ROBUSTA_IMPROVED, ctx)).toEqual(improved);
  });
});

describe("rubric regression — scenario B: real product", () => {
  it("is not approved yet and carries no invented facts", () => {
    // This guard stops a future edit from "approving" the fixture without data.
    if (REAL_PRODUCT_FIXTURE.approved) {
      expect(REAL_PRODUCT_FIXTURE.product).not.toBeNull();
      expect(REAL_PRODUCT_FIXTURE.source).toBeTruthy();
      expect(REAL_PRODUCT_FIXTURE.approvedBy).toBeTruthy();
    } else {
      expect(REAL_PRODUCT_FIXTURE.product).toBeNull();
    }
  });

  it.skipIf(!REAL_PRODUCT_FIXTURE.approved)("has a stored real-product proposal that scores without a block", () => {
    // Activated once the Founder supplies approved real-product data and a
    // stored proposal for it; intentionally empty until then.
    expect(REAL_PRODUCT_FIXTURE.product).not.toBeNull();
  });
});
