import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { describeAiProvenance } from "@/lib/ai/provenance";
import { evaluateCampaignQuality } from "@/lib/ai/campaign-quality-gate";
import { AiQualityCard } from "@/features/campaigns/ai-quality-card";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";

afterEach(cleanup);

describe("describeAiProvenance", () => {
  it("reports a real model with provider and model from the recorded job", () => {
    const p = describeAiProvenance({ status: "COMPLETED", provider: "openai", model: "gpt-5.4-mini-2026-03-17", fallback_provider: null });
    expect(p.kind).toBe("MODEL");
    expect(p.label).toBe("Dibuat oleh model AI: OpenAI");
    expect(p.detail).toContain("gpt-5.4-mini-2026-03-17");
    expect(p.detail).toContain("bukan template");
  });

  it("labels a backup provider honestly, naming the one that failed", () => {
    const p = describeAiProvenance({ status: "COMPLETED", provider: "anthropic", model: "claude-opus-5", fallback_provider: "openai" });
    expect(p.kind).toBe("FALLBACK_PROVIDER");
    expect(p.label).toContain("cadangan");
    expect(p.detail).toContain("OpenAI");
    expect(p.detail).toContain("Anthropic");
  });

  it("never claims an AI origin when the job row is missing or incomplete", () => {
    for (const job of [null, undefined, { status: "FAILED", provider: "openai", model: "m", fallback_provider: null }, { status: "COMPLETED", provider: null, model: null, fallback_provider: null }]) {
      const p = describeAiProvenance(job);
      expect(p.kind).toBe("UNKNOWN");
      expect(p.label).not.toMatch(/dibuat oleh model/i);
    }
  });
});

describe("AiQualityCard", () => {
  const proposal = {
    customer_pain: "Sulit menemukan kopi yang tidak terlalu asam untuk dinikmati di rumah.",
    desired_outcome: "x",
    value_proposition: "Kopi Arabika Gayo sangrai medium dengan rasa halus.",
    positioning: "Kopi Gayo.",
    audience_summary: "x",
    marketing_angle: "x",
    candidates: [0, 1, 2].map((i) => ({
      hook: ["Kopi pagi tanpa perih", "Seduh di rumah seperti kedai", "Hadiah kecil penyuka kopi"][i],
      headline: "Kopi Arabika Gayo",
      cta: "Pesan sekarang",
      primary_text: `Kopi Arabika Gayo sangrai medium nomor ${i} dengan rasa halus untuk pagi yang nyaman di rumah. Dijamin laris.`,
      rationale: "x",
    })),
    hook: "a",
    headline: "b",
    primary_text: "Kopi Arabika Gayo sangrai medium dengan rasa halus untuk pagi yang nyaman di rumah.",
    cta: "Pesan sekarang",
    creative_concept: "x",
    budget_allocation: [{ channel: "INSTAGRAM", percentage: 100, reason: "x" }],
    excluded_channels: [],
    recommended_channels: ["INSTAGRAM"],
  } as unknown as CampaignProposal;

  it("shows provenance, the overall status, the issues and the honest disclaimer", () => {
    const quality = evaluateCampaignQuality(proposal, { productName: "Kopi Arabika Gayo" });
    render(<AiQualityCard provenance={describeAiProvenance({ status: "COMPLETED", provider: "openai", model: "gpt-5.4-mini", fallback_provider: null })} quality={quality} />);
    expect(screen.getByTestId("ai-provenance").textContent).toContain("Dibuat oleh model AI: OpenAI");
    expect(screen.getByTestId("ai-quality-status").textContent).toBe("Perbaiki sebelum diterbitkan");
    expect(screen.getByTestId("ai-quality-issues").textContent).toContain("Menjanjikan hasil pasti");
    expect(screen.getByText(/bukan jaminan kepatuhan/i)).toBeTruthy();
  });

  it("shows the rule score next to the status and keeps it within 0-100", () => {
    const quality = evaluateCampaignQuality(proposal, { productName: "Kopi Arabika Gayo" });
    render(<AiQualityCard provenance={describeAiProvenance(null)} quality={quality} />);
    const text = screen.getByTestId("ai-quality-score").textContent ?? "";
    expect(text).toBe(`Skor aturan ${quality.score}/100`);
    expect(quality.score).toBeGreaterThanOrEqual(0);
    expect(quality.score).toBeLessThanOrEqual(59); // proposal has a blocking promise
  });

  it("shows UNKNOWN origin without claiming a model made it", () => {
    const quality = evaluateCampaignQuality(proposal, {});
    render(<AiQualityCard provenance={describeAiProvenance(null)} quality={quality} />);
    expect(screen.getByTestId("ai-provenance").textContent).toBe("Asal AI tidak tercatat");
  });
});
