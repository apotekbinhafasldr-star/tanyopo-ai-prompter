import "server-only";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { verifyUmkmproRequest } from "@/lib/umkmpro/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/api/response";

/**
 * Shared request handling for every /api/v1/integrations/umkmpro/* route:
 * read the raw body once (needed for signature verification — see
 * lib/umkmpro/auth.ts for why it must be the exact bytes, not a
 * re-stringified JSON.parse), verify the HMAC signature, apply a
 * best-effort rate limit, and hand back a ready service-role client.
 *
 * Best-effort rate limit: 60 requests/minute per route, process-local (see
 * lib/rate-limit.ts) — generous enough for legitimate sync traffic, a real
 * (if imperfect) backstop against a runaway retry loop.
 */
const RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface AuthorizedUmkmproRequest {
  rawBody: string;
  admin: SupabaseClient<Database>;
}

export async function authorizeUmkmproRequest(
  request: NextRequest,
  routeName: string,
): Promise<AuthorizedUmkmproRequest | Response> {
  const rawBody = await request.text();

  const auth = verifyUmkmproRequest(request.headers, rawBody);
  if (!auth.ok) {
    if (auth.reason === "NOT_CONFIGURED") {
      return apiError(
        "NOT_CONFIGURED",
        "Integrasi UMKMpro AI belum dikonfigurasi (UMKMPRO_SERVICE_TOKEN kosong).",
        503,
      );
    }
    return apiError(
      "UNAUTHORIZED",
      `Tanda tangan permintaan tidak valid (${auth.reason}).`,
      401,
    );
  }

  const rateLimit = checkRateLimit(`umkmpro:${routeName}`, RATE_LIMIT_PER_MINUTE, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return apiError("RATE_LIMITED", "Terlalu banyak permintaan. Coba lagi nanti.", 429, {
      resetAt: new Date(rateLimit.resetAt).toISOString(),
    });
  }

  const admin = createAdminClient();
  if (!admin) {
    return apiError(
      "NOT_CONFIGURED",
      "Server belum dikonfigurasi (SUPABASE_SECRET_KEY kosong).",
      503,
    );
  }

  return { rawBody, admin };
}

export function parseJsonBody(rawBody: string): { ok: true; data: unknown } | { ok: false } {
  try {
    return { ok: true, data: JSON.parse(rawBody) };
  } catch {
    return { ok: false };
  }
}
