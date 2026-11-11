"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { registerSchema } from "@/schemas/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAuthClientBucket } from "@/lib/security/login-throttle";
import {
  isEmailOtpEnabled,
  mapResendError,
  mapVerifyOtpError,
  normalizeOtpInput,
  OTP_MESSAGES,
  OTP_PATTERN,
  RESEND_COOLDOWN_SECONDS,
} from "@/lib/auth/email-otp";

export interface OtpActionState {
  error: string | null;
  info?: string | null;
  /** Server clock (ms) of the last accepted resend; the form restarts its 60 s countdown when it changes. */
  sentAt?: number;
}

function parseEmail(value: unknown): string | null {
  const parsed = registerSchema.shape.email.safeParse(typeof value === "string" ? value.trim() : "");
  return parsed.success ? parsed.data : null;
}

/**
 * Confirms a new account from the code in the signup email. Stage A, flag-gated (EMAIL_OTP_ENABLED).
 *
 * Success is ONLY ever "Supabase returned no error AND a session": the redirect to /onboarding happens after that and
 * nothing in this function (or the form) claims success before it. The code is never logged, never put in a URL and
 * never returned in state. No automatic retry. The in-memory limiter below is a best-effort brake on THIS endpoint
 * only; Supabase's own verification limit (per IP) is the real control, because the Auth API can be called directly.
 */
export async function verifyEmailOtpAction(_prev: OtpActionState, formData: FormData): Promise<OtpActionState> {
  if (!isEmailOtpEnabled()) return { error: OTP_MESSAGES.disabled };

  const supabase = await createClient();

  // PR #91 guard: verifyOtp() would replace a live session, so refuse while someone is signed in.
  const activeSession = await supabase.auth.getUser();
  if (activeSession?.data?.user) return { error: OTP_MESSAGES.signedIn };

  const email = parseEmail(formData.get("email"));
  if (!email) return { error: OTP_MESSAGES.invalidEmail };

  const token = normalizeOtpInput(formData.get("token"));
  if (!OTP_PATTERN.test(token)) return { error: OTP_MESSAGES.invalidFormat };

  // SEC-01: trusted IP only (never x-forwarded-for); requests without one share a single bucket.
  const bucket = getAuthClientBucket(await headers());
  if (
    !checkRateLimit(`otp-verify-ip:${bucket.key}`, bucket.identified ? 20 : 60, 5 * 60_000).allowed ||
    !checkRateLimit(`otp-verify-email:${email.toLowerCase()}`, 8, 15 * 60_000).allowed
  ) {
    return { error: OTP_MESSAGES.tooMany };
  }

  let result: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;
  try {
    result = await supabase.auth.verifyOtp({ email, token, type: "signup" });
  } catch {
    return { error: OTP_MESSAGES.uncertainVerify };
  }

  if (result.error) return { error: mapVerifyOtpError(result.error) };
  if (!result.data?.session) return { error: OTP_MESSAGES.notConfirmed };

  redirect("/onboarding");
}

/**
 * Asks Supabase Auth to send a new signup code. Cooldown: 60 s per email enforced here and shown in the form (Supabase
 * enforces its own per-user interval too). The answer never reveals whether the email exists. No automatic retry.
 */
export async function resendSignupOtpAction(_prev: OtpActionState, formData: FormData): Promise<OtpActionState> {
  if (!isEmailOtpEnabled()) return { error: OTP_MESSAGES.disabled };

  const supabase = await createClient();
  const activeSession = await supabase.auth.getUser();
  if (activeSession?.data?.user) return { error: OTP_MESSAGES.signedIn };

  const email = parseEmail(formData.get("email"));
  if (!email) return { error: OTP_MESSAGES.invalidEmail };

  const bucket = getAuthClientBucket(await headers());
  if (
    !checkRateLimit(`otp-resend-email:${email.toLowerCase()}`, 1, RESEND_COOLDOWN_SECONDS * 1000).allowed ||
    !checkRateLimit(`otp-resend-ip:${bucket.key}`, bucket.identified ? 6 : 30, 60 * 60_000).allowed
  ) {
    return { error: OTP_MESSAGES.resendWait };
  }

  try {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) return { error: mapResendError(error).message };
  } catch {
    return { error: OTP_MESSAGES.resendUncertain };
  }

  return { error: null, info: OTP_MESSAGES.resendSent, sentAt: Date.now() };
}
