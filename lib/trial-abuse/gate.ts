import "server-only";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { readTrialAbuseConfig, type TrialAbuseConfig } from "./config";
import { coarseIp, normalizeEmail, pseudonym } from "./pseudonym";
import { canonicalSignals, parseDeviceSignals, platformFamily } from "./signals";

export const DEVICE_COOKIE = "lnx_dv";
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const COOKIE_VALUE = /^[A-Za-z0-9_-]{43}$/;

export const SUPPORT_EMAIL_HINT = "tanyopofuturetechnology@gmail.com";

/** Random, first-party, per-browser value. Carries no user data; clearing cookies resets it. */
export function newDeviceCookieValue(): string {
  return randomBytes(32).toString("base64url");
}

export function isValidDeviceCookie(v: string | undefined): v is string {
  return typeof v === "string" && COOKIE_VALUE.test(v);
}

export type TrialGateResult =
  /** Off, shadow (never blocks), or enforce decided ALLOW/REVIEW. review=true only from enforce. */
  | { action: "proceed"; attemptId: string | null; review: boolean }
  | { action: "block"; reason: "RATE_LIMITED" | "REPEAT_TRIAL" | "UNAVAILABLE" | "MISCONFIGURED"; retryAfterSeconds?: number };

export interface TrialGateInput {
  email: string;
  clientIp: string;
  userAgent: string | null;
  /** Value of the hidden "deviceSignals" field (untrusted). */
  rawSignals: unknown;
  /** Existing device cookie from the request (untrusted), if any. */
  cookieValue: string | undefined;
}

export interface TrialGateDeps {
  config?: TrialAbuseConfig;
  admin?: ReturnType<typeof createAdminClient>;
}

/**
 * Runs the signup gate. Contract:
 *  - off      : returns proceed immediately; touches neither the network nor the database.
 *  - shadow   : never blocks; every error is swallowed and logged (fail-open by design, measurement only).
 *  - enforce  : every failure path blocks (fail-closed). Missing secret, missing admin client, RPC error,
 *               malformed response all result in "block".
 *  - invalid mode: blocks (misconfiguration must not silently disable the control).
 */
export async function runTrialGate(input: TrialGateInput, deps: TrialGateDeps = {}): Promise<TrialGateResult> {
  const config = deps.config ?? readTrialAbuseConfig();
  if (config.mode === "off") return { action: "proceed", attemptId: null, review: false };
  if (config.mode === "invalid") return { action: "block", reason: "MISCONFIGURED" };

  const shadow = config.mode === "shadow";
  const failure: TrialGateResult = shadow
    ? { action: "proceed", attemptId: null, review: false }
    : { action: "block", reason: "UNAVAILABLE" };

  if (!config.secret) {
    console.error("[trial-abuse] secret missing or too short; mode=%s", config.mode);
    return failure;
  }
  const admin = deps.admin === undefined ? createAdminClient() : deps.admin;
  if (!admin) {
    console.error("[trial-abuse] admin client not configured; mode=%s", config.mode);
    return failure;
  }

  try {
    const secret = config.secret;
    const emailHmac = pseudonym(secret, "email", normalizeEmail(input.email));
    const cookieHmac = isValidDeviceCookie(input.cookieValue) ? pseudonym(secret, "cookie", input.cookieValue) : null;
    const signals = parseDeviceSignals(input.rawSignals);
    const deviceHmac = signals
      ? pseudonym(secret, "device", canonicalSignals(signals, platformFamily(input.userAgent)))
      : null;
    const ip = coarseIp(input.clientIp);
    const ipHmac = ip ? pseudonym(secret, "ip", ip) : null;

    const { data, error } = await admin.rpc("fn_trial_signup_gate", {
      p_mode: config.mode,
      p_key_version: config.keyVersion,
      p_email_hmac: emailHmac,
      p_cookie_hmac: cookieHmac,
      p_device_hmac: deviceHmac,
      p_ip_hmac: ipHmac,
    });
    if (error) {
      console.error("[trial-abuse] gate rpc failed: %s", error.code ?? "unknown");
      return failure;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || !["ALLOW", "REVIEW", "DENY"].includes(row.decision)) {
      console.error("[trial-abuse] gate returned an unexpected shape");
      return failure;
    }

    if (shadow) {
      return { action: "proceed", attemptId: row.attempt_id, review: false };
    }
    if (row.decision === "DENY") {
      const limited = row.reasons.some((r) => r.startsWith("RATE_"));
      return limited
        ? { action: "block", reason: "RATE_LIMITED", retryAfterSeconds: row.retry_after_seconds }
        : { action: "block", reason: "REPEAT_TRIAL" };
    }
    return { action: "proceed", attemptId: row.attempt_id, review: row.decision === "REVIEW" };
  } catch (err) {
    console.error("[trial-abuse] gate threw: %s", err instanceof Error ? err.name : "unknown");
    return failure;
  }
}

/** Links (or aborts) the attempt after supabase.auth.signUp. Never throws; one retry on failure. */
export async function finalizeTrialAttempt(
  attemptId: string | null,
  userId: string | null,
  signedUp: boolean,
  deps: Pick<TrialGateDeps, "admin"> = {},
): Promise<boolean> {
  if (!attemptId) return false;
  const admin = deps.admin === undefined ? createAdminClient() : deps.admin;
  if (!admin) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await admin.rpc("fn_trial_signup_finalize", {
        p_attempt_id: attemptId,
        p_user_id: signedUp ? userId : null,
        p_signed_up: signedUp,
      });
      if (!error) return data === true;
      console.error("[trial-abuse] finalize rpc failed: %s", error.code ?? "unknown");
    } catch {
      console.error("[trial-abuse] finalize threw");
    }
  }
  return false;
}

export function blockedMessage(result: Extract<TrialGateResult, { action: "block" }>): string {
  switch (result.reason) {
    case "RATE_LIMITED": {
      const mins = Math.max(1, Math.ceil((result.retryAfterSeconds ?? 60) / 60));
      return `Terlalu banyak percobaan pendaftaran. Silakan coba lagi sekitar ${mins} menit lagi.`;
    }
    case "REPEAT_TRIAL":
      return `Pendaftaran baru dari perangkat ini tidak dapat diproses otomatis. Jika Anda merasa ini keliru, hubungi ${SUPPORT_EMAIL_HINT} dan kami akan membantu.`;
    default:
      return "Pendaftaran sedang tidak dapat diproses. Silakan coba lagi beberapa saat lagi.";
  }
}

export const REVIEW_INFO =
  `Akun Anda dibuat. Sebelum masa uji coba aktif, kami perlu verifikasi singkat untuk menjaga layanan tetap adil. Hubungi ${SUPPORT_EMAIL_HINT} dan sebutkan email pendaftaran Anda, kami akan membantu.`;
