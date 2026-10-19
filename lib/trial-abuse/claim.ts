import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/rate-limit";
import type { Database } from "@/types/database";
import { readTrialAbuseConfig, type TrialAbuseConfig } from "./config";
import { DEVICE_COOKIE, isValidDeviceCookie } from "./gate";
import { coarseIp, normalizeEmail, pseudonym } from "./pseudonym";

/**
 * Server-side TRIAL CLAIM: the LINOE-only gate that closes the direct-signup bypass.
 *
 * Anybody holding the public Supabase key can sign up straight against Supabase Auth and skip
 * registerAction. We do NOT touch Auth (shared with PUBLOE/Apotek/UMKMpro). Instead the LINOE trial itself
 * (a row in prompter_subscriptions, LINOE-owned) is created here, after the same gate has run, by a
 * service_role-only database function. With the database switch `claim_required` on, a client-side insert
 * can only produce an already-expired placeholder, so a direct signup never gets a free trial by itself.
 *
 *   SKIPPED     : mode is not "enforce"; the caller keeps the legacy path (nothing here ran).
 *   CREATED     : a normal 14-day trial now exists.
 *   HELD        : the account exists but its trial is held (REVIEW/DENY); support can release it.
 *   EXISTS      : a subscription already existed (idempotent).
 *   RATE_LIMITED: too many claims; nothing was created, try again later.
 *   UNAVAILABLE : anything went wrong. FAIL CLOSED: the caller must NOT grant a trial.
 */
export type TrialClaimResult = "SKIPPED" | "CREATED" | "HELD" | "EXISTS" | "RATE_LIMITED" | "UNAVAILABLE";

export interface TrialClaimDeps {
  config?: TrialAbuseConfig;
  admin?: ReturnType<typeof createAdminClient>;
  /** Test seam; defaults to the real request headers/cookies. Never throws. */
  requestContext?: () => Promise<{ ip: string; cookie: string | undefined }>;
}

async function defaultRequestContext(): Promise<{ ip: string; cookie: string | undefined }> {
  try {
    const [h, c] = await Promise.all([headers(), cookies()]);
    return { ip: getClientIp(h), cookie: c.get(DEVICE_COOKIE)?.value };
  } catch {
    // Outside a request scope: no IP/cookie signal; the gate still runs on the email pseudonym.
    return { ip: "unknown", cookie: undefined };
  }
}

export async function claimTrial(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  deps: TrialClaimDeps = {},
): Promise<TrialClaimResult> {
  const config = deps.config ?? readTrialAbuseConfig();
  if (config.mode === "off" || config.mode === "shadow") return "SKIPPED";
  if (config.mode === "invalid" || !config.secret) {
    console.error("[trial-claim] misconfigured (mode=%s, secret=%s)", config.mode, Boolean(config.secret));
    return "UNAVAILABLE";
  }
  const admin = deps.admin === undefined ? createAdminClient() : deps.admin;
  if (!admin) return "UNAVAILABLE";

  try {
    // Identity comes from the verified session, never from the caller's arguments.
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user?.id || !user.email) return "UNAVAILABLE";

    // The tenant being claimed must be the caller's own.
    const { data: profile } = await supabase.from("user_profiles").select("tenant_id").eq("id", user.id).maybeSingle();
    if (!profile || profile.tenant_id !== tenantId) return "UNAVAILABLE";

    const ctx = await (deps.requestContext ?? defaultRequestContext)();
    const secret = config.secret;
    const ip = coarseIp(ctx.ip);
    const { data, error } = await admin.rpc("fn_trial_claim", {
      p_mode: "enforce",
      p_key_version: config.keyVersion,
      p_user_id: user.id,
      p_email_hmac: pseudonym(secret, "email", normalizeEmail(user.email)),
      p_cookie_hmac: isValidDeviceCookie(ctx.cookie) ? pseudonym(secret, "cookie", ctx.cookie) : null,
      p_device_hmac: null,
      p_ip_hmac: ip ? pseudonym(secret, "ip", ip) : null,
    });
    if (error) {
      console.error("[trial-claim] rpc failed: %s", error.code ?? "unknown");
      return "UNAVAILABLE";
    }
    const row = Array.isArray(data) ? data[0] : null;
    switch (row?.outcome) {
      case "CREATED":
      case "HELD":
      case "EXISTS":
      case "RATE_LIMITED":
        return row.outcome;
      default:
        return "UNAVAILABLE";
    }
  } catch (err) {
    console.error("[trial-claim] threw: %s", err instanceof Error ? err.name : "unknown");
    return "UNAVAILABLE";
  }
}
