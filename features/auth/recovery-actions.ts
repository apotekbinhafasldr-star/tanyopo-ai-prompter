"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/schemas/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RESEND_CONFIRMATION_COOLDOWN_SECONDS, RESEND_CONFIRMATION_MESSAGES } from "@/lib/auth/confirm-notice";

export interface ResendConfirmationState {
  message: string | null;
  /** "sent" and "uncertain" start the visible cooldown; the others do not. */
  outcome: "idle" | "sent" | "uncertain" | "wait" | "error";
  sentAt?: number;
}

const IP_LIMIT = 6;
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
 * on how often the caller asks, not on the account. Cooldown: 60 s per address and 6 per hour per client IP (in-memory,
 * best effort per server instance; Supabase enforces its own per-user interval and email rate limit as well).
 */
export async function resendConfirmationAction(
  _prev: ResendConfirmationState,
  formData: FormData,
): Promise<ResendConfirmationState> {
  const supabase = await createClient();
  const activeSession = await supabase.auth.getUser();
  if (activeSession?.data?.user) {
    return { outcome: "error", message: RESEND_CONFIRMATION_MESSAGES.signedIn };
  }

  const parsed = loginSchema.shape.email.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { outcome: "error", message: RESEND_CONFIRMATION_MESSAGES.invalidEmail };
  }
  const email = parsed.data.toLowerCase();
  // Cooldown key ignores "+tag" so a+1@x and a+2@x cannot be used to sidestep the per-address limit.
  const cooldownKey = email.replace(/\+[^@]*(?=@)/, "");

  const ip = getClientIp(await headers());
  if (
    !checkRateLimit(`confirm-resend-email:${cooldownKey}`, 1, RESEND_CONFIRMATION_COOLDOWN_SECONDS * 1000).allowed ||
    !checkRateLimit(`confirm-resend-ip:${ip}`, IP_LIMIT, IP_WINDOW_MS).allowed
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
