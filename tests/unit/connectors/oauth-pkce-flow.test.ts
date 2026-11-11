// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The shared OAuth handlers with the real XConnector (injected fake fetch, flag
 * forced on only inside the test) through the real route files. No network, no
 * database: getAccounts is stubbed to [] so a callback that gets past the
 * token exchange ends in `no_ad_account` before any write.
 */

const h = vi.hoisted(() => ({
  session: { tenantId: "t1", userId: "u1", role: "owner" } as any,
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string; opts: any }[],
  deletes: [] as string[],
  connector: null as any,
}));

vi.mock("@/services/session", () => ({ requireSessionContext: async () => h.session }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { value: h.jar.get(name) } : undefined),
    set: (name: string, value: string, opts: any) => {
      h.jar.set(name, value);
      h.sets.push({ name, value, opts });
    },
    delete: (name: string) => {
      h.deletes.push(name);
      h.jar.delete(name);
    },
  }),
}));

vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: () => h.connector }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/env", () => ({
  serverEnv: {
    x: { clientId: "cid", clientSecret: "sec", redirectUri: "https://app.example/api/connections/x/callback" },
  },
  isConnectorConfigured: (c: Record<string, string | undefined>) => Object.values(c).every((v) => !!v),
}));

import { GET as xAuthorize } from "@/app/api/connections/x/authorize/route";
import { GET as xCallback } from "@/app/api/connections/x/callback/route";
import { XConnector } from "@/lib/connectors/x-connector";
import { createXClient } from "@/lib/connectors/x-api-client";
import { deriveCodeChallenge } from "@/lib/connectors/x-pkce";

const STATE_COOKIE = "x_oauth_state";
const VERIFIER_COOKIE = "x_oauth_verifier";
const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

let tokenRequests: { url: string; body: string }[];

function makeConnector(pkceWired: boolean) {
  const client = createXClient({
    fetch: async (url, init) => {
      tokenRequests.push({ url, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ access_token: "AT-SECRET", refresh_token: "RT-SECRET", expires_in: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    sleep: async () => {},
  });
  return Object.assign(new XConnector(client, { pkceWired }), { getAccounts: async () => [] });
}

const req = (path: string) => new NextRequest(`https://app.example${path}`);
const location = (res: Response) => new URL(res.headers.get("location") as string);

async function startAuthorize() {
  const res = await xAuthorize(req("/api/connections/x/authorize"));
  const url = location(res);
  const state = url.searchParams.get("state") as string;
  const verifierCookie = h.jar.get(VERIFIER_COOKIE) as string;
  const verifier = verifierCookie.split(":")[2];
  return { res, url, state, verifierCookie, verifier };
}

const callback = (state: string, code = "AUTH-CODE") =>
  xCallback(req(`/api/connections/x/callback?code=${code}&state=${state}`));

let logs: string[];

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64"); // throwaway test key
  h.session = { tenantId: "t1", userId: "u1", role: "owner" };
  h.jar.clear();
  h.sets.length = 0;
  h.deletes.length = 0;
  tokenRequests = [];
  h.connector = makeConnector(true);
  logs = [];
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logs.push(JSON.stringify(args));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("X authorize with PKCE (flag on, tests only)", () => {
  it("sends only the S256 challenge to X and keeps the verifier in an httpOnly cookie bound to state and tenant", async () => {
    const { url, state, verifierCookie, verifier } = await startAuthorize();

    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(deriveCodeChallenge(verifier));
    expect(url.toString()).not.toContain(verifier);

    expect(h.sets.map((s) => s.name)).toEqual([STATE_COOKIE, VERIFIER_COOKIE]);
    expect(verifierCookie).toBe(`${state}:t1:${verifier}`);
    for (const s of h.sets) {
      expect(s.opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });
      expect(s.opts.domain).toBeUndefined();
    }
  });

  it("mints a fresh state and verifier on every start", async () => {
    const a = await startAuthorize();
    const b = await startAuthorize();
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it("is fail-closed while the wiring flag is off: not_configured, no cookie, no URL", async () => {
    h.connector = makeConnector(false);
    const res = await xAuthorize(req("/api/connections/x/authorize"));
    expect(location(res).pathname).toBe("/connections");
    expect(location(res).searchParams.get("error")).toBe("not_configured");
    expect(h.sets).toHaveLength(0);
  });

  it("stays owner-only and refuses without an encryption key, with no cookie in both cases", async () => {
    h.session = { tenantId: "t1", userId: "u2", role: "member" };
    let res = await xAuthorize(req("/api/connections/x/authorize"));
    expect(location(res).searchParams.get("error")).toBe("owner_required");

    h.session = { tenantId: "t1", userId: "u1", role: "owner" };
    delete process.env.TOKEN_ENCRYPTION_KEY;
    res = await xAuthorize(req("/api/connections/x/authorize"));
    expect(location(res).searchParams.get("error")).toBe("encryption_not_configured");
    expect(h.sets).toHaveLength(0);
  });
});

describe("X callback with PKCE", () => {
  it("passes the stored verifier to the token exchange exactly once and clears both cookies", async () => {
    const { state, verifier } = await startAuthorize();
    const res = await callback(state);

    expect(tokenRequests).toHaveLength(1);
    const body = new URLSearchParams(tokenRequests[0].body);
    expect(body.get("code_verifier")).toBe(verifier);
    expect(body.get("code")).toBe("AUTH-CODE");
    // Reached past the exchange (no account in the stub), without writing anything.
    expect(location(res).searchParams.get("error")).toBe("no_ad_account");
    expect(h.jar.has(STATE_COOKIE)).toBe(false);
    expect(h.jar.has(VERIFIER_COOKIE)).toBe(false);
  });

  it("rejects a replayed callback: nothing is left to finish it", async () => {
    const { state } = await startAuthorize();
    await callback(state);
    const replay = await callback(state);
    expect(location(replay).searchParams.get("error")).toBe("invalid_state");
    expect(tokenRequests).toHaveLength(1);
  });

  it("rejects when the verifier cookie is missing, without spending the code", async () => {
    const { state } = await startAuthorize();
    h.jar.delete(VERIFIER_COOKIE);
    const res = await callback(state);
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenRequests).toHaveLength(0);
  });

  it("rejects a verifier bound to a different state", async () => {
    const first = await startAuthorize();
    const second = await startAuthorize();
    h.jar.set(VERIFIER_COOKIE, first.verifierCookie); // verifier of the older authorization
    const res = await callback(second.state);
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenRequests).toHaveLength(0);
  });

  it("rejects a verifier cookie minted for another tenant", async () => {
    const { state, verifier } = await startAuthorize();
    h.jar.set(VERIFIER_COOKIE, `${state}:t-other:${verifier}`);
    const res = await callback(state);
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenRequests).toHaveLength(0);
  });

  it("rejects a session of another tenant using cookies minted for t1", async () => {
    const { state } = await startAuthorize();
    h.session = { tenantId: "t2", userId: "u9", role: "owner" };
    const res = await callback(state);
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenRequests).toHaveLength(0);
  });

  it.each([
    ["too short", "abc"],
    ["bad characters", "x".repeat(42) + "!"],
  ])("rejects a malformed verifier (%s)", async (_label, bad) => {
    const { state } = await startAuthorize();
    h.jar.set(VERIFIER_COOKIE, `${state}:t1:${bad}`);
    const res = await callback(state);
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenRequests).toHaveLength(0);
  });

  it("rejects a forged state and still clears both cookies", async () => {
    await startAuthorize();
    const res = await callback("attacker-state");
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenRequests).toHaveLength(0);
    expect(h.jar.has(STATE_COOKIE)).toBe(false);
    expect(h.jar.has(VERIFIER_COOKIE)).toBe(false);
  });

  it("clears the verifier cookie when the user denies access", async () => {
    await startAuthorize();
    const res = await xCallback(req("/api/connections/x/callback?error=access_denied"));
    expect(location(res).searchParams.get("error")).toBe("denied");
    expect(h.jar.has(VERIFIER_COOKIE)).toBe(false);
  });

  it("is fail-closed while the wiring flag is off: not_configured, code not spent", async () => {
    const { state } = await startAuthorize();
    h.connector = makeConnector(false);
    const res = await callback(state);
    expect(location(res).searchParams.get("error")).toBe("not_configured");
    expect(tokenRequests).toHaveLength(0);
  });

  it("never exposes the verifier, state, code or tokens in redirects or logs", async () => {
    const { state, verifier } = await startAuthorize();
    const res = await callback(state);
    const redirects = location(res).toString();
    const everything = redirects + logs.join("\n");
    for (const secret of [verifier, state, "AUTH-CODE", "AT-SECRET", "RT-SECRET"]) {
      expect(everything).not.toContain(secret);
    }

    // Rejection paths are logged by allowlisted reason only.
    const second = await startAuthorize();
    h.jar.delete(VERIFIER_COOKIE);
    await callback(second.state);
    const rejectionLogs = logs.join("\n");
    expect(rejectionLogs).toContain("no_verifier");
    expect(rejectionLogs).not.toContain(second.verifier);
    expect(rejectionLogs).not.toContain(second.state);
  });
});
