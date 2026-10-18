import { randomUUID } from "node:crypto";
import { ConnectorApiError, ConnectorConfigError } from "@/lib/connectors/types";
import { describeSafeError } from "@/lib/connectors/safe-error-log";

/**
 * Pure helpers for the ad-platform launch flow (features/campaigns/
 * launch-actions.ts): which step failed, whether the platform object of that
 * step may nevertheless exist, and the safe, human-readable note stored for
 * manual reconciliation.
 *
 * Nothing here talks to a platform or a database, and nothing here ever
 * reads a provider error MESSAGE (it can echo request parameters). A note is
 * built only from our own text, the step name, ids returned by the platform
 * for objects that DO exist, and the allowlisted summary from
 * describeSafeError (error name, HTTP status, numeric code/subcode).
 */

export type LaunchStep = "createCampaign" | "createAdSet" | "createCreative" | "createAd" | "saveResult";

/** Ids of the platform objects this request has created so far (all created PAUSED). */
export interface CreatedPlatformObjects {
  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;
}

/**
 * How sure we are about the outcome of the failed step.
 * - NOT_CREATED: the platform (or our own pre-flight) definitively rejected
 *   the request, so the object of that step does not exist.
 * - UNCERTAIN: the object may exist even though we never got its id (network
 *   failure, timeout, 5xx, a response without an id). Never retried.
 * - DATABASE: the platform call may have succeeded but we could not record
 *   its result.
 * - NOT_ATTEMPTED (H2): this request never made the create call of the step,
 *   because Emergency Stop was active/unreadable or the create INTENT could not
 *   be stored. Never releasable: the row stays claimed (fail-closed).
 * - FENCE_LOST (H2): a conditional write matched no row, i.e. this request no
 *   longer owns the claim (another attempt or a manual change). It writes
 *   nothing more and creates nothing more.
 */
export type FailureCertainty = "NOT_CREATED" | "UNCERTAIN" | "DATABASE" | "NOT_ATTEMPTED" | "FENCE_LOST";

/**
 * Our own database could not store (or confirm) a launch write. `beforeCreate`
 * is true for the create INTENT write: no create call was made for that step.
 */
export class LaunchDatabaseError extends Error {
  constructor(
    public readonly what: string,
    public readonly beforeCreate = false,
  ) {
    super(`launch database write failed: ${what}`);
    this.name = "LaunchDatabaseError";
  }
}

/** A conditional (fenced) write matched no row: this request does not own the claim any more. */
export class LaunchFenceLostError extends Error {
  constructor(public readonly what: string) {
    super(`launch claim ownership lost: ${what}`);
    this.name = "LaunchFenceLostError";
  }
}

/** Emergency Stop is active, or its state could not be read: no further create. */
export class LaunchStopError extends Error {
  constructor(public readonly reason: "ACTIVE" | "UNREADABLE") {
    super(`launch stopped before create: emergency stop ${reason}`);
    this.name = "LaunchStopError";
  }
}

/** The platform answered a create call without usable id. The object may exist. */
export class LaunchUncertainResultError extends Error {
  constructor(public readonly step: LaunchStep) {
    super(`platform create returned no id: ${step}`);
    this.name = "LaunchUncertainResultError";
  }
}

const STEP_LABEL: Record<LaunchStep, string> = {
  createCampaign: "pembuatan campaign",
  createAdSet: "pembuatan ad set",
  createCreative: "pembuatan creative",
  createAd: "pembuatan ad",
  saveResult: "penyimpanan hasil peluncuran",
};

/** A returned id is usable only if it is a non-empty string. Anything else is an uncertain result. */
export function requireCreatedId(result: unknown, step: LaunchStep): string {
  const id = typeof result === "object" && result !== null ? (result as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new LaunchUncertainResultError(step);
  }
  return id;
}

/**
 * Decides whether the platform may hold an object for a failed create call.
 * Only an explicit, structured rejection is treated as "not created":
 * our own configuration error (thrown before any request) or a platform
 * answer with a 4xx status (other than 408) / an error body on a 2xx.
 * Everything else — network errors, timeouts, 5xx, unknown errors — is
 * UNCERTAIN and must never be retried automatically.
 */
export function classifyCreateFailure(err: unknown): "NOT_CREATED" | "UNCERTAIN" {
  if (err instanceof ConnectorConfigError) return "NOT_CREATED";
  if (err instanceof ConnectorApiError && typeof err.status === "number") {
    if (err.status >= 400 && err.status <= 499 && err.status !== 408) return "NOT_CREATED";
    if (err.status >= 200 && err.status <= 299) return "NOT_CREATED";
  }
  return "UNCERTAIN";
}

/** "campaign=…, adset=…" for the ids that exist, or null when none do. */
export function describeCreatedObjects(created: CreatedPlatformObjects): string | null {
  const parts: string[] = [];
  if (created.campaignId) parts.push(`campaign=${created.campaignId}`);
  if (created.adSetId) parts.push(`adset=${created.adSetId}`);
  if (created.creativeId) parts.push(`creative=${created.creativeId}`);
  if (created.adId) parts.push(`ad=${created.adId}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** The note kept in the row while the launch is running (and after a crash). */
export const LAUNCH_IN_PROGRESS_NOTE =
  "Peluncuran sedang diproses. Jika status ini tidak berubah, periksa Meta Ads Manager sebelum meluncurkan ulang (rekonsiliasi manual).";

/** Matches the machine-readable ownership marker that ends every note written by a launch attempt. */
const NONCE_MARKER_PATTERN = /\[LNE:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/;
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A fresh, unguessable id for ONE launch attempt (cryptographically secure). */
export function newLaunchNonce(): string {
  return randomUUID();
}

function requireNonce(nonce: string): string {
  if (!NONCE_PATTERN.test(nonce)) throw new Error("invalid launch nonce");
  return nonce;
}

/** `[LNE:<nonce>]`: the ownership marker. Every fenced write is conditional on the exact previous note. */
export function nonceMarker(nonce: string): string {
  return `[LNE:${requireNonce(nonce)}]`;
}

/** The nonce stored in a note, or null. */
export function extractLaunchNonce(note: string | null | undefined): string | null {
  return typeof note === "string" ? (NONCE_MARKER_PATTERN.exec(note)?.[1] ?? null) : null;
}

export type CorrelationObject = "campaign" | "adSet" | "creative" | "ad";
const CORRELATION_LETTER: Readonly<Record<CorrelationObject, string>> = Object.freeze({
  campaign: "C",
  adSet: "S",
  creative: "R",
  ad: "A",
});

/** Short attempt tag: the first 8 hex digits of the nonce, upper case. */
export function launchAttemptTag(nonce: string): string {
  return requireNonce(nonce).slice(0, 8).toUpperCase();
}

/** `LNE-<attempt>-<C|S|R|A>`: stable per attempt and object type. Searchable in Ads Manager. */
export function correlationToken(nonce: string, object: CorrelationObject): string {
  return `LNE-${launchAttemptTag(nonce)}-${CORRELATION_LETTER[object]}`;
}

/**
 * Conservative cap on a Meta object name. Meta's exact limits are NOT verified
 * here, so the visible part is cut well below any plausible limit; the token
 * is always kept whole at the end.
 */
export const MAX_OBJECT_NAME_LENGTH = 200;

/** `<base>[ — <label>] [LNE-XXXXXXXX-C]`, the base shortened (by code points) so the token always fits. */
export function withCorrelationToken(base: string, object: CorrelationObject, nonce: string, label?: string): string {
  const tail = `${label ? ` — ${label}` : ""} [${correlationToken(nonce, object)}]`;
  const room = Math.max(1, MAX_OBJECT_NAME_LENGTH - Array.from(tail).length);
  const chars = Array.from(base);
  const visible = chars.length > room ? `${chars.slice(0, Math.max(1, room - 1)).join("")}…` : base;
  return `${visible}${tail}`;
}

/** The note written by the exclusive claim: the in-progress text plus the ownership marker. */
export function buildClaimNote(nonce: string): string {
  return `${LAUNCH_IN_PROGRESS_NOTE} ${nonceMarker(nonce)}`;
}

/**
 * Progress note written after each created object, so a crash still leaves the
 * ids behind. With a nonce it also carries the ownership marker.
 */
export function buildProgressNote(created: CreatedPlatformObjects, nonce?: string): string {
  const objects = describeCreatedObjects(created);
  const base = objects
    ? `Peluncuran sedang diproses. Objek di Meta (semua PAUSED): ${objects}. Jika status ini tidak berubah, periksa Meta Ads Manager sebelum meluncurkan ulang (rekonsiliasi manual).`
    : LAUNCH_IN_PROGRESS_NOTE;
  return nonce ? `${base} ${nonceMarker(nonce)}` : base;
}

export type CreateStep = Exclude<LaunchStep, "saveResult">;

/**
 * Write-ahead INTENT note, stored BEFORE the create call of a step. If the
 * process dies after Meta created the object but before its id was stored, the
 * row says exactly which step was in flight, which token to search for, and
 * which ids are already known. It is evidence for a human, not a guarantee.
 */
export function buildIntentNote(step: CreateStep, created: CreatedPlatformObjects, nonce: string, token?: string): string {
  const objects = describeCreatedObjects(created);
  const label = STEP_LABEL[step];
  return [
    `Peluncuran sedang diproses. Langkah ${label} akan/sedang dikirim ke platform iklan${token ? ` (token ${token})` : ""}; hasilnya TIDAK PASTI sampai id tercatat.`,
    objects ? `Objek di Meta (semua PAUSED): ${objects}.` : null,
    `Jika status ini tidak berubah, periksa Meta Ads Manager${token ? ` (cari ${token})` : ""} sebelum meluncurkan ulang (rekonsiliasi manual).`,
    nonceMarker(nonce),
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
}

function safeDetail(err: unknown): string {
  if (err instanceof ConnectorConfigError) {
    // Our own, fixed Indonesian text (never provider text).
    return err.message;
  }
  if (err instanceof LaunchDatabaseError) return `database: ${err.what}`;
  if (err instanceof LaunchFenceLostError) return `kepemilikan claim: ${err.what}`;
  if (err instanceof LaunchStopError) return err.reason === "ACTIVE" ? "Emergency Stop aktif" : "status Emergency Stop tidak dapat dipastikan";
  if (err instanceof LaunchUncertainResultError) return "respons Meta tanpa id";

  const summary = describeSafeError(err);
  const pieces = [summary.errorName];
  if (summary.httpStatus !== undefined) pieces.push(`HTTP ${summary.httpStatus}`);
  if (summary.code !== undefined) pieces.push(`kode ${summary.code}`);
  if (summary.subcode !== undefined) pieces.push(`subkode ${summary.subcode}`);
  return pieces.join(", ");
}

export interface LaunchFailure {
  /** Safe note for the row's `error` column, the audit log and the user. */
  message: string;
  certainty: FailureCertainty;
  step: LaunchStep;
  /**
   * True only when the launch may be returned to SCHEDULED for a manual
   * retry: the very first create call was definitively rejected and nothing
   * was created. In every other case a relaunch stays blocked.
   */
  releasable: boolean;
}

export interface LaunchAttemptContext {
  nonce: string;
  /** True when the object names carry the correlation token (Meta only). */
  tokenInNames: boolean;
}

export function describeLaunchFailure(
  step: LaunchStep,
  err: unknown,
  created: CreatedPlatformObjects,
  attempt?: LaunchAttemptContext,
): LaunchFailure {
  const certainty: FailureCertainty =
    err instanceof LaunchFenceLostError
      ? "FENCE_LOST"
      : err instanceof LaunchStopError
        ? "NOT_ATTEMPTED"
        : err instanceof LaunchDatabaseError
          ? err.beforeCreate
            ? "NOT_ATTEMPTED"
            : "DATABASE"
          : err instanceof LaunchUncertainResultError
            ? "UNCERTAIN"
            : classifyCreateFailure(err);

  const objects = describeCreatedObjects(created);
  // Only a definitive rejection of the very first create call, with nothing
  // created, may be released. NOT_ATTEMPTED and FENCE_LOST are never released.
  const releasable = step === "createCampaign" && certainty === "NOT_CREATED" && objects === null;

  const parts: string[] = [
    certainty === "NOT_ATTEMPTED"
      ? `Peluncuran dihentikan sebelum ${STEP_LABEL[step]} (${safeDetail(err)}).`
      : certainty === "FENCE_LOST"
        ? `Peluncuran dihentikan pada ${STEP_LABEL[step]} (${safeDetail(err)}).`
        : `Peluncuran berhenti pada ${STEP_LABEL[step]} (${safeDetail(err)}).`,
  ];

  if (objects) {
    parts.push(`Objek di Meta (semua PAUSED): ${objects}.`);
  }

  if (certainty === "UNCERTAIN") {
    parts.push(
      "Hasil langkah ini TIDAK PASTI: objek mungkin sudah dibuat di Meta meski id-nya tidak diterima. Periksa Meta Ads Manager; tidak ada percobaan ulang otomatis.",
    );
  } else if (certainty === "DATABASE") {
    parts.push("Hasil di Meta tidak dapat disimpan ke database. Periksa Meta Ads Manager; tidak ada percobaan ulang otomatis.");
  } else if (certainty === "NOT_CREATED") {
    parts.push("Meta menolak permintaan ini, objek langkah ini tidak dibuat.");
  } else if (certainty === "NOT_ATTEMPTED") {
    parts.push("Permintaan ini tidak memanggil Meta untuk langkah ini. Tidak ada percobaan ulang otomatis dan tidak ada objek yang dihapus.");
  } else {
    parts.push(
      "Claim atas baris ini sudah berpindah atau diubah (permintaan lain atau intervensi manual). Permintaan ini tidak menulis apa pun lagi dan tidak membuat objek berikutnya; periksa Meta Ads Manager.",
    );
  }

  if (certainty !== "FENCE_LOST" && !releasable) {
    parts.push("Peluncuran ulang diblokir sampai direkonsiliasi manual.");
  }

  if (attempt) {
    if (attempt.tokenInNames) parts.push(`Token pencarian di Meta: LNE-${launchAttemptTag(attempt.nonce)}-*.`);
    parts.push(nonceMarker(attempt.nonce));
  }

  return { message: parts.join(" "), certainty, step, releasable };
}
