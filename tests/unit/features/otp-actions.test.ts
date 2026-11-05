import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const { rateMock } = vi.hoisted(() => ({ rateMock: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: rateMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const { verifyOtpMock, resendMock, getUserMock } = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  resendMock: vi.fn(),
  getUserMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp: verifyOtpMock, resend: resendMock, getUser: getUserMock } })),
}));

import { resendSignupOtpAction, verifyEmailOtpAction } from "@/features/auth/otp-actions";
import { OTP_MESSAGES } from "@/lib/auth/email-otp";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const EMAIL = "budi@example.com";
const CODE = "12345678";
const initial = { error: null };

beforeEach(() => {
  vi.stubEnv("EMAIL_OTP_ENABLED", "true");
  verifyOtpMock.mockReset();
  resendMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  rateMock.mockReset();
  rateMock.mockReturnValue({ allowed: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("verifyEmailOtpAction — flag", () => {
  it("OFF: refuses without touching Supabase at all", async () => {
    vi.stubEnv("EMAIL_OTP_ENABLED", "");
    const result = await verifyEmailOtpAction(initial, fd({ email: EMAIL, token: CODE }));
    expect(result.error).toBe(OTP_MESSAGES.disabled);
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
  });
});

describe("verifyEmailOtpAction — ON", () => {
  it("a correct code is verified as type 'signup' with email + token, then redirects to /onboarding", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: { access_token: "x" }, user: {} }, error: null });

    await expect(verifyEmailOtpAction(initial, fd({ email: EMAIL, token: CODE }))).rejects.toThrow("REDIRECT:/onboarding");

    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
    expect(verifyOtpMock).toHaveBeenCalledWith({ email: EMAIL, token: CODE, type: "signup" });
  });

  it("accepts a code pasted with spaces, and any plausible length (not hard-coded to 6 or 8)", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
    await expect(verifyEmailOtpAction(initial, fd({ email: EMAIL, token: "123 456" }))).rejects.toThrow("REDIRECT");
    expect(verifyOtpMock).toHaveBeenLastCalledWith({ email: EMAIL, token: "123456", type: "signup" });
  });

  it("a wrong or expired code shows a neutral error and never claims success or redirects", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: null, user: null }, error: { status: 403, code: "otp_expired", message: "Token has expired or is invalid" } });

    const result = await verifyEmailOtpAction(initial, fd({ email: EMAIL, token: CODE }));

    expect(result.error).toBe(OTP_MESSAGES.wrongOrExpired);
    expect(JSON.stringify(result)).not.toContain("Token has expired");
    expect(JSON.stringify(result)).not.toContain(CODE);
  });

  it("no error but no session is NOT success", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: null, user: { id: "u" } }, error: null });
    const result = await verifyEmailOtpAction(initial, fd({ email: EMAIL, token: CODE }));
    expect(result.error).toBe(OTP_MESSAGES.notConfirmed);
  });

  it("a thrown verifyOtp is reported as uncertain, not retried, and leaks nothing", async () => {
    verifyOtpMock.mockRejectedValue(new Error("fetch failed ECONNRESET https://x.supabase.co"));
    const result = await verifyEmailOtpAction(initial, fd({ email: EMAIL, token: CODE }));
    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBe(OTP_MESSAGES.uncertainVerify);
    expect(JSON.stringify(result)).not.toMatch(/ECONNRESET|supabase\.co/);
  });

  it("a Supabase 429 maps to 'too many attempts'", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: { status: 429, code: "over_request_rate_limit" } });
    const result = await verifyEmailOtpAction(initial, fd({ email: EMAIL, token: CODE }));
    expect(result.error).toBe(OTP_MESSAGES.tooMany);
  });

  it.each(["", "abc12345", "123", "123456789012"])("rejects a malformed code %j before any request", async (token) => {
    const result = await verifyEmailOtpAction(initial, fd({ email: EMAIL, token }));
    expect(result.error).toBe(OTP_MESSAGES.invalidFormat);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid email before any request", async () => {
    const result = await verifyEmailOtpAction(initial, fd({ email: "bukan-email", token: CODE }));
    expect(result.error).toBe(OTP_MESSAGES.invalidEmail);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("the endpoint limiter blocks before Supabase is called", async () => {
    rateMock.mockReturnValue({ allowed: false });
    const result = await verifyEmailOtpAction(initial, fd({ email: EMAIL, token: CODE }));
    expect(result.error).toBe(OTP_MESSAGES.tooMany);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("PR #91 guard: with an active session it refuses, never replacing the live session", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "lama@example.com" } }, error: null });
    const result = await verifyEmailOtpAction(initial, fd({ email: EMAIL, token: CODE }));
    expect(result.error).toBe(OTP_MESSAGES.signedIn);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});

describe("resendSignupOtpAction", () => {
  it("OFF: refuses without touching Supabase", async () => {
    vi.stubEnv("EMAIL_OTP_ENABLED", "");
    const result = await resendSignupOtpAction(initial, fd({ email: EMAIL }));
    expect(result.error).toBe(OTP_MESSAGES.disabled);
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("ON: calls resend with exactly { type: 'signup', email } — no redirect option — and answers generically", async () => {
    resendMock.mockResolvedValue({ data: {}, error: null });
    const result = await resendSignupOtpAction(initial, fd({ email: EMAIL }));

    expect(resendMock).toHaveBeenCalledTimes(1);
    expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: EMAIL });
    expect(result.error).toBeNull();
    expect(result.info).toBe(OTP_MESSAGES.resendSent);
    expect(typeof result.sentAt).toBe("number");
  });

  it("enforces the 60 second per-email cooldown before calling Supabase", async () => {
    rateMock.mockImplementation((key: string, limit: number, windowMs: number) => ({
      allowed: !(key.startsWith("otp-resend-email:") && limit === 1 && windowMs === 60_000),
    }));
    const result = await resendSignupOtpAction(initial, fd({ email: EMAIL }));
    expect(result.error).toBe(OTP_MESSAGES.resendWait);
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("a Supabase error is mapped safely and not retried", async () => {
    resendMock.mockResolvedValue({ data: {}, error: { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" } });
    const result = await resendSignupOtpAction(initial, fd({ email: EMAIL }));
    expect(resendMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBe(OTP_MESSAGES.resendWait);
    expect(JSON.stringify(result)).not.toContain("email rate limit exceeded");
  });

  it("a thrown resend says the code may already be sent, and is not retried", async () => {
    resendMock.mockRejectedValue(new Error("network down"));
    const result = await resendSignupOtpAction(initial, fd({ email: EMAIL }));
    expect(resendMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBe(OTP_MESSAGES.resendUncertain);
    expect(result.sentAt).toBeUndefined();
  });

  it("an unknown email gets the same answer as a known one (no enumeration)", async () => {
    resendMock.mockResolvedValue({ data: {}, error: null });
    const known = await resendSignupOtpAction(initial, fd({ email: "ada@example.com" }));
    const unknown = await resendSignupOtpAction(initial, fd({ email: "tidak-ada@example.com" }));
    expect(known.info).toBe(unknown.info);
    expect(known.error).toBe(unknown.error);
  });

  it("PR #91 guard: refuses with an active session", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const result = await resendSignupOtpAction(initial, fd({ email: EMAIL }));
    expect(result.error).toBe(OTP_MESSAGES.signedIn);
    expect(resendMock).not.toHaveBeenCalled();
  });
});
