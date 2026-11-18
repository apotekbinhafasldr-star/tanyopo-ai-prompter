import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DraftReadinessBanner } from "@/features/campaigns/draft-readiness-banner";
import { ChannelInfoChecklist } from "@/features/campaigns/channel-info-checklist";
import { QualityUnavailableCard } from "@/features/campaigns/ai-quality-card";
import { buildCampaignReadiness, type ReadinessInput } from "@/lib/campaigns/draft-readiness";

afterEach(cleanup);

const BASE: ReadinessInput = {
  status: "DRAFT",
  quality: "PASS",
  destination: "valid",
  channels: ["TIKTOK", "X"],
  connectedPlatforms: new Set(),
  createAdEnabledPlatforms: new Set(),
  launchMedia: "NO_IMAGE",
  budgetWriteEnabled: {},
  canRegenerate: true,
};

describe("DraftReadinessBanner", () => {
  it("ready draft: says ready to REVIEW, and separately 'Belum siap tayang' with reasons", () => {
    render(<DraftReadinessBanner readiness={buildCampaignReadiness(BASE)} />);
    expect(screen.getByTestId("readiness-primary").textContent).toContain("Draft siap ditinjau");
    expect(screen.getByTestId("readiness-launch-label").textContent).toBe("Belum siap tayang");
    expect(screen.getByText(/Lihat alasan/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Semua sudah siap|🚀/);
  });

  it("REVIEW shows the Owner-check note", () => {
    render(<DraftReadinessBanner readiness={buildCampaignReadiness({ ...BASE, quality: "REVIEW" })} />);
    expect(screen.getByTestId("readiness-review-note").textContent).toContain("Owner perlu memeriksa");
  });

  it("blocked draft lists specific reasons and uses words, not colour only", () => {
    render(<DraftReadinessBanner readiness={buildCampaignReadiness({ ...BASE, quality: "FAIL", destination: "invalid" })} />);
    expect(screen.getByTestId("readiness-primary").textContent).toContain("Draft perlu dilengkapi sebelum diajukan");
    expect(screen.getByTestId("readiness-primary").textContent).toContain("Perlu dilengkapi");
    expect(document.body.textContent).toContain("masih bisa mengajukan");
    expect(document.body.textContent).not.toContain("belum siap diajukan");
    const reasons = screen.getByTestId("readiness-draft-reasons").textContent ?? "";
    expect(reasons).toContain("harus diperbaiki");
    expect(reasons).toContain("Tujuan pembelian");
  });

  it("legacy with a landing URL shows an information note, not a failure", () => {
    render(<DraftReadinessBanner readiness={buildCampaignReadiness({ ...BASE, destination: "legacy_ok" })} />);
    expect(screen.getByTestId("readiness-primary").textContent).toContain("Draft siap ditinjau");
    expect(screen.getByTestId("readiness-notes").textContent).toContain("Campaign lama");
    expect(screen.queryByTestId("readiness-draft-reasons")).toBeNull();
  });

  it("legacy without a landing URL is a reason with the fix", () => {
    render(<DraftReadinessBanner readiness={buildCampaignReadiness({ ...BASE, destination: "legacy_missing" })} />);
    expect(screen.getByTestId("readiness-draft-reasons").textContent).toContain("Isi URL pada produk atau profil brand");
  });

  it("SCHEDULED stays 'belum berjalan'; ACTIVE shows no launch-readiness block", () => {
    const { rerender } = render(<DraftReadinessBanner readiness={buildCampaignReadiness({ ...BASE, status: "SCHEDULED" })} />);
    expect(screen.getByTestId("readiness-primary").textContent).toContain("Disetujui, belum berjalan");
    rerender(<DraftReadinessBanner readiness={buildCampaignReadiness({ ...BASE, status: "ACTIVE" })} />);
    expect(screen.getByTestId("readiness-primary").textContent).toContain("Campaign berjalan");
    expect(screen.queryByTestId("readiness-launch")).toBeNull();
  });
});

describe("ChannelInfoChecklist", () => {
  const r = buildCampaignReadiness(BASE);

  it("TikTok: shows connection, capability, media and S1 as words, with no action button", () => {
    const tiktok = r.platforms.find((p) => p.platform === "TIKTOK")!;
    render(<ChannelInfoChecklist platform={tiktok} />);
    const box = screen.getByTestId("channel-checklist-tiktok");
    for (const label of ["Koneksi akun", "Kapabilitas peluncuran", "Media", "Gerbang peluncuran berbayar (S1)"]) {
      expect(box.textContent).toContain(label);
    }
    expect(box.textContent).toContain("Unggah aset TikTok belum tersedia");
    expect(box.querySelector("button, a")).toBeNull();
  });

  it("X: media is 'Belum dapat dipastikan', not mandatory", () => {
    const x = r.platforms.find((p) => p.platform === "X")!;
    render(<ChannelInfoChecklist platform={x} />);
    const box = screen.getByTestId("channel-checklist-x");
    expect(box.textContent).toContain("Belum dapat dipastikan");
    expect(box.textContent).not.toMatch(/wajib/i);
  });
});

describe("QualityUnavailableCard", () => {
  it("states that no assessment was made, and is not a pass", () => {
    render(<QualityUnavailableCard canRegenerate />);
    expect(screen.getByTestId("ai-quality-status").textContent).toBe("Kualitas tidak dapat dinilai");
    expect(screen.getByTestId("ai-quality-unavailable").textContent).toContain("bukan berarti tidak ada masalah");
    expect(screen.getByTestId("ai-quality-unavailable").textContent).toContain("Buat Ulang dengan AI");
  });

  it("does not suggest regenerate when the campaign is not a draft", () => {
    render(<QualityUnavailableCard canRegenerate={false} />);
    const text = screen.getByTestId("ai-quality-unavailable").textContent ?? "";
    expect(text).not.toContain("Buat Ulang dengan AI");
    expect(text).toContain("hanya bisa dibuat untuk campaign berstatus draft");
  });
});
