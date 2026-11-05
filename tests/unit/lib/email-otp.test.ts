import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEmailOtpEnabled,
  mapResendError,
  mapVerifyOtpError,
  normalizeOtpInput,
  OTP_MESSAGES,
  OTP_PATTERN,
  RESEND_COOLDOWN_SECONDS,
} from "@/lib/auth/email-otp";

afterEach(() => vi.unstubAllEnvs());

describe("isEmailOtpEnabled — server-side flag, default OFF", () => {
  it("is OFF when unset", () => {
    vi.stubEnv("EMAIL_OTP_ENABLED", "");
    expect(isEmailOtpEnabled()).toBe(false);
  });

  it.each(["TRUE", "1", "yes", "True", " true", "false"])("is OFF for %j (only the exact string 'true' turns it on)", (v) => {
    vi.stubEnv("EMAIL_OTP_ENABLED", v);
    expect(isEmailOtpEnabled()).toBe(false);
  });

  it("is ON only for exactly 'true'", () => {
    vi.stubEnv("EMAIL_OTP_ENABLED", "true");
    expect(isEmailOtpEnabled()).toBe(true);
  });

  it("is not a NEXT_PUBLIC variable (never shipped to the browser)", () => {
    vi.stubEnv("NEXT_PUBLIC_EMAIL_OTP_ENABLED", "true");
    vi.stubEnv("EMAIL_OTP_ENABLED", "");
    expect(isEmailOtpEnabled()).toBe(false);
  });
});

describe("code format is length-agnostic (Supabase owns the length)", () => {
  it.each(["123456", "12345678", "1234567890"])("accepts %s", (code) => {
    expect(OTP_PATTERN.test(code)).toBe(true);
  });

  it.each(["", "12345", "12345678901", "1234abcd", "12 345678", "１２３４５６７８", "-12345678"])("rejects %j", (code) => {
    expect(OTP_PATTERN.test(code)).toBe(false);
  });

  it("normalizes spaces and dashes typed or pasted, never digits", () => {
    expect(normalizeOtpInput(" 1234 5678 ")).toBe("12345678");
    expect(normalizeOtpInput("1234-5678")).toBe("12345678");
    expect(normalizeOtpInput(null)).toBe("");
    expect(normalizeOtpInput(12345678)).toBe("");
  });

  it("uses a 60 second resend cooldown", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });
});

describe("error mapping is safe and never echoes raw text", () => {
  it("wrong / expired / unknown -> one neutral message", () => {
    expect(mapVerifyOtpError({ status: 403, code: "otp_expired" })).toBe(OTP_MESSAGES.wrongOrExpired);
    expect(mapVerifyOtpError({ status: 400 })).toBe(OTP_MESSAGES.wrongOrExpired);
    expect(mapVerifyOtpError({})).toBe(OTP_MESSAGES.wrongOrExpired);
  });

  it("429 / rate limit codes -> too many", () => {
    expect(mapVerifyOtpError({ status: 429 })).toBe(OTP_MESSAGES.tooMany);
    expect(mapVerifyOtpError({ code: "over_request_rate_limit" })).toBe(OTP_MESSAGES.tooMany);
  });

  it("transport failures and 5xx -> uncertain, never 'wrong code' and never success", () => {
    expect(mapVerifyOtpError({ name: "AuthRetryableFetchError", status: 0 })).toBe(OTP_MESSAGES.uncertainVerify);
    expect(mapVerifyOtpError({ status: 503 })).toBe(OTP_MESSAGES.uncertainVerify);
  });

  it("resend: 429 -> wait, transport -> may already be sent, other -> generic", () => {
    expect(mapResendError({ status: 429 }).message).toBe(OTP_MESSAGES.resendWait);
    expect(mapResendError({ name: "AuthRetryableFetchError", status: 0 }).message).toBe(OTP_MESSAGES.resendUncertain);
    expect(mapResendError({ status: 400, code: "user_not_found" }).message).toBe(OTP_MESSAGES.resendFailed);
  });

  it("resend failures do not reveal whether an email exists", () => {
    expect(mapResendError({ status: 400, code: "user_not_found" }).message).toBe(mapResendError({ status: 400 }).message);
  });
});
