// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tiktokEnv } = vi.hoisted(() => ({
  tiktokEnv: {
    appId: "app123" as string | undefined,
    appSecret: "secret123" as string | undefined,
    redirectUri: "https://app.example.com/api/connections/tiktok/callback" as string | undefined,
  },
}));

vi.mock("@/lib/env", () => ({
  serverEnv: { tiktok: tiktokEnv },
  isConnectorConfigured: (credentials: Record<string, string | undefined>) =>
    Object.values(credentials).every((v) => !!v && v.length > 0),
}));

import { TikTokConnector } from "@/lib/connectors/tiktok-connector";
import { TikTokApiError } from "@/lib/connectors/tiktok-http";
import { ConnectorApiError, ConnectorConfigError } from "@/lib/connectors/types";

const sleeps: number[] = [];

function connector() {
  return new TikTokConnector({ sleep: async (ms) => void sleeps.push(ms) });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(...responses: (Response | Error)[]) {
  const queue = [...responses];
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function ok(data: unknown) {
  return json({ code: 0, message: "OK", request_id: "R", data });
}

beforeEach(() => {
  tiktokEnv.appId = "app123";
  tiktokEnv.appSecret = "secret123";
  tiktokEnv.redirectUri = "https://app.example.com/api/connections/tiktok/callback";
});

afterEach(() => {
  vi.unstubAllGlobals();
  sleeps.length = 0;
});

describe("TikTokConnector (Marketing API) — authorization", () => {
  it("builds the portal auth URL with app_id, redirect_uri and state, and no scope parameter", () => {
    const url = new URL(connector().getAuthorizationUrl("st123"));
    expect(url.origin + url.pathname).toBe("https://business-api.tiktok.com/portal/auth");
    expect(url.searchParams.get("app_id")).toBe("app123");
    expect(url.searchParams.get("redirect_uri")).toBe(tiktokEnv.redirectUri);
    expect(url.searchParams.get("state")).toBe("st123");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.has("client_key")).toBe(false);
  });

  it("is NOT_CONFIGURED and refuses every call, without touching the network, when credentials are missing", async () => {
    tiktokEnv.appSecret = undefined;
    const fetchMock = stubFetch();
    const c = connector();
    expect(c.isConfigured()).toBe(false);
    expect(() => c.getAuthorizationUrl("s")).toThrow(ConnectorConfigError);
    await expect(c.exchangeCodeForToken("code")).rejects.toThrow(ConnectorConfigError);
    await expect(c.getAccounts("t")).rejects.toThrow(ConnectorConfigError);
    await expect(c.createCampaign("t", "adv", { name: "n", objective: "TRAFFIC", dailyBudgetMinorUnits: 1 })).rejects.toThrow(ConnectorConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TikTokConnector — token exchange", () => {
  it("posts auth_code to /oauth2/access_token/ and returns the token and scopes", async () => {
    const fetchMock = stubFetch(ok({ access_token: "tok", scope: ["1", "2"] }));
    const result = await connector().exchangeCodeForToken("the-code");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/");
    expect(JSON.parse(String(init?.body))).toEqual({ app_id: "app123", secret: "secret123", auth_code: "the-code", grant_type: "authorization_code" });
    expect(result).toEqual({ accessToken: "tok", scopes: ["1", "2"] });
    expect(result.expiresAt).toBeUndefined();
  });

  it("fails on a missing access_token and on a non-zero envelope code, without leaking the secret", async () => {
    stubFetch(ok({}));
    await expect(connector().exchangeCodeForToken("c")).rejects.toThrow(/access_token/);

    stubFetch(json({ code: 40002, message: "Invalid auth_code", request_id: "R9" }));
    const error = await connector().exchangeCodeForToken("c").catch((e) => e);
    expect(error).toBeInstanceOf(TikTokApiError);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect(error.code).toBe(40002);
    expect(error.logId).toBe("R9");
    expect(error.message).not.toContain("secret123");
  });

  it("does not replay the single-use auth_code after a 5xx or network error", async () => {
    const fetchMock = stubFetch(json({ code: 50000, message: "boom" }, 502));
    await expect(connector().exchangeCodeForToken("c")).rejects.toMatchObject({ kind: "SERVER_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const netMock = stubFetch(new Error("reset"));
    await expect(connector().exchangeCodeForToken("c")).rejects.toMatchObject({ kind: "NETWORK" });
    expect(netMock).toHaveBeenCalledTimes(1);
  });
});

describe("TikTokConnector — reads", () => {
  it("getAccounts maps advertisers (string or numeric ids) and skips malformed rows", async () => {
    stubFetch(ok({ list: [{ advertiser_id: "111", advertiser_name: "Toko A" }, { advertiser_id: 222 }, { advertiser_name: "no id" }] }));
    expect(await connector().getAccounts("tok")).toEqual([
      { id: "111", name: "Toko A" },
      { id: "222", name: "222" },
    ]);
  });

  it("getAccounts sends the access token as a header and replays a transient 502", async () => {
    const fetchMock = stubFetch(json({ code: 50000, message: "bad gateway" }, 502), ok({ list: [{ advertiser_id: "1", advertiser_name: "A" }] }));
    const accounts = await connector().getAccounts("tok");
    expect(accounts).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[1][1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers["Access-Token"]).toBe("tok");
  });

  it("getAccounts errors never contain the app secret that travels in the query string", async () => {
    stubFetch(json({ code: 40105, message: "Access token is invalid" }, 401));
    const error = await connector().getAccounts("tok").catch((e) => e);
    expect(error.kind).toBe("AUTH_EXPIRED");
    expect(error.requiresReconnect).toBe(true);
    expect(JSON.stringify([error.message, error.code, error.status])).not.toContain("secret123");
  });

  it("getInsights parses metrics, tolerates an empty report and junk numbers", async () => {
    stubFetch(ok({ list: [{ metrics: { spend: "12.5", impressions: "1000", reach: "800", clicks: "abc" } }] }));
    const insights = await connector().getInsights("tok", "adv", "c1");
    expect(insights).toMatchObject({ spend: 12.5, impressions: 1000, reach: 800, clicks: 0 });

    stubFetch(ok({}));
    expect(await connector().getInsights("tok", "adv", "c1")).toMatchObject({ spend: 0, impressions: 0, reach: 0, clicks: 0 });
  });
});

describe("TikTokConnector — retry on rate limits", () => {
  it("retries HTTP 429 on a create call (the request was refused) and then succeeds", async () => {
    const fetchMock = stubFetch(json({ code: 40100, message: "Too many requests" }, 429), ok({ campaign_id: "c-1" }));
    const result = await connector().createCampaign("tok", "adv", { name: "n", objective: "TRAFFIC", dailyBudgetMinorUnits: 50000 });
    expect(result).toEqual({ id: "c-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([500]);
  });

  it("stops after 3 tries on persistent 429 and reports RATE_LIMITED (retryable, no reconnect)", async () => {
    const fetchMock = stubFetch(...Array.from({ length: 3 }, () => json({ code: 40100, message: "Too many requests" }, 429)));
    const error = await connector().getAccounts("tok").catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error.kind).toBe("RATE_LIMITED");
    expect(error.retryable).toBe(true);
    expect(error.requiresReconnect).toBe(false);
  });

  it("a create call is NOT replayed after a 5xx (outcome unknown: it may have been created)", async () => {
    const fetchMock = stubFetch(json({ code: 50000, message: "internal" }, 500));
    const error = await connector()
      .createCampaign("tok", "adv", { name: "n", objective: "TRAFFIC", dailyBudgetMinorUnits: 1 })
      .catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.kind).toBe("SERVER_ERROR");
  });
});

describe("TikTokConnector — writes stay paused", () => {
  it("createCampaign and createAd always send operation_status DISABLE", async () => {
    const fetchMock = stubFetch(ok({ campaign_id: "c1" }), ok({ ad_ids: ["ad1"] }));
    await connector().createCampaign("tok", "adv", { name: "n", objective: "TRAFFIC", dailyBudgetMinorUnits: 50000 });
    await connector().createAd("tok", "adv", { name: "ad", adSetId: "g1", creativeId: "cr1" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ operation_status: "DISABLE", budget_mode: "BUDGET_MODE_DAY" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ operation_status: "DISABLE" });
  });

  it("createCampaign / createAd fail loudly when TikTok returns no id", async () => {
    stubFetch(ok({}));
    await expect(connector().createCampaign("tok", "adv", { name: "n", objective: "TRAFFIC", dailyBudgetMinorUnits: 1 })).rejects.toThrow(/campaign_id/);
    stubFetch(ok({ ad_ids: [] }));
    await expect(connector().createAd("tok", "adv", { name: "a", adSetId: "g", creativeId: "c" })).rejects.toThrow(/ad_ids/);
  });

  it("createAdSet and createCreative still refuse (no verified location mapping / no asset upload), without network", async () => {
    const fetchMock = stubFetch();
    await expect(connector().createAdSet()).rejects.toThrow(ConnectorConfigError);
    await expect(connector().createCreative("t", "a", { name: "x", headline: "h", primaryText: "p", cta: "c" })).rejects.toThrow(ConnectorConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pauseCampaign sends DISABLE and may be replayed after a 5xx (absolute state)", async () => {
    const fetchMock = stubFetch(json({ code: 50000, message: "x" }, 503), ok({}));
    await connector().pauseCampaign("tok", "adv", "c1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ advertiser_id: "adv", campaign_ids: ["c1"], operation_status: "DISABLE" });
  });
});
