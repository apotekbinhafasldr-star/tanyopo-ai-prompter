import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildCampaignJourney } from "@/lib/campaigns/journey";
import { CampaignJourney } from "@/features/campaigns/campaign-journey";

afterEach(cleanup);

const states = (status: string, hasProposal = true) => buildCampaignJourney(status, hasProposal).steps.map((s) => s.state);

describe("buildCampaignJourney", () => {
  it("DRAFT with a proposal is at Review and nothing is published", () => {
    const j = buildCampaignJourney("DRAFT", true);
    expect(j.currentLabel).toBe("Review");
    expect(j.currentIndex).toBe(3);
    expect(states("DRAFT")).toEqual(["done", "done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(j.nextAction).toContain("Belum ada yang diterbitkan");
  });

  it("DRAFT without a proposal is still at Strategi AI", () => {
    expect(buildCampaignJourney("DRAFT", false).currentLabel).toBe("Strategi AI");
  });

  it("AWAITING_APPROVAL is at Persetujuan", () => {
    expect(buildCampaignJourney("AWAITING_APPROVAL", true).currentLabel).toBe("Persetujuan");
  });

  it("SCHEDULED never shows Eksekusi as done: approved is not launched", () => {
    const j = buildCampaignJourney("SCHEDULED", true);
    expect(j.steps.find((s) => s.id === "execution")?.state).toBe("current");
    expect(j.nextAction).toContain("belum berjalan");
  });

  it("only ACTIVE/COMPLETED mark Eksekusi done", () => {
    for (const status of ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "PAUSED", "FAILED"]) {
      expect(buildCampaignJourney(status, true).steps.find((s) => s.id === "execution")?.state).not.toBe("done");
    }
    expect(buildCampaignJourney("ACTIVE", true).steps.find((s) => s.id === "execution")?.state).toBe("done");
    expect(buildCampaignJourney("COMPLETED", true).steps.every((s) => s.state === "done")).toBe(true);
  });

  it("PAUSED and FAILED flag Eksekusi for attention", () => {
    for (const status of ["PAUSED", "FAILED"]) {
      expect(buildCampaignJourney(status, true).steps.find((s) => s.id === "execution")?.state).toBe("attention");
    }
  });

  it("DRAFT with a proposal but no valid destination asks for the destination first", () => {
    const j = buildCampaignJourney("DRAFT", true, false);
    expect(j.nextAction).toContain("Tentukan tujuan pembelian dulu");
    expect(j.nextAction).toContain("Belum ada yang diterbitkan");
    expect(j.currentLabel).toBe("Review");
  });

  it("a valid or unknown (legacy) destination keeps the original wording", () => {
    for (const d of [true, undefined]) {
      expect(buildCampaignJourney("DRAFT", true, d).nextAction).toContain("Periksa strategi dan teks iklan");
    }
  });

  it("destination only affects DRAFT-with-proposal", () => {
    expect(buildCampaignJourney("AWAITING_APPROVAL", true, false).nextAction).toBe(buildCampaignJourney("AWAITING_APPROVAL", true).nextAction);
    expect(buildCampaignJourney("DRAFT", false, false).nextAction).toBe(buildCampaignJourney("DRAFT", false).nextAction);
  });

  it("an unknown status degrades safely", () => {
    const j = buildCampaignJourney("WHATEVER", true);
    expect(j.steps).toHaveLength(6);
    expect(j.nextAction).toContain("tidak dikenali");
  });
});

describe("CampaignJourney", () => {
  it("renders position, next action, and all six stages as text", () => {
    render(<CampaignJourney status="AWAITING_APPROVAL" hasProposal />);
    expect(screen.getByTestId("journey-position").textContent).toContain("Tahap 4 dari 6");
    expect(screen.getByTestId("journey-position").textContent).toContain("Persetujuan");
    expect(screen.getByTestId("journey-next").textContent).toContain("Menunggu keputusan Owner");
    for (const label of ["Produk", "Strategi AI", "Review", "Persetujuan", "Eksekusi", "Analitik"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("renders the destination-first hint for a DRAFT without a destination", () => {
    render(<CampaignJourney status="DRAFT" hasProposal hasDestination={false} />);
    expect(screen.getByTestId("journey-next").textContent).toContain("Tentukan tujuan pembelian dulu");
  });
});
