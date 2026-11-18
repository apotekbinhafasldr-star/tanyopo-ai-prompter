import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { evaluateCampaignQuality } from "@/lib/ai/campaign-quality-gate";
import { KOPI_ROBUSTA_IMPROVED, KOPI_ROBUSTA_SIMULASI, KOPI_ROBUSTA_WEAK } from "@/tests/fixtures/ai/kopi-robusta-aceh-simulasi";
import { EvidenceLabel } from "@/features/campaigns/evidence-label";
import { BUDGET_MISSING_NOTE, EVIDENCE_TEXT, isBudgetMissing } from "@/lib/campaigns/evidence";
import { evaluateLaunchReadiness, type LaunchReadinessInput } from "@/lib/campaigns/launch-readiness";
import { buildCampaignJourney } from "@/lib/campaigns/journey";

afterEach(cleanup);

const ctx = { productName: KOPI_ROBUSTA_SIMULASI.productName, knownFacts: KOPI_ROBUSTA_SIMULASI.knownFacts, isSimulation: true };

describe("Phase B combined (P0-a + P0-b/c + P1)", () => {
  it("rubric covers relevance, hook, differentiation, audience, CTA and fact/claim compliance", () => {
    const ids = evaluateCampaignQuality(KOPI_ROBUSTA_IMPROVED, ctx).dimensions.map((d) => d.id);
    for (const d of ["relevance", "hook_strength", "differentiation", "audience_fit", "cta_strength", "claim_risk"]) expect(ids).toContain(d);
    const weak = evaluateCampaignQuality(KOPI_ROBUSTA_WEAK, ctx);
    expect(weak.status).toBe("FAIL");
    expect(weak.score).toBeLessThanOrEqual(59);
  });

  it("UI separates platform data, AI output, heuristic and system rules with distinct text", () => {
    const labels = new Set<string>();
    for (const k of ["AI", "RULE", "HEURISTIC", "PLATFORM"] as const) {
      cleanup();
      render(<EvidenceLabel kind={k} />);
      labels.add(screen.getByTestId(`evidence-${k.toLowerCase()}`).textContent ?? "");
    }
    expect(labels.size).toBe(4);
    expect(EVIDENCE_TEXT.HEURISTIC.hint).toContain("bukan data dari platform");
  });

  it("a channel split without budget is flagged as proportion, never nominal", () => {
    expect(isBudgetMissing({ daily_budget: null, total_budget: null })).toBe(true);
    expect(BUDGET_MISSING_NOTE).toMatch(/proporsi.*bukan nominal rupiah/);
  });

  it("a campaign without purchase destination is never launch-ready, even if everything else passes", () => {
    const good: LaunchReadinessInput = {
      now: new Date("2026-11-11T00:00:00.000Z"),
      connection: { ok: true, value: { status: "CONNECTED", expiresAt: "2026-12-31T00:00:00.000Z", hasAdAccount: true } },
      adAccountConfirmed: { ok: true, value: true },
      purchaseDestination: true,
      dailyBudget: 100000,
      currency: "IDR",
      approvalPolicy: { ok: true, value: null },
      launchApprovals: { ok: true, value: [{ status: "APPROVED", created_at: "2026-11-10T00:00:00Z" }] },
      budgetWriteEnabled: true,
      emergencyStopActive: false,
      metaReadiness: { ok: true } as unknown as LaunchReadinessInput["metaReadiness"],
    };
    for (const dest of [false, null]) {
      const r = evaluateLaunchReadiness({ ...good, purchaseDestination: dest });
      expect(r.overall).toBe("NOT_READY");
      expect(r.items.find((i) => i.id === "PURCHASE_DESTINATION")?.status).not.toBe("PASS");
    }
    expect(buildCampaignJourney("DRAFT", true, false).nextAction).toContain("Tentukan tujuan pembelian");
  });
});
