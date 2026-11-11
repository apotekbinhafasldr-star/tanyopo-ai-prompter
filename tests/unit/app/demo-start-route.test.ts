import { beforeEach, describe, expect, it, vi } from "vitest";
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
  DEMO_SESSION_COOKIE: "demo_session",
  DEMO_SESSION_TTL_MS: 60_000,
}));

import { GET } from "@/app/api/demo/start/route";
import { __resetRateLimitStateForTests } from "@/lib/rate-limit";

function request(ip: string) {
  return new NextRequest("https://linoe.example/api/demo/start", { headers: { "x-nf-client-connection-ip": ip } });
}

describe("GET /api/demo/start per-IP throttle (soft-launch P0-1)", () => {
  beforeEach(() => {
    __resetRateLimitStateForTests();
    env.secret = "s".repeat(32);
  });

  it("issues a session cookie and redirects into the demo while under the limit", async () => {
    const res = await GET(request("9.9.9.1"));
    expect(res.headers.get("location")).toBe("https://linoe.example/demo/dashboard");
    expect(res.cookies.get("demo_session")?.value).toBe("signed-token");
  });

  it("stops minting sessions for one IP after 10 starts, with no cookie, and does not affect other IPs", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await GET(request("9.9.9.2"))).cookies.get("demo_session")).toBeDefined();
    }
    const blocked = await GET(request("9.9.9.2"));
    expect(blocked.headers.get("location")).toBe("https://linoe.example/?demo=busy");
    expect(blocked.cookies.get("demo_session")).toBeUndefined();

    expect((await GET(request("9.9.9.3"))).cookies.get("demo_session")).toBeDefined();
  });

  it("still answers 'unavailable' without spending the limit when the secret is not configured", async () => {
    env.secret = undefined;
    for (let i = 0; i < 12; i += 1) {
      const res = await GET(request("9.9.9.4"));
      expect(res.headers.get("location")).toBe("https://linoe.example/?demo=unavailable");
    }
    env.secret = "s".repeat(32);
    expect((await GET(request("9.9.9.4"))).cookies.get("demo_session")).toBeDefined();
  });
});
