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

    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/login");
  });

  it("missing token_hash or type redirects to /login without ever calling Supabase", async () => {
    const res = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/confirm?type=signup"));

    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/login");
  });
});
