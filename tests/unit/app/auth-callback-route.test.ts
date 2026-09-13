import { describe, expect, it, vi, beforeEach } from "vitest";

const { exchangeCodeForSessionMock } = vi.hoisted(() => ({
  exchangeCodeForSessionMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionMock },
  })),
}));

import { GET } from "@/app/auth/callback/route";

function requestFor(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

describe("GET /auth/callback — B12 regression: password recovery (this route's only caller)", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset();
  });

  it("no explicit next defaults to /reset-password", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });

    const res = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/callback?code=recovery-code"));

    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("recovery-code");
    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/reset-password");
  });

  it("an expired/invalid/reused code fails the exchange and never lands on a page that assumes a session", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: { message: "invalid or expired code" } });

    const res = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/callback?code=expired"));

    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/forgot-password?error=expired");
  });

  it("no code at all redirects to the error state without ever calling Supabase", async () => {
    const res = await GET(requestFor("https://tanyopo-ai-prompter.netlify.app/auth/callback"));

    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://tanyopo-ai-prompter.netlify.app/forgot-password?error=expired");
  });
});
