import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signed service authentication for
 * /api/v1/integrations/umkmpro/* (product spec §46). UMKMpro AI signs
 * `${timestamp}.${rawBody}` with the shared UMKMPRO_SERVICE_TOKEN and sends
 * the result as a header alongside the timestamp; Promoter recomputes the
 * same signature and compares in constant time. There is no session, no
 * cookie, no user — this is server-to-server trust, not user auth.
 *
 * Pure and dependency-free (only `node:crypto`) so it's directly unit
 * tested — see lib/umkmpro/auth.ts for the server-only wrapper that reads
 * the secret from the environment and pulls headers off a real request.
 */

const FRESHNESS_WINDOW_SECONDS = 5 * 60;

export function signUmkmproPayload(timestamp: string, rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type UmkmproSignatureFailureReason =
  | "MISSING_HEADERS"
  | "STALE_TIMESTAMP"
  | "INVALID_SIGNATURE";

export type VerifyUmkmproSignatureResult =
  | { ok: true }
  | { ok: false; reason: UmkmproSignatureFailureReason };

export interface VerifyUmkmproSignatureInput {
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  secret: string;
  /** Unix seconds. Injectable so tests don't depend on wall-clock time. */
  now?: number;
}

export function verifyUmkmproSignature(
  input: VerifyUmkmproSignatureInput,
): VerifyUmkmproSignatureResult {
  const { timestamp, signature, rawBody, secret } = input;

  if (!timestamp || !signature) {
    return { ok: false, reason: "MISSING_HEADERS" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "STALE_TIMESTAMP" };
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > FRESHNESS_WINDOW_SECONDS) {
    return { ok: false, reason: "STALE_TIMESTAMP" };
  }

  const expected = Buffer.from(signUmkmproPayload(timestamp, rawBody, secret), "hex");
  const actual = Buffer.from(signature, "hex");

  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard that first so a wrong-length header never becomes an error path
  // an attacker could distinguish from a genuine mismatch.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "INVALID_SIGNATURE" };
  }

  return { ok: true };
}
