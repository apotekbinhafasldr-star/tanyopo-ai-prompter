/**
 * Closed-set markers written to prompter_webhook_events.error by the verified webhook path, and the pure helpers that
 * build / classify them. No secrets, no payload: only status words that the GATEWAY itself returned, sanitised.
 */

export const UNKNOWN_STATUS_PREFIX = "UNKNOWN_STATUS:";
/** Older marker, still written when a notification CLAIMS PAID and the gateway answer cannot be classified (HTTP 503). */
export const VERIFIED_STATUS_UNKNOWN = "VERIFIED_STATUS_UNKNOWN";
export const VERIFIED_STATUS_NOT_PAID = "VERIFIED_STATUS_NOT_PAID";
export const GATEWAY_VERIFICATION_FAILED_PREFIX = "GATEWAY_VERIFICATION_FAILED";

const MAX_CODE_LENGTH = 60;

/** `UNKNOWN_STATUS:<code>`: code = the gateway's status words, reduced to [A-Za-z0-9_/+.-] and cut to 60 chars. */
export function unknownStatusMarker(rawStatus: string | null | undefined): string {
  const code = String(rawStatus ?? "")
    .replace(/[^A-Za-z0-9_/+.-]/g, "")
    .slice(0, MAX_CODE_LENGTH);
  return `${UNKNOWN_STATUS_PREFIX}${code || "?"}`;
}

export type WebhookHealthClass = "UNKNOWN" | "VERIFICATION_FAILED" | "NOT_PAID" | null;

export function classifyWebhookError(error: unknown): WebhookHealthClass {
  if (typeof error !== "string") return null;
  if (error === VERIFIED_STATUS_UNKNOWN || error.startsWith(UNKNOWN_STATUS_PREFIX)) return "UNKNOWN";
  if (error === GATEWAY_VERIFICATION_FAILED_PREFIX || error.startsWith(`${GATEWAY_VERIFICATION_FAILED_PREFIX}:`)) return "VERIFICATION_FAILED";
  if (error === VERIFIED_STATUS_NOT_PAID) return "NOT_PAID";
  return null;
}
