"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/schemas/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  RECOVERY_IP_LIMIT,
  RECOVERY_UNIDENTIFIED_KEY,
  RECOVERY_UNIDENTIFIED_LIMIT,
  recoveryClientKey,
} from "@/lib/auth/recovery-ip";
import { RESEND_CONFIRMATION_COOLDOWN_SECONDS, RESEND_CONFIRMATION_MESSAGES } from "@/lib/auth/confirm-notice";

export interface ResendConfirmationState {
  message: string | null;
  /** "sent" and "uncertain" start the visible cooldown; the others do not. */
  outcome: "idle" | "sent" | "uncertain" | "wait" | "error";
  sentAt?: number;
}

const IP_WINDOW_MS = 60 * 60 * 1000;

function isTransportFailure(error: { name?: string; status?: number }): boolean {
  return (
    error.name === "AuthRetryableFetchError" ||
    error.name === "AuthUnknownError" ||
    error.status === 0 ||
    (error.status !== undefined && error.status >= 500)
  );
}

/**
 * Asks Supabase Auth to send the signup confirmation link again. Works with the existing "Confirm signup" template (the
 * /auth/confirm link); it does NOT depend on EMAIL_OTP_ENABLED.
 *
 * The answer never reveals whether the address exists, is unconfirmed or is already confirmed: success, "no such user"
 * and "already confirmed" all return the same message. Only throttling and transport failures differ, and those depend
 * on how often the caller asks, not on the account. Cooldown: 60 s per address and 6 per hour per trusted client IP.
 * The counters live in memory of ONE server instance: best effort, NOT a global limit (other instances and cold starts
 * count separately). The client IP comes only from Netlify's `x-nf-client-connection-ip` (never `x-forwarded-for`); with
 * no valid value, requests share one "unidentified" bucket. Supabase enforces its own per-user interval and email rate
 * limit on top (values UNKNOWN until checked in the dashboard).
 */
export async function resendConfirmationAction(
  _prev: ResendConfirmationState,
  formData: FormData,
): Promise<ResendConfirmationState> {
  const supabase = await createClient();
  try {
    const activeSession = await supabase.auth.getUser();
    if (activeSession?.data?.user) {
      return { outcome: "error", message: RESEND_CONFIRMATION_MESSAGES.signedIn };
    }
  } catch {
    // Session lookup failed (auth service unreachable): carry on as signed out; the resend call below reports "uncertain".
  }

  const parsed = loginSchema.shape.email.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { outcome: "error", message: RESEND_CONFIRMATION_MESSAGES.invalidEmail };
  }
  const email = parsed.data.toLowerCase();
  // Cooldown key ignores "+tag" so a+1@x and a+2@x cannot be used to sidestep the per-address limit.
  const cooldownKey = email.replace(/\+[^@]*(?=@)/, "");

  const client = recoveryClientKey(await headers());
  const ipLimit = client === RECOVERY_UNIDENTIFIED_KEY ? RECOVERY_UNIDENTIFIED_LIMIT : RECOVERY_IP_LIMIT;
  // IP first: a caller that is already over its IP budget must not be able to put other addresses in cooldown or grow
  // the in-memory table with new per-address keys. (Short-circuit: the per-address counter only runs when the IP allows.)
  if (
    !checkRateLimit(`confirm-resend-ip:${client}`, ipLimit, IP_WINDOW_MS).allowed ||
    !checkRateLimit(`confirm-resend-email:${cooldownKey}`, 1, RESEND_CONFIRMATION_COOLDOWN_SECONDS * 1000).allowed
  ) {
    return { outcome: "wait", message: RESEND_CONFIRMATION_MESSAGES.wait };
  }

  try {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) {
      if (error.status === 429 || error.code?.includes("rate_limit")) {
        return { outcome: "wait", message: RESEND_CONFIRMATION_MESSAGES.wait };
      }
      if (isTransportFailure(error)) {
        return { outcome: "uncertain", message: RESEND_CONFIRMATION_MESSAGES.uncertain, sentAt: Date.now() };
      }
      // Any other 4xx (unknown address, already confirmed, ...) is deliberately indistinguishable from success.
    }
  } catch {
    return { outcome: "uncertain", message: RESEND_CONFIRMATION_MESSAGES.uncertain, sentAt: Date.now() };
  }

  return { outcome: "sent", message: RESEND_CONFIRMATION_MESSAGES.sent, sentAt: Date.now() };
}
