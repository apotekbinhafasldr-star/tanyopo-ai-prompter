import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * QA/Security (2026-11-11) — open redirect on /auth/callback and /auth/confirm, end to end through the route handlers.
 *
 * tests/unit/lib/safe-next.test.ts covers the helper and the two route tests cover the main cases. This adds the
 * extra vectors found while auditing (dot-segment tricks, Unicode line separators, encoded slashes, userinfo-looking
 * paths, nested `next=` inside `next`) and asserts the one property that matters: whatever the attacker sends, the
 * Location header stays on the app's own origin. Also pins that /auth/confirm refuses every OTP type except `signup`
 * without ever calling verifyOtp.
 *
 * Label: CODE + UNIT TEST (Supabase client mocked; no network).
 */
const { exchangeCodeForSessionMock, verifyOtpMock } = vi.hoisted(() => ({
  exchangeCodeForSessionMock: vi.fn(),
  verifyOtpMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionMock, verifyOtp: verifyOtpMock },
  })),
}));

import { GET as callbackGET } from "@/app/auth/callback/route";
import { GET as confirmGET } from "@/app/auth/confirm/route";
import { safeNextPath } from "@/lib/auth/safe-next";

const ORIGIN = "https://tanyopo-ai-prompter.netlify.app";

const VECTORS = [
  "//evil.example",
  "/\\evil.example",
  "https://evil.example",
  "/.//evil.example",
  "/a/..//evil.example",
  "/..//evil.example",
  "/%2e%2e//evil.example",
  "/a/%2e%2e/%2e%2e//evil.example",
  "/ //evil.example",
  "/ //evil.example",
  "/@evil.example",
  "/%2F/evil.example",
  "/.%09/evil.example",
  "/?next=//evil.example",
  "/ok#//evil.example",
  "/\t/evil.example",
  "javascript:alert(1)",
  "",
];

function req(pathAndQuery: string) {
  return new Request(`${ORIGIN}${pathAndQuery}`) as unknown as Parameters<typeof callbackGET>[0];
}

describe("security: open redirect vectors stay on the app origin", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset().mockResolvedValue({ error: null });
    verifyOtpMock.mockReset().mockResolvedValue({ error: null });
  });

  it.each(VECTORS)("safeNextPath(%j) always resolves on the app origin", (v) => {
    const out = safeNextPath(v);
    expect(out.startsWith("/")).toBe(true);
    expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
  });

  it.each(VECTORS)("/auth/callback next=%j redirects on the app origin", async (v) => {
    const res = await callbackGET(req(`/auth/callback?code=c1&next=${encodeURIComponent(v)}`));
    const location = res.headers.get("location") ?? "";
    expect(new URL(location).origin).toBe(ORIGIN);
    expect(location.startsWith(`${ORIGIN}/`)).toBe(true);
  });

  it.each(VECTORS)("/auth/confirm next=%j redirects on the app origin", async (v) => {
    const res = await confirmGET(req(`/auth/confirm?token_hash=th&type=signup&next=${encodeURIComponent(v)}`));
    const location = res.headers.get("location") ?? "";
    expect(new URL(location).origin).toBe(ORIGIN);
    expect(location.startsWith(`${ORIGIN}/`)).toBe(true);
  });

  it("/auth/callback: a rejected next falls back to /reset-password (never to an attacker path)", async () => {
    const res = await callbackGET(req(`/auth/callback?code=c1&next=${encodeURIComponent("/.//evil.example")}`));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/reset-password`);
  });

  it("failed exchange / missing code never forwards `next` at all", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: { message: "bad" } });
    const failed = await callbackGET(req(`/auth/callback?code=c1&next=${encodeURIComponent("/billing")}`));
    expect(failed.headers.get("location")).toBe(`${ORIGIN}/forgot-password?error=expired`);
    const noCode = await callbackGET(req(`/auth/callback?next=${encodeURIComponent("/billing")}`));
    expect(noCode.headers.get("location")).toBe(`${ORIGIN}/forgot-password?error=expired`);
  });

  it.each(["recovery", "magiclink", "invite", "email_change", "email", "sms", "", "SIGNUP"])(
    "/auth/confirm refuses type=%j without calling verifyOtp",
    async (type) => {
      const res = await confirmGET(req(`/auth/confirm?token_hash=th&type=${encodeURIComponent(type)}&next=/dashboard`));
      expect(verifyOtpMock).not.toHaveBeenCalled();
      expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
    },
  );
});
