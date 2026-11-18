import { describe, expect, it } from "vitest";
import {
  assessLaunchMedia,
  buildCampaignReadiness,
  ownHostsConfigured,
  resolveDestinationState,
  selectedAdPlatforms,
  type DestinationState,
  type LaunchMediaRow,
  type ReadinessInput,
  type ReadinessQuality,
} from "@/lib/campaigns/draft-readiness";

const BASE: ReadinessInput = {
  status: "DRAFT",
  quality: "PASS",
  destination: "valid",
  hostsConfigured: true,
  channels: ["INSTAGRAM", "FACEBOOK"],
  connectedPlatforms: new Set(["META"]),
  createAdEnabledPlatforms: new Set(["META"]),
  launchMedia: "PLAUSIBLE",
  budgetWriteEnabled: { META: false, TIKTOK: false, X: false },
  canRegenerate: true,
};
const make = (over: Partial<ReadinessInput> = {}) => buildCampaignReadiness({ ...BASE, ...over });

describe("draft status: quality x destination", () => {
  const NOT_READY = "Draft perlu dilengkapi sebelum diajukan";
  it.each<[ReadinessQuality, DestinationState, string]>([
    ["PASS", "valid", "Draft siap ditinjau"],
    ["REVIEW", "valid", "Draft siap ditinjau"],
    ["FAIL", "valid", NOT_READY],
    ["UNKNOWN", "valid", NOT_READY],
    ["NONE", "valid", NOT_READY],
    ["PASS", "invalid", NOT_READY],
    ["REVIEW", "invalid", NOT_READY],
    ["PASS", "legacy_ok", "Draft siap ditinjau"],
    ["PASS", "legacy_missing", NOT_READY],
  ])("quality %s + destination %s => %s", (quality, destination, label) => {
    expect(make({ quality, destination }).primary.label).toBe(label);
  });

  it("not-ready wording: old 'belum siap diajukan' is gone; says submission is still possible but launch conditions must be met", () => {
    const r = make({ quality: "FAIL" });
    expect(r.primary.label).not.toContain("belum siap diajukan");
    expect(r.primary.detail).toContain("masih bisa mengajukan");
    expect(r.primary.detail).toContain("syarat peluncuran harus dipenuhi");
    expect(make({ quality: "PASS" }).primary.detail).not.toContain("masih bisa mengajukan");
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
    expect(make({ destination: "invalid" }).draftReasons.join(" ")).toContain("Tujuan pembelian");
  });

  describe("legacy campaigns follow the launch rule (no stored destination is not a failure)", () => {
    it("legacy with a usable landing URL: not a reason, only an information note; draft stays ready to review", () => {
      const r = make({ destination: "legacy_ok" });
      expect(r.draftReasons).toEqual([]);
      expect(r.primary.label).toBe("Draft siap ditinjau");
      expect(r.notes.join(" ")).toContain("Campaign lama");
      expect(r.launch?.reasons.join(" ")).not.toContain("URL tujuan");
    });

    it("legacy WITHOUT a usable landing URL fails, with the exact fix", () => {
      const r = make({ destination: "legacy_missing" });
      expect(r.draftReasons.join(" ")).toContain("Isi URL pada produk atau profil brand");
      expect(r.launch?.reasons.join(" ")).toContain("Isi URL pada produk atau profil brand");
      expect(r.notes).toEqual([]);
    });

    it("a NEW campaign with an invalid destination still warns; valid has neither reason nor note", () => {
      const bad = make({ destination: "invalid" });
      expect(bad.draftReasons.join(" ")).toContain("Tujuan pembelian belum ditentukan atau tidak valid");
      expect(bad.notes).toEqual([]);
      const ok = make({ destination: "valid" });
      expect(ok.draftReasons).toEqual([]);
      expect(ok.notes).toEqual([]);
    });

    it("SCHEDULED is not 'conditions met' for a legacy campaign without a landing URL", () => {
      const r = make({ status: "SCHEDULED", channels: ["INSTAGRAM"], budgetWriteEnabled: { META: true }, destination: "legacy_missing" });
      expect(r.launch?.ready).toBe(false);
    });
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
    const r = make({ connectedPlatforms: new Set(), createAdEnabledPlatforms: new Set(), launchMedia: "NO_IMAGE" });
    const text = r.launch!.reasons.join(" | ");
    expect(text).toContain("belum terhubung");
    expect(text).toContain("belum diaktifkan");
    expect(text).toContain("belum punya gambar");
    expect(text).toContain("terkunci");
  });

  describe("Meta media: three states, never verified from the page", () => {
    const meta = (launchMedia: ReadinessInput["launchMedia"]) =>
      make({ launchMedia }).platforms[0].checks.find((c) => c.id === "media")!;

    it.each([
      ["NO_IMAGE", "FAIL", "belum punya gambar"],
      ["SELECTED_NOT_FOUND", "FAIL", "tidak ditemukan"],
      ["SELECTED_NOT_IMAGE", "FAIL", "berupa video"],
      ["BAD_PATH", "FAIL", "Lokasi file"],
      ["BAD_FORMAT", "FAIL", "JPG atau PNG"],
      ["PLAUSIBLE", "UNKNOWN", "dicek saat peluncuran"],
    ] as const)("%s => %s", (state, status, text) => {
      expect(meta(state).status).toBe(status);
      expect(meta(state).detail).toContain(text);
    });

    it("no state ever yields PASS, so Meta is never 'complete' from this view and the launch stays 'belum siap'", () => {
      for (const s of ["NO_IMAGE", "SELECTED_NOT_FOUND", "SELECTED_NOT_IMAGE", "BAD_PATH", "BAD_FORMAT", "PLAUSIBLE"] as const) {
        expect(meta(s).status).not.toBe("PASS");
      }
      const r = make({ status: "SCHEDULED", channels: ["INSTAGRAM"], budgetWriteEnabled: { META: true } });
      expect(r.launch?.ready).toBe(false);
      expect(r.launch?.reasons.join(" ")).toContain("dicek saat peluncuran");
    });
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

  it("SCHEDULED reports launch conditions as met only when every check passes (TikTok/X-free case cannot, because Meta media is never verified here)", () => {
    const r = make({
      status: "SCHEDULED",
      channels: ["INSTAGRAM"],
      budgetWriteEnabled: { META: true },
    });
    expect(r.launch?.ready).toBe(false);
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

describe("assessLaunchMedia mirrors the Meta pick + static checks", () => {
  const owner = { tenantId: "t1", productId: "p1" };
  const row = (id: string, ext: string, media_type = "IMAGE"): LaunchMediaRow => ({
    id,
    media_type,
    storage_path: `t1/p1/${id}.${ext}`,
  });

  it("no media / only video with no selection => NO_IMAGE", () => {
    expect(assessLaunchMedia([], null, owner)).toBe("NO_IMAGE");
    expect(assessLaunchMedia(null, undefined, owner)).toBe("NO_IMAGE");
    expect(assessLaunchMedia([row("v", "mp4", "VIDEO")], null, owner)).toBe("NO_IMAGE");
  });

  it("a selected VIDEO is never a product image, even when the product has another image", () => {
    const rows = [row("v", "mp4", "VIDEO"), row("i", "jpg")];
    expect(assessLaunchMedia(rows, "v", owner)).toBe("SELECTED_NOT_IMAGE");
  });

  it("a selected id that does not exist fails and is not swapped for another image", () => {
    expect(assessLaunchMedia([row("i", "jpg")], "ghost", owner)).toBe("SELECTED_NOT_FOUND");
  });

  it("without a selection the first IMAGE is used (a video before it is skipped)", () => {
    expect(assessLaunchMedia([row("v", "mp4", "VIDEO"), row("i", "png")], null, owner)).toBe("PLAUSIBLE");
  });

  it("extension must be jpg/jpeg/png (case-insensitive); other formats fail", () => {
    expect(assessLaunchMedia([row("a", "JPG")], "a", owner)).toBe("PLAUSIBLE");
    expect(assessLaunchMedia([row("a", "jpeg")], "a", owner)).toBe("PLAUSIBLE");
    expect(assessLaunchMedia([row("a", "webp")], "a", owner)).toBe("BAD_FORMAT");
    expect(assessLaunchMedia([row("a", "gif")], "a", owner)).toBe("BAD_FORMAT");
  });

  it("the path must belong to this tenant and product, with no traversal or odd characters", () => {
    const at = (storage_path: string): LaunchMediaRow => ({ id: "a", media_type: "IMAGE", storage_path });
    expect(assessLaunchMedia([at("t2/p1/a.jpg")], "a", owner)).toBe("BAD_PATH");
    expect(assessLaunchMedia([at("t1/p2/a.jpg")], "a", owner)).toBe("BAD_PATH");
    expect(assessLaunchMedia([at("t1/p1/../a.jpg")], "a", owner)).toBe("BAD_PATH");
    expect(assessLaunchMedia([at("t1/p1/a%2e.jpg")], "a", owner)).toBe("BAD_PATH");
    expect(assessLaunchMedia([row("a", "jpg")], "a", { tenantId: "t1", productId: null })).toBe("BAD_PATH");
  });
});

describe("ownHosts not configured (null or []) is 'cannot be verified', never ready", () => {
  const LANDING = { productUrl: "https://tokokopi.example.id/produk", brandUrl: null };
  const HOSTS = ["app.linoe-test.id"];

  it("ownHostsConfigured: only a non-empty list counts as configured", () => {
    expect(ownHostsConfigured(null)).toBe(false);
    expect(ownHostsConfigured(undefined)).toBe(false);
    expect(ownHostsConfigured([])).toBe(false);
    expect(ownHostsConfigured(HOSTS)).toBe(true);
  });

  it.each<[string[] | null]>([[null], [[]]])("legacy + ownHosts %j => legacy_unverified even with a usable URL", (ownHosts) => {
    expect(resolveDestinationState({ storedKind: "legacy", ownHosts, ...LANDING })).toBe("legacy_unverified");
    expect(resolveDestinationState({ storedKind: "legacy", ownHosts })).toBe("legacy_unverified");
  });

  it("legacy + configured hosts keeps the launch rule: usable URL => legacy_ok, none => legacy_missing, own host => legacy_missing", () => {
    expect(resolveDestinationState({ storedKind: "legacy", ownHosts: HOSTS, ...LANDING })).toBe("legacy_ok");
    expect(resolveDestinationState({ storedKind: "legacy", ownHosts: HOSTS })).toBe("legacy_missing");
    expect(resolveDestinationState({ storedKind: "legacy", ownHosts: HOSTS, productUrl: "https://app.linoe-test.id/x" })).toBe("legacy_missing");
    expect(resolveDestinationState({ storedKind: "legacy", ownHosts: HOSTS, productUrl: "http://tokokopi.example.id" })).toBe("legacy_missing");
  });

  it("stored destinations map the same regardless of hosts: valid => valid, none/invalid => invalid", () => {
    expect(resolveDestinationState({ storedKind: "valid", ownHosts: null })).toBe("valid");
    expect(resolveDestinationState({ storedKind: "none", ownHosts: HOSTS })).toBe("invalid");
    expect(resolveDestinationState({ storedKind: "invalid", ownHosts: null })).toBe("invalid");
  });

  it("legacy_unverified: no 'valid' note, no failure reason, draft can still be reviewed; the note says it cannot be confirmed", () => {
    const r = make({ destination: "legacy_unverified", hostsConfigured: false });
    expect(r.draftReasons).toEqual([]);
    expect(r.primary.label).toBe("Draft siap ditinjau");
    expect(r.notes.join(" ")).toContain("belum dapat dipastikan");
    expect(r.notes.join(" ")).not.toContain("memakai URL produk atau brand");
    expect(r.launch?.label).toBe("Belum siap tayang");
    expect(r.launch?.reasons.join(" ")).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("valid destination + hosts unconfigured + Meta: launch reason is explicit and the launch is not ready", () => {
    const r = make({ destination: "valid", hostsConfigured: false });
    expect(r.launch?.ready).toBe(false);
    expect(r.launch?.reasons.join(" ")).toContain("Peluncuran Meta ditolak");
    expect(make({ destination: "valid", hostsConfigured: true }).launch?.reasons.join(" ")).not.toContain("Peluncuran Meta ditolak");
  });

  it("SCHEDULED + Meta + hosts unconfigured is never 'conditions met', for legacy or valid", () => {
    for (const destination of ["legacy_unverified", "valid"] as const) {
      const r = make({ status: "SCHEDULED", destination, hostsConfigured: false, budgetWriteEnabled: { META: true } });
      expect(r.launch?.ready).toBe(false);
      expect(r.launch?.label).toBe("Belum siap tayang");
      expect(r.launch?.reasons.join(" ")).toContain("Peluncuran Meta ditolak");
    }
  });

  it("AWAITING_APPROVAL also lists the host reason for Meta", () => {
    expect(make({ status: "AWAITING_APPROVAL", hostsConfigured: false }).launch?.reasons.join(" ")).toContain("Peluncuran Meta ditolak");
  });

  it("TikTok/X-only campaigns get no Meta host reason", () => {
    const r = make({ channels: ["TIKTOK", "X"], hostsConfigured: false });
    expect(r.launch?.reasons.join(" ")).not.toContain("Peluncuran Meta ditolak");
  });

  it("a new campaign with an invalid destination still warns when hosts are unconfigured", () => {
    expect(make({ destination: "invalid", hostsConfigured: false }).draftReasons.join(" ")).toContain("Tujuan pembelian");
  });
});
