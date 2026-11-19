import type { ChannelStatusDisplay } from "@/lib/campaigns/channel-status-display";

/**
 * Meta status -> Indonesian UI label and category (PR-1, DORMANT: no screen
 * calls this yet).
 *
 * Pure presentation logic, no I/O. Fail-closed: only the exact upper-case
 * values Meta documents are recognised; anything else (another value, lower
 * case, null, undefined, a non-string) is "Tidak diketahui" and is never
 * guessed. The words "Aktif" and "tayang" appear ONLY for
 * `effective_status === "ACTIVE"`: `configured_status` alone can say the
 * object is switched on while a parent, review or billing problem keeps it from
 * delivering, so it never produces "Aktif".
 *
 * `configured_status` is consulted only when `effective_status` is MISSING, and
 * then only for the values that mean "not delivering" (PAUSED, ARCHIVED,
 * DELETED). A present but unrecognised `effective_status` is never rescued by
 * `configured_status`.
 *
 * Whether Meta can return other `effective_status` values than the ones listed
 * here (the documented list is longer) is UNVERIFIED; they map to "unknown".
 */

export type MetaStatusCategory =
  | "ACTIVE"
  | "PAUSED"
  | "PAUSED_PARENT"
  | "IN_REVIEW"
  | "NEEDS_FIX"
  | "BILLING_ISSUE"
  | "ARCHIVED"
  | "UNKNOWN";

export interface MetaStatusDisplay {
  category: MetaStatusCategory;
  label: string;
  variant: ChannelStatusDisplay["variant"];
  /** Extra explanation to show next to the badge. Never null, never mentions delivery unless `isActiveOnMeta`. */
  note: string;
  /** True only when `effective_status` is exactly "ACTIVE". */
  isActiveOnMeta: boolean;
}

export const META_STATUS_DISPLAY: Readonly<Record<MetaStatusCategory, Omit<MetaStatusDisplay, "category" | "isActiveOnMeta">>> =
  Object.freeze({
    ACTIVE: { label: "Aktif di Meta", variant: "success", note: "Status yang dibaca dari Meta saat ini; bisa berubah kapan saja." },
    PAUSED: { label: "Dijeda", variant: "neutral", note: "Objek ini dijeda dan tidak membelanjakan anggaran." },
    PAUSED_PARENT: { label: "Dijeda (induk)", variant: "neutral", note: "Campaign atau ad set induknya dijeda, sehingga objek ini tidak membelanjakan anggaran." },
    IN_REVIEW: { label: "Ditinjau Meta", variant: "brand", note: "Meta sedang meninjau objek ini. Hasilnya belum diketahui." },
    NEEDS_FIX: { label: "Perlu perbaikan", variant: "danger", note: "Meta menandai masalah pada objek ini. Periksa di Meta Ads Manager." },
    BILLING_ISSUE: { label: "Masalah pembayaran", variant: "warning", note: "Ada masalah pembayaran di akun iklan Meta. Periksa di Meta Ads Manager." },
    ARCHIVED: { label: "Diarsipkan", variant: "neutral", note: "Objek ini diarsipkan atau dihapus di Meta." },
    UNKNOWN: { label: "Tidak diketahui", variant: "warning", note: "Status dari Meta tidak dikenali, sehingga tidak dapat dipastikan." },
  });

/** `effective_status` -> category. Exact, upper-case keys only. */
const EFFECTIVE_STATUS_CATEGORY: Readonly<Record<string, MetaStatusCategory>> = Object.freeze({
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  CAMPAIGN_PAUSED: "PAUSED_PARENT",
  ADSET_PAUSED: "PAUSED_PARENT",
  PENDING_REVIEW: "IN_REVIEW",
  IN_PROCESS: "IN_REVIEW",
  DISAPPROVED: "NEEDS_FIX",
  WITH_ISSUES: "NEEDS_FIX",
  PENDING_BILLING_INFO: "BILLING_ISSUE",
  ARCHIVED: "ARCHIVED",
  DELETED: "ARCHIVED",
});

/** Used only when `effective_status` is missing: values that can never mean "delivering". */
const CONFIGURED_FALLBACK_CATEGORY: Readonly<Record<string, MetaStatusCategory>> = Object.freeze({
  PAUSED: "PAUSED",
  ARCHIVED: "ARCHIVED",
  DELETED: "ARCHIVED",
});

function lookup(table: Readonly<Record<string, MetaStatusCategory>>, value: unknown): MetaStatusCategory | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(table, value) ? table[value] : null;
}

function build(category: MetaStatusCategory): MetaStatusDisplay {
  return { category, ...META_STATUS_DISPLAY[category], isActiveOnMeta: category === "ACTIVE" };
}

export function metaStatusDisplay(effectiveStatus: unknown, configuredStatus?: unknown): MetaStatusDisplay {
  if (effectiveStatus === undefined || effectiveStatus === null || effectiveStatus === "") {
    return build(lookup(CONFIGURED_FALLBACK_CATEGORY, configuredStatus) ?? "UNKNOWN");
  }
  return build(lookup(EFFECTIVE_STATUS_CATEGORY, effectiveStatus) ?? "UNKNOWN");
}
