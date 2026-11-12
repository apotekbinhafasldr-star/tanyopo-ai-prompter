import { describe, expect, it, vi, beforeEach } from "vitest";

const { verifyOtpMock } = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { verifyOtp: verifyOtpMock },
  })),
}));

import { GET } from "@/app/auth/confirm/route";

function requestFor(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

describe("GET /auth/confirm — B12 signup confirmation (token_hash + type, bypasses the Redirect URLs allow list)", () => {
  beforeEach(() => {
    verifyOtpMock.mockReset();
  });

  it("a valid signup token_hash verifies and redirects to the requested next", async () => {
    verifyOtpMock.mockResolvedValue({ error: null });

    const res = await GET(
      requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=th_1&type=signup&next=/onboarding"),
    );

    expect(verifyOtpMock).toHaveBeenCalledWith({ type: "signup", token_hash: "th_1" });
    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/onboarding");
  });

  it("falls back to /dashboard when no next is supplied", async () => {
    verifyOtpMock.mockResolvedValue({ error: null });

    const res = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=th_2&type=signup"));

    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/dashboard");
  });

  it("rejects an open-redirect attempt in next (protocol-relative //evil.com) and falls back to /dashboard", async () => {
    verifyOtpMock.mockResolvedValue({ error: null });

    const res = await GET(
      requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=th_3&type=signup&next=//evil.com"),
    );

    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/dashboard");
  });

  it("an expired/invalid token fails verifyOtp and redirects to /login, never assuming a session exists", async () => {
    verifyOtpMock.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });

    const res = await GET(
      requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=th_4&type=signup&next=/onboarding"),
    );

    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/login?notice=link_invalid");
  });

  it("missing token_hash or type redirects to /login without ever calling Supabase", async () => {
    const res = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?type=signup"));

    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/login?notice=link_invalid");
  });
});

describe("GET /auth/confirm — auth recovery notices", () => {
  beforeEach(() => verifyOtpMock.mockReset());

  it("otp_expired mengarah ke /login?notice=link_expired, kode lain ke link_invalid", async () => {
    verifyOtpMock.mockResolvedValue({ error: { code: "otp_expired", message: "expired" } });
    const expired = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=t&type=signup"));
    expect(expired.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/login?notice=link_expired");

    verifyOtpMock.mockResolvedValue({ error: { code: "otp_disabled", message: "x" } });
    const other = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=t&type=signup"));
    expect(other.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/login?notice=link_invalid");
  });

  it("kode notice bukan hasil pantulan input pengguna", async () => {
    const res = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=t&type=%3Cscript%3E"));
    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/login?notice=link_invalid");
  });
});

describe("GET /auth/confirm — Stage A hardening: only the type this app sends is verified", () => {
  beforeEach(() => {
    verifyOtpMock.mockReset();
    verifyOtpMock.mockResolvedValue({ error: null });
  });

  it.each(["recovery", "invite", "magiclink", "email_change", "email", "bogus"])(
    "type=%s is refused: /login, and Supabase is never asked to verify it",
    async (type) => {
      const res = await GET(requestFor(`https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=th&type=${type}&next=/onboarding`));
      expect(verifyOtpMock).not.toHaveBeenCalled();
      expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/login?notice=link_invalid");
    },
  );

  it.each(["/\\evil.com", "https://evil.com", "//evil.com"])("next=%s never leaves the app (falls back to /dashboard)", async (next) => {
    const res = await GET(
      requestFor(`https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=th&type=signup&next=${encodeURIComponent(next)}`),
    );
    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/dashboard");
  });

  it("the existing signup link still verifies exactly as before", async () => {
    const res = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?token_hash=th_ok&type=signup&next=/onboarding"));
    expect(verifyOtpMock).toHaveBeenCalledWith({ type: "signup", token_hash: "th_ok" });
    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/onboarding");
  });
});
