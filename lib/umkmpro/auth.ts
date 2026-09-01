import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Server-to-server auth for /api/v1/integrations/umkmpro/* (product spec
 * §56, docs/INTEGRATIONS.md "UMKMpro AI integration"). There is no
 * logged-in Supabase user on these requests — UMKMpro AI calls Promoter
 * directly with a shared service token, never a user session. Every
 * route handler must call requireUmkmproAuth() before touching any data
 * and use the service-role client (lib/supabase/admin.ts) to write,
 * since RLS has no policy that could authorize an unauthenticated caller.
 */
export type UmkmproAuthResult =
  | { ok: true }
  | { ok: false; reason: "NOT_CONFIGURED" | "UNAUTHORIZED" };

export function verifyUmkmproServiceToken(authorizationHeader: string | null): UmkmproAuthResult {
  const expected = serverEnv.umkmpro.serviceToken;
  if (!expected) return { ok: false, reason: "NOT_CONFIGURED" };

  const provided = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : null;
  if (!provided) return { ok: false, reason: "UNAUTHORIZED" };

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }
  return { ok: true };
}

/**
 * Webhook payloads are additionally signed (product spec §57) using the
 * same shared service token as an HMAC-SHA256 key over the raw request
 * body — this is on top of, not instead of, the bearer-token check
 * above, and is what makes a captured URL alone insufficient to forge a
 * webhook (the attacker would also need the raw body to have been
 * signed by a party holding the token).
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = serverEnv.umkmpro.serviceToken;
  if (!secret || !signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
