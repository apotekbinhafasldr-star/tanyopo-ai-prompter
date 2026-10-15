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
 */
export type FailureCertainty = "NOT_CREATED" | "UNCERTAIN" | "DATABASE";

/** Our own database could not store (or confirm) a launch result. */
export class LaunchDatabaseError extends Error {
  constructor(public readonly what: string) {
    super(`launch database write failed: ${what}`);
    this.name = "LaunchDatabaseError";
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

/** Progress note written after each created object, so a crash still leaves the ids behind. */
export function buildProgressNote(created: CreatedPlatformObjects): string {
  const objects = describeCreatedObjects(created);
  return objects
    ? `Peluncuran sedang diproses. Objek di Meta (semua PAUSED): ${objects}. Jika status ini tidak berubah, periksa Meta Ads Manager sebelum meluncurkan ulang (rekonsiliasi manual).`
    : LAUNCH_IN_PROGRESS_NOTE;
}

function safeDetail(err: unknown): string {
  if (err instanceof ConnectorConfigError) {
    // Our own, fixed Indonesian text (never provider text).
    return err.message;
  }
  if (err instanceof LaunchDatabaseError) return `database: ${err.what}`;
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

export function describeLaunchFailure(
  step: LaunchStep,
  err: unknown,
  created: CreatedPlatformObjects,
): LaunchFailure {
  const certainty: FailureCertainty =
    err instanceof LaunchDatabaseError
      ? "DATABASE"
      : err instanceof LaunchUncertainResultError
        ? "UNCERTAIN"
        : classifyCreateFailure(err);

  const objects = describeCreatedObjects(created);
  const releasable = step === "createCampaign" && certainty === "NOT_CREATED" && objects === null;

  const parts: string[] = [`Peluncuran berhenti pada ${STEP_LABEL[step]} (${safeDetail(err)}).`];

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
  }

  if (!releasable) {
    parts.push("Peluncuran ulang diblokir sampai direkonsiliasi manual.");
  }

  return { message: parts.join(" "), certainty, step, releasable };
}
