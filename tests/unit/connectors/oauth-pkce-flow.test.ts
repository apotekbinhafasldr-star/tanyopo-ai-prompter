// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  paths: new Map<string, string>(),
  sets: [] as { name: string; value: string; opts: any }[],
  deletes: [] as string[],
  connector: null as any,
}));

vi.mock("@/services/session", () => ({ requireSessionContext: async () => h.session }));

vi.mock("next/headers", () => ({
  // Models the browser: a cookie is only sent to the callback route if its Path covers it,
  // and is only removed by a delete that names the same Path.
  cookies: async () => ({
    get: (name: string) => {
      const path = h.paths.get(name);
      const sent = path === undefined || path === "/" || "/api/connections/x/callback".startsWith(path);
      return h.jar.has(name) && sent ? { value: h.jar.get(name) } : undefined;
    },
    set: (name: string, value: string, opts: any) => {
      h.jar.set(name, value);
      h.paths.set(name, opts?.path ?? "/");
      h.sets.push({ name, value, opts });
    },
    delete: (arg: string | { name: string; path?: string }) => {
      const name = typeof arg === "string" ? arg : arg.name;
      const path = typeof arg === "string" ? "/" : (arg.path ?? "/");
      h.deletes.push(name);
      const setPath = h.paths.get(name);
      if (setPath === undefined || setPath === path) {
        h.jar.delete(name);
        h.paths.delete(name);
      }
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
import { handleConnectorOauthAuthorize } from "@/lib/connectors/oauth-authorize";
import { handleConnectorOauthCallback } from "@/lib/connectors/oauth-callback";
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
  const verifier = verifierCookie.split(":")[3];
  return { res, url, state, verifierCookie, verifier };
}

const callback = (state: string, code = "AUTH-CODE") =>
  xCallback(req(`/api/connections/x/callback?code=${code}&state=${state}`));

let logs: string[];

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64"); // throwaway test key
  h.session = { tenantId: "t1", userId: "u1", role: "owner" };
  h.jar.clear();
  h.paths.clear();
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
    expect(verifierCookie).toBe(`${state}:t1:u1:${verifier}`);
    for (const s of h.sets) {
      expect(s.opts).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 300 });
      expect(s.opts.domain).toBeUndefined();
    }
    // The verifier cookie is limited to the callback route; the state cookie keeps its old path.
    expect(h.sets.find((s) => s.name === VERIFIER_COOKIE)?.opts.path).toBe("/api/connections/x/callback");
    expect(h.sets.find((s) => s.name === STATE_COOKIE)?.opts.path).toBe("/");
  });

  it("uses a 256-bit CSPRNG verifier (43 base64url chars) and S256", async () => {
    const { url, verifier } = await startAuthorize();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
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
    h.jar.set(VERIFIER_COOKIE, `${state}:t-other:u1:${verifier}`);
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
    h.jar.set(VERIFIER_COOKIE, `${state}:t1:u1:${bad}`);
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

describe("verifier cookie scope and user binding", () => {
  it("rejects a callback by another user of the same tenant (shared browser)", async () => {
    const { state } = await startAuthorize(); // minted for u1
    h.session = { tenantId: "t1", userId: "u2", role: "owner" };
    const res = await callback(state);
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenRequests).toHaveLength(0);
    expect(logs.join("\n")).toContain("verifier_user_mismatch");
    expect(h.jar.has(VERIFIER_COOKIE)).toBe(false);
  });

  it("limits the verifier cookie to a path that is a real callback route", async () => {
    await startAuthorize();
    const path = h.sets.find((x) => x.name === VERIFIER_COOKIE)?.opts.path as string;
    expect(path).toBe("/api/connections/x/callback");
    expect(existsSync(`app${path}/route.ts`)).toBe(true);
  });

  it("does not delete the verifier cookie with a Path that would miss it", async () => {
    const { state } = await startAuthorize();
    await callback(state);
    expect(h.deletes).toContain(VERIFIER_COOKIE);
    expect(h.jar.has(VERIFIER_COOKIE)).toBe(false); // the mock only removes it when the Path matches
  });
});

describe("failure paths leak nothing and stay on our own origin", () => {
  it("a failing token exchange redirects safely, logs no secret, and leaves no cookie", async () => {
    const { state, verifier } = await startAuthorize();
    h.connector = Object.assign(
      new XConnector(
        createXClient({
          fetch: async (url, init) => {
            tokenRequests.push({ url, body: String(init?.body ?? "") });
            return new Response(
              JSON.stringify({ error: "invalid_request", error_description: `bad ${verifier} ${state} AUTH-CODE` }),
              { status: 400, headers: { "content-type": "application/json" } },
            );
          },
          sleep: async () => {},
        }),
        { pkceWired: true },
      ),
      { getAccounts: async () => [] },
    );
    const res = await callback(state);
    expect(tokenRequests).toHaveLength(1);
    expect(location(res).origin).toBe("https://app.example");
    expect(location(res).pathname).toBe("/connections");
    const everything = location(res).toString() + logs.join("\n");
    for (const secret of [verifier, state, "AUTH-CODE"]) expect(everything).not.toContain(secret);
    expect(h.jar.has(STATE_COOKIE)).toBe(false);
    expect(h.jar.has(VERIFIER_COOKIE)).toBe(false);
  });

  it("every rejection redirects to /connections on our origin, never to a caller-chosen URL", async () => {
    const outcomes: Response[] = [];
    let s = await startAuthorize();
    h.jar.delete(VERIFIER_COOKIE);
    outcomes.push(await callback(s.state)); // missing verifier
    s = await startAuthorize();
    outcomes.push(await callback("https://evil.example")); // forged state
    s = await startAuthorize();
    outcomes.push(await xCallback(req("/api/connections/x/callback?error=access_denied&redirect=https://evil.example")));
    s = await startAuthorize();
    h.session = { tenantId: "t1", userId: "u2", role: "owner" };
    outcomes.push(await callback(s.state)); // other user
    expect(outcomes).toHaveLength(4);
    for (const res of outcomes) {
      expect(location(res).origin).toBe("https://app.example");
      expect(location(res).pathname).toBe("/connections");
    }
  });
});

describe("the wiring flag cannot be switched on from outside (production default)", () => {
  function productionDefaultConnector() {
    const client = createXClient({
      fetch: async (url, init) => {
        tokenRequests.push({ url, body: String(init?.body ?? "") });
        return new Response("{}", { status: 200 });
      },
      sleep: async () => {},
    });
    return Object.assign(new XConnector(client), { getAccounts: async () => [] });
  }

  it("authorize refuses despite env, query and cookie input, and sets no cookie", async () => {
    vi.stubEnv("X_OAUTH_PKCE_WIRED", "true");
    h.connector = productionDefaultConnector();
    h.jar.set("X_OAUTH_PKCE_WIRED", "true");
    const res = await xAuthorize(
      req("/api/connections/x/authorize?X_OAUTH_PKCE_WIRED=true&pkceWired=true&pkce_wired=1"),
    );
    vi.unstubAllEnvs();
    expect(location(res).pathname).toBe("/connections");
    expect(location(res).searchParams.get("error")).toBe("not_configured");
    expect(h.sets).toHaveLength(0);
  });

  it("callback refuses despite fully forged state and verifier cookies, without spending the code", async () => {
    h.connector = productionDefaultConnector();
    const forgedState = "forged-state-value";
    h.jar.set(STATE_COOKIE, `${forgedState}:t1`);
    h.jar.set(VERIFIER_COOKIE, `${forgedState}:t1:u1:${"A".repeat(43)}`);
    const res = await xCallback(
      req(`/api/connections/x/callback?code=C&state=${forgedState}&X_OAUTH_PKCE_WIRED=true`),
    );
    expect(location(res).searchParams.get("error")).toBe("not_configured");
    expect(tokenRequests).toHaveLength(0);
    expect(h.jar.has(VERIFIER_COOKIE)).toBe(false);
  });
});

describe("Meta and TikTok keep the pre-PKCE behaviour through the shared handlers", () => {
  it.each([
    ["META", "meta_oauth_state", "meta_oauth_verifier", 900],
    ["TIKTOK", "tiktok_oauth_state", "tiktok_oauth_verifier", undefined],
  ] as const)("%s: only the state cookie, one-argument exchange, no verifier cookie touched", async (platform, stateName, verifierName, maxAge) => {
    const exchange = vi.fn(async (_code: string) => ({ accessToken: "AT", scopes: [] as string[] }));
    h.connector = {
      platform,
      getAuthorizationUrl: (st: string) => `https://platform.example/oauth?state=${st}`,
      exchangeCodeForToken: exchange,
      getAccounts: async () => [],
    };

    const authRes = await handleConnectorOauthAuthorize(
      req(`/api/connections/${platform.toLowerCase()}/authorize`),
      platform,
      stateName,
      maxAge ? { stateCookieMaxAgeSeconds: maxAge } : {},
    );
    expect(location(authRes).origin).toBe("https://platform.example");
    expect(h.sets.map((x) => x.name)).toEqual([stateName]);
    expect(h.sets[0].opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: maxAge ?? 300 });
    expect(location(authRes).searchParams.get("code_challenge")).toBeNull();

    const state = location(authRes).searchParams.get("state") as string;
    h.jar.set(verifierName, "must-stay-untouched");
    const cbRes = await handleConnectorOauthCallback(
      req(`/api/connections/${platform.toLowerCase()}/callback?code=C1&state=${state}`),
      platform,
      stateName,
    );
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith("C1");
    expect(location(cbRes).searchParams.get("error")).toBe("no_ad_account");
    expect(h.deletes).toEqual([stateName]);
    expect(h.jar.get(verifierName)).toBe("must-stay-untouched");
  });
});

describe("source locks", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("the flag is a literal false in code, not read from env or input", () => {
    const src = read("lib/connectors/x-connector.ts");
    expect(src).toMatch(/export const X_OAUTH_PKCE_WIRED = false;/);
    expect(src).not.toMatch(/process\.env/);
    expect(read("lib/env.ts")).not.toMatch(/PKCE_WIRED/);
    expect(read("lib/connectors/get-connector.ts")).toMatch(/new XConnector\(\)/);
  });

  it("the verifier is never logged, placed in a URL or written to the database", () => {
    for (const file of ["lib/connectors/oauth-authorize.ts", "lib/connectors/oauth-callback.ts"]) {
      const src = read(file);
      expect(src).not.toMatch(/console\.\w+\([^;]*codeVerifier/);
      expect(src).not.toMatch(/codeVerifier[^\n]*(searchParams|redirectWith|\.insert|\.upsert|\.update)/);
    }
  });
});
