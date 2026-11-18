import { describe, expect, it } from "vitest";
import {
  buildCampaignReadiness,
  selectedAdPlatforms,
  type ReadinessInput,
  type ReadinessQuality,
} from "@/lib/campaigns/draft-readiness";

const BASE: ReadinessInput = {
  status: "DRAFT",
  quality: "PASS",
  destinationValid: true,
  channels: ["INSTAGRAM", "FACEBOOK"],
  connectedPlatforms: new Set(["META"]),
  createAdEnabledPlatforms: new Set(["META"]),
  hasLaunchImage: true,
  budgetWriteEnabled: { META: false, TIKTOK: false, X: false },
  canRegenerate: true,
};
const make = (over: Partial<ReadinessInput> = {}) => buildCampaignReadiness({ ...BASE, ...over });

describe("draft status: quality x destination", () => {
  it.each<[ReadinessQuality, boolean | undefined, string]>([
    ["PASS", true, "Draft siap ditinjau"],
    ["REVIEW", true, "Draft siap ditinjau"],
    ["FAIL", true, "Draft belum siap diajukan"],
    ["UNKNOWN", true, "Draft belum siap diajukan"],
    ["NONE", true, "Draft belum siap diajukan"],
    ["PASS", false, "Draft belum siap diajukan"],
    ["REVIEW", false, "Draft belum siap diajukan"],
    ["PASS", undefined, "Draft belum siap diajukan"],
  ])("quality %s + destination %s => %s", (quality, destinationValid, label) => {
    expect(make({ quality, destinationValid }).primary.label).toBe(label);
  });

  it("REVIEW is ready to review but must say the Owner has to check the notes", () => {
    const r = make({ quality: "REVIEW" });
    expect(r.primary.tone).toBe("review");
    expect(r.reviewNote).toContain("Owner perlu memeriksa");
    expect(make({ quality: "PASS" }).reviewNote).toBeNull();
  });

  it("gives a specific reason for each blocker", () => {
    expect(make({ quality: "FAIL" }).draftReasons.join(" ")).toContain("harus diperbaiki");
    expect(make({ quality: "NONE" }).draftReasons.join(" ")).toContain("belum dibuat");
    expect(make({ destinationValid: false }).draftReasons.join(" ")).toContain("Tujuan pembelian");
    expect(make({ destinationValid: undefined }).draftReasons.join(" ")).toContain("campaign lama");
  });

  it("an unreadable strategy says it cannot be assessed and only suggests regenerate for a draft", () => {
    const withHint = make({ quality: "UNKNOWN", canRegenerate: true }).draftReasons.join(" ");
    expect(withHint).toContain("tidak dapat dinilai");
    expect(withHint).toContain("Buat Ulang dengan AI");
    const without = make({ quality: "UNKNOWN", canRegenerate: false }).draftReasons.join(" ");
    expect(without).toContain("tidak dapat dinilai");
    expect(without).not.toContain("Buat Ulang dengan AI");
  });

  it("never says the draft is ready to go live", () => {
    for (const quality of ["PASS", "REVIEW", "FAIL", "UNKNOWN", "NONE"] as const) {
      const r = make({ quality });
      expect(r.primary.label).not.toMatch(/siap tayang|semua sudah siap/i);
      expect(r.launch?.label).toBe("Belum siap tayang");
      expect(r.launch?.ready).toBe(false);
    }
  });
});

describe("launch reasons per channel", () => {
  it("lists Meta reasons: S1 locked, missing image, not connected, capability off", () => {
    const r = make({ connectedPlatforms: new Set(), createAdEnabledPlatforms: new Set(), hasLaunchImage: false });
    const text = r.launch!.reasons.join(" | ");
    expect(text).toContain("belum terhubung");
    expect(text).toContain("belum diaktifkan");
    expect(text).toContain("gambar produk");
    expect(text).toContain("terkunci");
  });

  it("TikTok: asset upload not available even when connected and capable", () => {
    const r = make({
      channels: ["TIKTOK"],
      connectedPlatforms: new Set(["TIKTOK"]),
      createAdEnabledPlatforms: new Set(["TIKTOK"]),
      budgetWriteEnabled: { TIKTOK: true },
    });
    const media = r.platforms[0].checks.find((c) => c.id === "media")!;
    expect(media.status).toBe("FAIL");
    expect(media.detail).toContain("Unggah aset TikTok belum tersedia");
    expect(r.platforms[0].complete).toBe(false);
  });

  it("X: media requirement is UNKNOWN, never invented as mandatory", () => {
    const r = make({ channels: ["X"] });
    const media = r.platforms[0].checks.find((c) => c.id === "media")!;
    expect(media.status).toBe("UNKNOWN");
    expect(media.detail).toContain("belum dapat dipastikan");
    expect(media.detail).not.toMatch(/wajib|diwajibkan|memerlukan/i);
  });

  it("S1: a locked or missing gate is FAIL, only an explicit true passes", () => {
    const s1 = (b: Record<string, boolean>) =>
      make({ budgetWriteEnabled: b }).platforms[0].checks.find((c) => c.id === "budget_gate")!.status;
    expect(s1({ META: false })).toBe("FAIL");
    expect(s1({})).toBe("FAIL");
    expect(s1({ META: true })).toBe("PASS");
  });

  it("uses only the channels the campaign selected; SEO is not an ad channel", () => {
    expect(selectedAdPlatforms(["SEO"])).toEqual([]);
    expect(selectedAdPlatforms(["FACEBOOK", "INSTAGRAM", "X"])).toEqual(["META", "X"]);
    const seoOnly = make({ channels: ["SEO"] });
    expect(seoOnly.platforms).toEqual([]);
    expect(seoOnly.launch?.label).toBe("Tidak ada channel iklan berbayar");
  });
});

describe("stages stay distinct and honest", () => {
  it("AWAITING_APPROVAL: waiting for the Owner, nothing published", () => {
    const r = make({ status: "AWAITING_APPROVAL" });
    expect(r.stage).toBe("AWAITING_APPROVAL");
    expect(r.primary.label).toBe("Menunggu keputusan Owner");
    expect(r.primary.detail).toContain("belum ada yang diterbitkan");
    expect(r.launch?.label).toBe("Belum siap tayang");
  });

  it("SCHEDULED: approved but not running, never 'siap tayang' while S1 is locked", () => {
    const r = make({ status: "SCHEDULED" });
    expect(r.primary.label).toBe("Disetujui, belum berjalan");
    expect(r.launch?.ready).toBe(false);
    expect(r.launch?.label).toBe("Belum siap tayang");
  });

  it("SCHEDULED only reports launch conditions as met when every check passes, and still says manual", () => {
    const r = make({
      status: "SCHEDULED",
      channels: ["INSTAGRAM"],
      budgetWriteEnabled: { META: true },
    });
    expect(r.launch?.ready).toBe(true);
    expect(r.launch?.label).toContain("tetap manual");
  });

  it("ACTIVE and COMPLETED are LIVE with no launch-readiness claim; other statuses stay neutral", () => {
    expect(make({ status: "ACTIVE" }).stage).toBe("LIVE");
    expect(make({ status: "ACTIVE" }).primary.label).toBe("Campaign berjalan");
    expect(make({ status: "COMPLETED" }).primary.label).toBe("Campaign selesai");
    expect(make({ status: "ACTIVE" }).launch).toBeNull();
    for (const status of ["PAUSED", "FAILED", "WHATEVER"]) {
      const r = make({ status });
      expect(r.stage).toBe("OTHER");
      expect(r.launch).toBeNull();
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const input = { ...BASE };
    const snapshot = JSON.stringify({ ...input, connectedPlatforms: [...input.connectedPlatforms] });
    expect(buildCampaignReadiness(input)).toEqual(buildCampaignReadiness(input));
    expect(JSON.stringify({ ...input, connectedPlatforms: [...input.connectedPlatforms] })).toBe(snapshot);
  });
});
