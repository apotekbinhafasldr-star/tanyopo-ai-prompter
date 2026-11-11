import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const env = vi.hoisted(() => ({ secret: "s".repeat(32) as string | undefined }));

vi.mock("@/lib/env", () => ({
  serverEnv: {
    demo: {
      get sessionSecret() {
        return env.secret;
      },
    },
  },
}));
vi.mock("@/lib/demo/session", () => ({
  createDemoSessionToken: () => "signed-token",
  verifyDemoSessionToken: (token: string | undefined) =>
    token === "valid-existing" ? { ok: true, session: { sessionId: "x", issuedAt: 0, expiresAt: 1 } } : { ok: false, reason: "MALFORMED" },
  DEMO_SESSION_COOKIE: "demo_session",
  DEMO_SESSION_TTL_MS: 60_000,
}));

import { GET, HEAD } from "@/app/api/demo/start/route";
import { __resetRateLimitStateForTests } from "@/lib/rate-limit";
import { DEMO_START_GLOBAL_LIMIT, DEMO_START_IP_LIMIT, DEMO_START_UNIDENTIFIED_LIMIT } from "@/lib/demo/start-guard";

function request(headers: Record<string, string>) {
  return new NextRequest("https://linoe.example/api/demo/start", { headers });
}
const fromIp = (ip: string, extra: Record<string, string> = {}) => request({ "x-nf-client-connection-ip": ip, ...extra });
const minted = (res: Response) => (res as import("next/server").NextResponse).cookies.get("demo_session") !== undefined;

describe("GET /api/demo/start abuse controls (soft-launch P0-1 + audit)", () => {
  beforeEach(() => {
    __resetRateLimitStateForTests();
    env.secret = "s".repeat(32);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues a session cookie and redirects into the demo while under the limit", async () => {
    const res = await GET(fromIp("9.9.9.1"));
    expect(res.headers.get("location")).toBe("https://linoe.example/demo/dashboard");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(minted(res)).toBe(true);
  });

  it("stops minting for one IP after the limit, with no cookie, and does not affect other IPs", async () => {
    for (let i = 0; i < DEMO_START_IP_LIMIT; i += 1) expect(minted(await GET(fromIp("9.9.9.2")))).toBe(true);
    const blocked = await GET(fromIp("9.9.9.2"));
    expect(blocked.headers.get("location")).toBe("https://linoe.example/?demo=busy");
    expect(minted(blocked)).toBe(false);
    expect(minted(await GET(fromIp("9.9.9.3")))).toBe(true);
  });

  it("resets the per-IP window after one hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    for (let i = 0; i < DEMO_START_IP_LIMIT; i += 1) await GET(fromIp("9.9.9.5"));
    expect(minted(await GET(fromIp("9.9.9.5")))).toBe(false);
    vi.setSystemTime(new Date("2026-11-11T00:59:59Z"));
    expect(minted(await GET(fromIp("9.9.9.5")))).toBe(false);
    vi.setSystemTime(new Date("2026-11-11T01:00:01Z"));
    expect(minted(await GET(fromIp("9.9.9.5")))).toBe(true);
  });

  it("is not bypassed by rotating a forged x-forwarded-for when no trusted IP exists", async () => {
    for (let i = 0; i < DEMO_START_UNIDENTIFIED_LIMIT; i += 1) {
      expect(minted(await GET(request({ "x-forwarded-for": `10.1.${i}.1` })))).toBe(true);
    }
    const blocked = await GET(request({ "x-forwarded-for": "10.99.99.99" }));
    expect(blocked.headers.get("location")).toBe("https://linoe.example/?demo=busy");
  });

  it("ignores a forged x-forwarded-for when the trusted header is present: cannot bypass, cannot lock out a victim", async () => {
    // attacker uses its own trusted IP but forges the victim's address in x-forwarded-for
    for (let i = 0; i < DEMO_START_IP_LIMIT; i += 1) await GET(fromIp("9.9.9.6", { "x-forwarded-for": "9.9.9.7" }));
    expect(minted(await GET(fromIp("9.9.9.6", { "x-forwarded-for": "9.9.9.8" })))).toBe(false);
    // the victim (real IP 9.9.9.7) is unaffected
    expect(minted(await GET(fromIp("9.9.9.7")))).toBe(true);
  });

  it("treats a malformed x-nf-client-connection-ip as untrusted (shared stricter bucket)", async () => {
    for (let i = 0; i < DEMO_START_UNIDENTIFIED_LIMIT; i += 1) await GET(fromIp(`not-an-ip-${i}`));
    expect(minted(await GET(fromIp("also bad")))).toBe(false);
    expect(minted(await GET(fromIp("9.9.9.9")))).toBe(true);
  });

  it("caps total sessions per instance even across many different IPs", async () => {
    for (let i = 0; i < DEMO_START_GLOBAL_LIMIT; i += 1) {
      expect(minted(await GET(fromIp(`172.16.${Math.floor(i / 250)}.${i % 250}`)))).toBe(true);
    }
    const blocked = await GET(fromIp("8.8.8.8"));
    expect(blocked.headers.get("location")).toBe("https://linoe.example/?demo=busy");
    expect(minted(blocked)).toBe(false);
  });

  it("sends a visitor with a valid demo cookie straight back in without minting or spending quota (shared NAT)", async () => {
    for (let i = 0; i < DEMO_START_IP_LIMIT; i += 1) await GET(fromIp("9.9.9.10"));
    const again = await GET(fromIp("9.9.9.10", { cookie: "demo_session=valid-existing" }));
    expect(again.headers.get("location")).toBe("https://linoe.example/demo/dashboard");
    expect(minted(again)).toBe(false);
    // and a cookie-holder never consumes the shared bucket
    for (let i = 0; i < 50; i += 1) await GET(fromIp("9.9.9.11", { cookie: "demo_session=valid-existing" }));
    expect(minted(await GET(fromIp("9.9.9.11")))).toBe(true);
  });

  it("does nothing and spends no quota for prefetch, sub-resource loads, HEAD and crawlers", async () => {
    const noOps = [
      fromIp("9.9.9.12", { "next-router-prefetch": "1", rsc: "1" }),
      fromIp("9.9.9.12", { "sec-purpose": "prefetch" }),
      fromIp("9.9.9.12", { purpose: "prefetch" }),
      fromIp("9.9.9.12", { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" }),
      fromIp("9.9.9.12", { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" }),
      fromIp("9.9.9.12", { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }),
    ];
    for (let round = 0; round < 3; round += 1) {
      for (const req of noOps) {
        const res = await GET(req);
        expect(res.status).toBe(204);
        expect(minted(res)).toBe(false);
      }
    }
    expect((await HEAD()).status).toBe(204);
    // quota untouched: a real navigation still gets a full allowance
    for (let i = 0; i < DEMO_START_IP_LIMIT; i += 1) {
      expect(minted(await GET(fromIp("9.9.9.12", { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" })))).toBe(true);
    }
  });

  it("still answers 'unavailable' without spending the limit when the secret is not configured", async () => {
    env.secret = undefined;
    for (let i = 0; i < 12; i += 1) {
      const res = await GET(fromIp("9.9.9.4"));
      expect(res.headers.get("location")).toBe("https://linoe.example/?demo=unavailable");
    }
    env.secret = "s".repeat(32);
    expect(minted(await GET(fromIp("9.9.9.4")))).toBe(true);
  });
});
