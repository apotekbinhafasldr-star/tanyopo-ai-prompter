import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const CALLBACK = "https://app.example.com/api/connections/tiktok/callback";

const envState = vi.hoisted(() => ({
  tiktok: {
    appId: "client_key_test" as string | undefined,
    appSecret: "client_secret_test" as string | undefined,
    redirectUri: "https://app.example.com/api/connections/tiktok/callback" as string | undefined,
  },
}));

vi.mock("@/lib/env", () => ({
  serverEnv: envState,
  isConnectorConfigured: (credentials: Record<string, string | undefined>) =>
    Object.values(credentials).every((v) => !!v && v.length > 0),
}));

import { TikTokLoginKitConnector } from "@/lib/connectors/tiktok-login-kit-connector";
import { ConnectorConfigError } from "@/lib/connectors/types";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("TikTokLoginKitConnector — configuration and URI guard", () => {
  beforeEach(() => {
    envState.tiktok.appId = "client_key_test";
    envState.tiktok.appSecret = "client_secret_test";
    envState.tiktok.redirectUri = CALLBACK;
  });

  it("is configured with all three values and a canonical redirect path", () => {
    expect(new TikTokLoginKitConnector().isConfigured()).toBe(true);
  });

  it("is not configured when any value is missing", () => {
    envState.tiktok.appSecret = undefined;
    expect(new TikTokLoginKitConnector().isConfigured()).toBe(false);
  });

  it("is not configured when the redirect path is not the canonical callback (old /tiktokiVFB… file or other page)", () => {
    envState.tiktok.redirectUri = "https://app.example.com/tiktokiVFBxYCt3jynuM9zWCeMZN7GSgt3EVUL.txt";
    const connector = new TikTokLoginKitConnector();
    expect(connector.isConfigured()).toBe(false);
    expect(() => connector.getAuthorizationUrl("s")).toThrow(ConnectorConfigError);
  });

  it("is not configured for an unparseable redirect URI", () => {
    envState.tiktok.redirectUri = "not a url";
    expect(new TikTokLoginKitConnector().isConfigured()).toBe(false);
  });
});

describe("TikTokLoginKitConnector#getAuthorizationUrl", () => {
  beforeEach(() => {
    envState.tiktok.appId = "client_key_test";
    envState.tiktok.appSecret = "client_secret_test";
    envState.tiktok.redirectUri = CALLBACK;
  });

  it("builds the Login Kit v2 URL with client_key, scope, response_type, redirect_uri, state", () => {
    const url = new URL(new TikTokLoginKitConnector().getAuthorizationUrl("state-xyz"));
    expect(`${url.origin}${url.pathname}`).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("client_key_test");
    expect(url.searchParams.get("scope")).toBe("user.info.basic");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(url.searchParams.get("state")).toBe("state-xyz");
  });

  it("does not send Marketing API params, PKCE, or Share Kit / video scopes", () => {
    const url = new URL(new TikTokLoginKitConnector().getAuthorizationUrl("s"));
    expect(url.searchParams.has("app_id")).toBe(false);
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.has("code_challenge_method")).toBe(false);
    expect(url.searchParams.get("scope")).not.toMatch(/video\./);
    expect(url.host).not.toContain("business-api");
  });
});

describe("TikTokLoginKitConnector#exchangeCodeForToken", () => {
  beforeEach(() => {
    envState.tiktok.appId = "client_key_test";
    envState.tiktok.appSecret = "client_secret_test";
    envState.tiktok.redirectUri = CALLBACK;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs a form-urlencoded body with redirect_uri and maps the response", async () => {
    const fetchMock = mockFetch(200, {
      access_token: "at_1",
      refresh_token: "rt_1",
      expires_in: 86400,
      scope: "user.info.basic,user.info.profile",
      open_id: "oid",
    });
    const before = Date.now();
    const result = await new TikTokLoginKitConnector().exchangeCodeForToken("code-abc");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("client_key")).toBe("client_key_test");
    expect(body.get("client_secret")).toBe("client_secret_test");
    expect(body.get("code")).toBe("code-abc");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(CALLBACK);

    expect(result.accessToken).toBe("at_1");
    expect(result.refreshToken).toBe("rt_1");
    expect(result.scopes).toEqual(["user.info.basic", "user.info.profile"]);
    expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 86400 * 1000);
  });

  it("does not double-decode or double-encode the code", async () => {
    const fetchMock = mockFetch(200, { access_token: "at" });
    const rawCode = "abc%2Bdef*1!2";
    await new TikTokLoginKitConnector().exchangeCodeForToken(rawCode);
    const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
    // Round-trips to exactly what was passed in — no extra decode/encode layer.
    expect(new URLSearchParams(init.body as string).get("code")).toBe(rawCode);
  });

  it("fails on a non-OK HTTP status", async () => {
    mockFetch(400, { error: "invalid_grant", error_description: "Authorization code expired", log_id: "L1" });
    await expect(new TikTokLoginKitConnector().exchangeCodeForToken("c")).rejects.toThrow(/Authorization code expired/);
  });

  it("fails on body.error even with HTTP 200", async () => {
    mockFetch(200, { error: "invalid_request", error_description: "bad redirect_uri", log_id: "L2" });
    await expect(new TikTokLoginKitConnector().exchangeCodeForToken("c")).rejects.toThrow(/bad redirect_uri/);
  });

  it("fails when the response has no access_token", async () => {
    mockFetch(200, {});
    await expect(new TikTokLoginKitConnector().exchangeCodeForToken("c")).rejects.toThrow(/access_token/);
  });

  it("error messages never leak the client secret, the code, or a token", async () => {
    mockFetch(400, { error: "invalid_grant", error_description: "nope", log_id: "L3" });
    let message = "";
    try {
      await new TikTokLoginKitConnector().exchangeCodeForToken("super-secret-code");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("client_secret_test");
    expect(message).not.toContain("super-secret-code");
    expect(message).not.toContain("client_key_test");
  });
});

describe("TikTokLoginKitConnector#getAccounts", () => {
  beforeEach(() => {
    envState.tiktok.appId = "client_key_test";
    envState.tiktok.appSecret = "client_secret_test";
    envState.tiktok.redirectUri = CALLBACK;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads data.user.open_id/display_name via Bearer auth and requests only those fields", async () => {
    const fetchMock = mockFetch(200, {
      data: { user: { open_id: "oid_1", display_name: " Toko A " } },
      error: { code: "ok", message: "", log_id: "L" },
    });
    const accounts = await new TikTokLoginKitConnector().getAccounts("tok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://open.tiktokapis.com/v2/user/info/?fields=open_id%2Cdisplay_name");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(accounts).toEqual([{ id: "oid_1", name: "Toko A" }]);
  });

  it("falls back to a default name when display_name is empty", async () => {
    mockFetch(200, { data: { user: { open_id: "oid_2" } }, error: { code: "ok" } });
    const accounts = await new TikTokLoginKitConnector().getAccounts("tok");
    expect(accounts[0]).toEqual({ id: "oid_2", name: "Akun TikTok" });
  });

  it("fails on an error object with a non-ok code", async () => {
    mockFetch(200, { data: {}, error: { code: "access_token_invalid", message: "bad token", log_id: "L" } });
    await expect(new TikTokLoginKitConnector().getAccounts("tok")).rejects.toThrow(/bad token/);
  });

  it("fails on empty data.user", async () => {
    mockFetch(200, { data: {}, error: { code: "ok" } });
    await expect(new TikTokLoginKitConnector().getAccounts("tok")).rejects.toThrow(/open_id/);
  });

  it("fails on empty open_id", async () => {
    mockFetch(200, { data: { user: { open_id: "" } }, error: { code: "ok" } });
    await expect(new TikTokLoginKitConnector().getAccounts("tok")).rejects.toThrow(/open_id/);
  });
});

describe("TikTokLoginKitConnector — advertising stays unavailable", () => {
  beforeEach(() => {
    envState.tiktok.appId = "client_key_test";
    envState.tiktok.appSecret = "client_secret_test";
    envState.tiktok.redirectUri = CALLBACK;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("every ad method throws ConnectorConfigError with no network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const c = new TikTokLoginKitConnector() as unknown as Record<string, () => Promise<unknown>>;
    for (const method of [
      "createCampaign",
      "createAdSet",
      "createCreative",
      "createAd",
      "getInsights",
      "pauseCampaign",
      "updateBudget",
    ]) {
      await expect(c[method]()).rejects.toBeInstanceOf(ConnectorConfigError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TikTokLoginKitConnector#disconnect", () => {
  beforeEach(() => {
    envState.tiktok.appId = "client_key_test";
    envState.tiktok.appSecret = "client_secret_test";
    envState.tiktok.redirectUri = CALLBACK;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the revoke request with client_key, client_secret and token", async () => {
    const fetchMock = mockFetch(200, {});
    await new TikTokLoginKitConnector().disconnect("tok-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://open.tiktokapis.com/v2/oauth/revoke/");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("client_key")).toBe("client_key_test");
    expect(body.get("client_secret")).toBe("client_secret_test");
    expect(body.get("token")).toBe("tok-1");
  });

  it("never throws when the revoke call fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(new TikTokLoginKitConnector().disconnect("tok")).resolves.toBeUndefined();
  });

  it("never throws when unconfigured", async () => {
    envState.tiktok.appId = undefined;
    await expect(new TikTokLoginKitConnector().disconnect("tok")).resolves.toBeUndefined();
  });
});
