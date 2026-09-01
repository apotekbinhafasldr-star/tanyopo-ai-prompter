import "server-only";

import { serverEnv } from "@/lib/env";
import { verifyUmkmproSignature, type UmkmproSignatureFailureReason } from "@/lib/umkmpro/signature";

export const UMKMPRO_TIMESTAMP_HEADER = "x-umkmpro-timestamp";
export const UMKMPRO_SIGNATURE_HEADER = "x-umkmpro-signature";

export type UmkmproAuthFailureReason = "NOT_CONFIGURED" | UmkmproSignatureFailureReason;

export type UmkmproAuthResult = { ok: true } | { ok: false; reason: UmkmproAuthFailureReason };

export function isUmkmproIntegrationConfigured(): boolean {
  return !!serverEnv.umkmpro.serviceToken;
}

/**
 * Verifies a request against the shared UMKMPRO_SERVICE_TOKEN. Callers must
 * pass the exact raw request body text (read via `request.text()` *before*
 * any JSON.parse) — signing over the parsed-and-restringified body would
 * silently accept a body UMKMpro never actually sent.
 */
export function verifyUmkmproRequest(headers: Headers, rawBody: string): UmkmproAuthResult {
  const secret = serverEnv.umkmpro.serviceToken;
  if (!secret) {
    return { ok: false, reason: "NOT_CONFIGURED" };
  }

  const result = verifyUmkmproSignature({
    timestamp: headers.get(UMKMPRO_TIMESTAMP_HEADER),
    signature: headers.get(UMKMPRO_SIGNATURE_HEADER),
    rawBody,
    secret,
  });

  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
