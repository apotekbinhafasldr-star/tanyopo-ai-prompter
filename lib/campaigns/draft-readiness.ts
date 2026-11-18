import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import { isOwnProductMediaPath } from "@/lib/media/product-media-path";
import { resolveLandingUrl } from "@/lib/campaigns/meta-launch-preflight";
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

/**
 * Purchase destination as the LAUNCH path sees it (checkLaunchDestination):
 * - valid: a stored destination that re-validates;
 * - invalid: a stored destination that is missing/invalid (launch refuses it);
 * - legacy_ok: no stored destination (legacy), but a valid product/brand landing URL exists (launch accepts it);
 * - legacy_missing: legacy and no valid landing URL (launch fails with LANDING_URL_MISSING).
 * - legacy_unverified: legacy, but this server's own hosts are not configured, so the landing URL cannot be
 *   verified (launch itself stops with APP_HOST_UNCONFIGURED). Never reported as valid.
 */
export type DestinationState = "valid" | "invalid" | "legacy_ok" | "legacy_missing" | "legacy_unverified";

/** `null` or an empty list both mean "own hosts not configured": the app domain cannot be proven. */
export function ownHostsConfigured(ownHosts: readonly string[] | null | undefined): ownHosts is readonly string[] {
  return Array.isArray(ownHosts) && ownHosts.length > 0;
}

/**
 * Pure mapping of the stored destination (from readStoredDestination) to what launch would do.
 * Legacy is judged with the same resolveLandingUrl as launch, but only when the own hosts are configured.
 */
export function resolveDestinationState(input: {
  storedKind: "legacy" | "none" | "valid" | "invalid";
  ownHosts: readonly string[] | null | undefined;
  productUrl?: string | null;
  brandUrl?: string | null;
}): DestinationState {
  if (input.storedKind === "valid") return "valid";
  if (input.storedKind !== "legacy") return "invalid";
  if (!ownHostsConfigured(input.ownHosts)) return "legacy_unverified";
  return resolveLandingUrl({ productUrl: input.productUrl, brandUrl: input.brandUrl }, input.ownHosts).ok
    ? "legacy_ok"
    : "legacy_missing";
}

/**
 * What the page can tell about the Meta creative image WITHOUT reading storage.
 * mime type, file size and object existence are only known to the launch
 * preflight, so a plausible image is never reported as verified.
 */
export type LaunchMediaState =
  | "NO_IMAGE"
  | "SELECTED_NOT_FOUND"
  | "SELECTED_NOT_IMAGE"
  | "BAD_PATH"
  | "BAD_FORMAT"
  | "PLAUSIBLE";

export interface LaunchMediaRow {
  id: string;
  storage_path: string;
  media_type: string;
}

/**
 * Mirrors pickLaunchMedia + the static part of checkCreativeImage (type, own
 * path, JPG/PNG extension). Pure; rows must already be product-scoped and
 * ordered by position.
 */
export function assessLaunchMedia(
  rows: readonly LaunchMediaRow[] | null | undefined,
  selectedMediaId: string | null | undefined,
  owner: { tenantId: string; productId: string | null | undefined },
): LaunchMediaState {
  const list = rows ?? [];
  const media = selectedMediaId ? list.find((r) => r.id === selectedMediaId) : list.find((r) => r.media_type === "IMAGE");
  if (!media) return selectedMediaId ? "SELECTED_NOT_FOUND" : "NO_IMAGE";
  if (media.media_type !== "IMAGE") return "SELECTED_NOT_IMAGE";
  const path = media.storage_path;
  if (
    !owner.productId ||
    !isOwnProductMediaPath(path, owner.tenantId, owner.productId) ||
    /[\\?#%\u0000-\u001f\u007f]/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return "BAD_PATH";
  }
  if (!/\.(?:jpe?g|png)$/i.test(path)) return "BAD_FORMAT";
  return "PLAUSIBLE";
}

export type AdPlatform = Extract<ConnectorPlatform, "META" | "TIKTOK" | "X">;

export interface ReadinessInput {
  status: string;
  quality: ReadinessQuality;
  destination: DestinationState;
  /** False when ownHosts is null/empty: Meta launch is refused with APP_HOST_UNCONFIGURED. */
  hostsConfigured: boolean;
  /** Channels the campaign actually selected (SEO is ignored: it is not an ad channel). */
  channels: readonly string[];
  connectedPlatforms: ReadonlySet<string>;
  createAdEnabledPlatforms: ReadonlySet<string>;
  /** Static Meta image check (see assessLaunchMedia). Never a verified PASS. */
  launchMedia: LaunchMediaState;
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
  /** Neutral information that is NOT a failure (e.g. legacy destination in use). */
  notes: readonly string[];
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

const META_MEDIA_DETAIL: Record<LaunchMediaState, { status: CheckStatus; detail: string }> = {
  NO_IMAGE: { status: "FAIL", detail: "Produk belum punya gambar. Meta memerlukan gambar JPG atau PNG." },
  SELECTED_NOT_FOUND: { status: "FAIL", detail: "Media terpilih tidak ditemukan pada produk ini." },
  SELECTED_NOT_IMAGE: { status: "FAIL", detail: "Media terpilih berupa video. Meta memakai gambar JPG atau PNG." },
  BAD_PATH: { status: "FAIL", detail: "Lokasi file media tidak valid." },
  BAD_FORMAT: { status: "FAIL", detail: "Format file harus JPG atau PNG." },
  PLAUSIBLE: { status: "UNKNOWN", detail: "Ada gambar JPG/PNG. Ukuran dan format file dicek saat peluncuran." },
};

function mediaCheck(platform: AdPlatform, launchMedia: LaunchMediaState): ChannelCheck {
  const label = "Media";
  if (platform === "META") {
    // Never PASS from the page: mime and size are known only to the launch preflight.
    return { id: "media", label, ...META_MEDIA_DETAIL[launchMedia] };
  }
  if (platform === "TIKTOK") {
    return { id: "media", label, status: "FAIL", detail: "Unggah aset TikTok belum tersedia di LINOE." };
  }
  // X: the audited code does not establish a media rule, so none is invented.
  return { id: "media", label, status: "UNKNOWN", detail: "Syarat media X belum dapat dipastikan." };
}

export function buildPlatformChecklist(
  platform: AdPlatform,
  input: Pick<ReadinessInput, "connectedPlatforms" | "createAdEnabledPlatforms" | "launchMedia" | "budgetWriteEnabled">,
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
    mediaCheck(platform, input.launchMedia),
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
  const destination = destinationReason(input.destination);
  if (destination) reasons.push(destination);
  return reasons;
}

/** Why launch would refuse the destination; null when launch accepts it (valid, or a legacy campaign with a usable landing URL). */
function destinationReason(destination: DestinationState): string | null {
  if (destination === "invalid") return "Tujuan pembelian belum ditentukan atau tidak valid.";
  if (destination === "legacy_missing") {
    return "Campaign lama belum punya URL tujuan. Isi URL pada produk atau profil brand.";
  }
  return null;
}

const LEGACY_NOTE = "Campaign lama: tujuan pembelian memakai URL produk atau brand.";
const LEGACY_UNVERIFIED_NOTE =
  "Campaign lama: URL tujuan belum dapat dipastikan karena domain aplikasi belum dikonfigurasi di server.";
const HOST_UNCONFIGURED_REASON =
  "Meta (Facebook/Instagram): Domain aplikasi belum terkonfigurasi di server (NEXT_PUBLIC_APP_URL atau META_REDIRECT_URI). Peluncuran Meta ditolak sampai admin memperbaikinya.";
const NOT_READY_DETAIL =
  "Anda masih bisa mengajukan campaign ini untuk ditinjau Owner. Namun syarat peluncuran harus dipenuhi: tujuan pembelian yang valid dan syarat media tiap channel. Catatan kualitas yang belum diperbaiki akan terlihat saat Owner meninjau.";

export function buildCampaignReadiness(input: ReadinessInput): CampaignReadiness {
  const platforms = selectedAdPlatforms(input.channels).map((p) => buildPlatformChecklist(p, input));

  const notes =
    input.destination === "legacy_ok"
      ? [LEGACY_NOTE]
      : input.destination === "legacy_unverified"
        ? [LEGACY_UNVERIFIED_NOTE]
        : [];
  const hostBlocked = !input.hostsConfigured && platforms.some((p) => p.platform === "META");
  const destinationLaunchReason = destinationReason(input.destination);
  const launchReasons = (extra: string[]): string[] => [
    ...extra,
    ...(destinationLaunchReason ? [destinationLaunchReason] : []),
    ...(hostBlocked ? [HOST_UNCONFIGURED_REASON] : []),
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
          : { label: "Draft perlu dilengkapi sebelum diajukan", tone: "blocked", detail: NOT_READY_DETAIL },
        draftReasons,
        notes,
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
        notes,
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
        notes,
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
        notes,
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
    notes: [],
    reviewNote: null,
    launch: null,
    platforms,
  };
}
