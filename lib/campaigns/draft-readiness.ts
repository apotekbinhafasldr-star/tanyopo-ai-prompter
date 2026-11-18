import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import type { ConnectorPlatform } from "@/types/database";

/**
 * Honest readiness wording for a campaign page. PURE: no I/O, no clock, it
 * decides only from values the page already loaded and never changes a stored
 * status. It keeps four things apart:
 *   1. the DRAFT can be reviewed / submitted,
 *   2. the Owner has approved (AWAITING_APPROVAL),
 *   3. the campaign is scheduled but NOT running (SCHEDULED),
 *   4. the campaign really ran (ACTIVE / COMPLETED).
 * "Siap tayang" is never claimed from a draft: launch conditions are listed
 * separately, per channel, and the paid-launch (S1) gate must be open.
 */

export type ReadinessStage = "DRAFT" | "AWAITING_APPROVAL" | "SCHEDULED" | "LIVE" | "OTHER";
export type ReadinessTone = "ready" | "review" | "blocked" | "info";
export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";

/** `UNKNOWN` = a proposal exists but could not be parsed; `NONE` = no proposal at all. */
export type ReadinessQuality = "PASS" | "REVIEW" | "FAIL" | "UNKNOWN" | "NONE";

export type AdPlatform = Extract<ConnectorPlatform, "META" | "TIKTOK" | "X">;

export interface ReadinessInput {
  status: string;
  quality: ReadinessQuality;
  /** `true` valid, `false` none/invalid, `undefined` legacy / not determinable. */
  destinationValid: boolean | undefined;
  /** Channels the campaign actually selected (SEO is ignored: it is not an ad channel). */
  channels: readonly string[];
  connectedPlatforms: ReadonlySet<string>;
  createAdEnabledPlatforms: ReadonlySet<string>;
  /** Mirrors the Meta launch rule: selected media exists, or the product has an IMAGE. */
  hasLaunchImage: boolean;
  /** S1 per platform; a missing key counts as locked. */
  budgetWriteEnabled: Partial<Record<string, boolean>>;
  /** Regenerate is offered only for a DRAFT the user may edit. */
  canRegenerate: boolean;
}

export interface ChannelCheck {
  id: "connection" | "capability" | "media" | "budget_gate";
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface PlatformChecklist {
  platform: AdPlatform;
  label: string;
  checks: readonly ChannelCheck[];
  /** True only when every check is PASS. */
  complete: boolean;
}

export interface CampaignReadiness {
  stage: ReadinessStage;
  primary: { label: string; tone: ReadinessTone; detail: string | null };
  /** Why the DRAFT is not ready to submit (empty when it is). */
  draftReasons: readonly string[];
  /** Shown when the gate says REVIEW: the Owner must check the notes. */
  reviewNote: string | null;
  /** Separate "can it go live" statement; null once live or when it does not apply. */
  launch: { label: string; ready: boolean; reasons: readonly string[] } | null;
  platforms: readonly PlatformChecklist[];
}

const PLATFORM_LABEL: Record<AdPlatform, string> = {
  META: "Meta (Facebook/Instagram)",
  TIKTOK: "TikTok",
  X: "X",
};

const PLATFORM_ORDER: readonly AdPlatform[] = ["META", "TIKTOK", "X"];

export const REGENERATE_HINT = 'Buat ulang strategi dengan tombol "Buat Ulang dengan AI" untuk mendapat penilaian.';

function isAdPlatform(p: ConnectorPlatform | undefined): p is AdPlatform {
  return p === "META" || p === "TIKTOK" || p === "X";
}

/** Ad platforms behind the channels the campaign really selected; SEO and unknown channels are dropped. */
export function selectedAdPlatforms(channels: readonly string[]): AdPlatform[] {
  const found = new Set<AdPlatform>();
  for (const channel of channels) {
    const platform = (CHANNEL_TO_CONNECTOR as Record<string, ConnectorPlatform | undefined>)[channel];
    if (isAdPlatform(platform)) found.add(platform);
  }
  return PLATFORM_ORDER.filter((p) => found.has(p));
}

function mediaCheck(platform: AdPlatform, hasLaunchImage: boolean): ChannelCheck {
  const label = "Media";
  if (platform === "META") {
    return hasLaunchImage
      ? { id: "media", label, status: "PASS", detail: "Ada gambar produk. Dicek ulang saat peluncuran." }
      : { id: "media", label, status: "FAIL", detail: "Peluncuran Meta memerlukan gambar produk." };
  }
  if (platform === "TIKTOK") {
    return { id: "media", label, status: "FAIL", detail: "Unggah aset TikTok belum tersedia di LINOE." };
  }
  // X: the audited code does not establish a media rule, so none is invented.
  return { id: "media", label, status: "UNKNOWN", detail: "Syarat media X belum dapat dipastikan." };
}

export function buildPlatformChecklist(
  platform: AdPlatform,
  input: Pick<ReadinessInput, "connectedPlatforms" | "createAdEnabledPlatforms" | "hasLaunchImage" | "budgetWriteEnabled">,
): PlatformChecklist {
  const connected = input.connectedPlatforms.has(platform);
  const capable = input.createAdEnabledPlatforms.has(platform);
  const s1Open = input.budgetWriteEnabled[platform] === true;
  const checks: ChannelCheck[] = [
    connected
      ? { id: "connection", label: "Koneksi akun", status: "PASS", detail: "Akun terhubung." }
      : { id: "connection", label: "Koneksi akun", status: "FAIL", detail: "Akun belum terhubung. Hubungkan di halaman Connections." },
    capable
      ? { id: "capability", label: "Kapabilitas peluncuran", status: "PASS", detail: "Kapabilitas peluncuran aktif." }
      : { id: "capability", label: "Kapabilitas peluncuran", status: "FAIL", detail: "Kapabilitas peluncuran belum diaktifkan." },
    mediaCheck(platform, input.hasLaunchImage),
    s1Open
      ? { id: "budget_gate", label: "Gerbang peluncuran berbayar (S1)", status: "PASS", detail: "Gerbang terbuka." }
      : { id: "budget_gate", label: "Gerbang peluncuran berbayar (S1)", status: "FAIL", detail: "Peluncuran iklan berbayar masih terkunci." },
  ];
  return { platform, label: PLATFORM_LABEL[platform], checks, complete: checks.every((c) => c.status === "PASS") };
}

function draftReasonsFor(input: ReadinessInput): string[] {
  const reasons: string[] = [];
  if (input.quality === "NONE") {
    reasons.push("Strategi AI belum dibuat.");
  } else if (input.quality === "UNKNOWN") {
    reasons.push(
      `Kualitas strategi tidak dapat dinilai (format strategi lama atau tidak dikenali).${
        input.canRegenerate ? ` ${REGENERATE_HINT}` : ""
      }`,
    );
  } else if (input.quality === "FAIL") {
    reasons.push("Pemeriksaan kualitas menemukan hal yang harus diperbaiki.");
  }
  if (input.destinationValid === false) {
    reasons.push("Tujuan pembelian belum ditentukan atau tidak valid.");
  } else if (input.destinationValid === undefined) {
    reasons.push("Tujuan pembelian belum tercatat valid (campaign lama). Tentukan tujuan agar pasti ke mana pembeli diarahkan.");
  }
  return reasons;
}

export function buildCampaignReadiness(input: ReadinessInput): CampaignReadiness {
  const platforms = selectedAdPlatforms(input.channels).map((p) => buildPlatformChecklist(p, input));

  const launchReasons = (extra: string[]): string[] => [
    ...extra,
    ...platforms.flatMap((p) => p.checks.filter((c) => c.status !== "PASS").map((c) => `${p.label}: ${c.detail}`)),
  ];

  switch (input.status) {
    case "DRAFT": {
      const draftReasons = draftReasonsFor(input);
      const ready = draftReasons.length === 0 && (input.quality === "PASS" || input.quality === "REVIEW");
      const reviewing = ready && input.quality === "REVIEW";
      const launchList = launchReasons(["Campaign belum diajukan dan belum disetujui Owner."]);
      return {
        stage: "DRAFT",
        primary: ready
          ? {
              label: "Draft siap ditinjau",
              tone: reviewing ? "review" : "ready",
              detail: "Belum disetujui dan belum ada yang diterbitkan.",
            }
          : { label: "Draft belum siap diajukan", tone: "blocked", detail: null },
        draftReasons,
        reviewNote: reviewing ? "Ada catatan dari pemeriksaan kualitas. Owner perlu memeriksanya sebelum mengajukan." : null,
        launch: platforms.length === 0 ? noAdChannel() : { label: "Belum siap tayang", ready: false, reasons: launchList },
        platforms,
      };
    }
    case "AWAITING_APPROVAL":
      return {
        stage: "AWAITING_APPROVAL",
        primary: { label: "Menunggu keputusan Owner", tone: "info", detail: "Belum disetujui dan belum ada yang diterbitkan." },
        draftReasons: [],
        reviewNote: null,
        launch:
          platforms.length === 0
            ? noAdChannel()
            : { label: "Belum siap tayang", ready: false, reasons: launchReasons(["Menunggu persetujuan Owner."]) },
        platforms,
      };
    case "SCHEDULED": {
      const reasons = launchReasons([]);
      const ready = platforms.length > 0 && reasons.length === 0;
      return {
        stage: "SCHEDULED",
        primary: {
          label: "Disetujui, belum berjalan",
          tone: "info",
          detail: "Tidak ada yang terkirim otomatis. Tiap channel diluncurkan manual.",
        },
        draftReasons: [],
        reviewNote: null,
        launch:
          platforms.length === 0
            ? noAdChannel()
            : ready
              ? { label: "Syarat peluncuran terpenuhi. Peluncuran tetap manual per channel.", ready: true, reasons: [] }
              : { label: "Belum siap tayang", ready: false, reasons },
        platforms,
      };
    }
    case "ACTIVE":
      return live("Campaign berjalan", platforms);
    case "COMPLETED":
      return live("Campaign selesai", platforms);
    default:
      return {
        stage: "OTHER",
        primary: { label: "Periksa status campaign", tone: "info", detail: null },
        draftReasons: [],
        reviewNote: null,
        launch: null,
        platforms,
      };
  }
}

function noAdChannel(): { label: string; ready: boolean; reasons: readonly string[] } {
  return { label: "Tidak ada channel iklan berbayar", ready: false, reasons: ["Campaign ini tidak memilih channel iklan, jadi tidak ada peluncuran iklan."] };
}

function live(label: string, platforms: readonly PlatformChecklist[]): CampaignReadiness {
  return {
    stage: "LIVE",
    primary: { label, tone: "info", detail: null },
    draftReasons: [],
    reviewNote: null,
    launch: null,
    platforms,
  };
}
