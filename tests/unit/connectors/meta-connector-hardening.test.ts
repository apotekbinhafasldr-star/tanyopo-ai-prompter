import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { metaEnv } = vi.hoisted(() => ({
  metaEnv: {
    appId: "app123" as string | undefined,
    appSecret: "secret123" as string | undefined,
    redirectUri: "https://app.example.com/callback" as string | undefined,
    loginConfigId: undefined as string | undefined,
  },
}));

vi.mock("@/lib/env", () => ({
  serverEnv: { meta: metaEnv },
  isConnectorConfigured: (credentials: Record<string, string | undefined>) =>
    Object.values(credentials).every((v) => !!v && v.length > 0),
}));

import { MetaConnector } from "@/lib/connectors/meta-connector";
import { ConnectorApiError, ConnectorConfigError } from "@/lib/connectors/types";
import { classifyCreateFailure } from "@/lib/campaigns/launch-reconciliation";

const TOKEN = "token-hardening-abc";

type StubResponse = { ok: boolean; status: number; json: () => Promise<unknown>; headers?: { get: (name: string) => string | null } };

const okResponse = (body: unknown): StubResponse => ({ ok: true, status: 200, json: async () => body });
const errorResponse = (
  error: { message: string; code?: number; error_subcode?: number },
  status = 400,
  retryAfter?: string,
): StubResponse => ({
  ok: false,
  status,
  json: async () => ({ error }),
  ...(retryAfter === undefined ? {} : { headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? retryAfter : null) } }),
});

/** Answers by call order (the last answer repeats) and records every call. */
function stubFetch(responses: StubResponse[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return responses[Math.min(calls.length - 1, responses.length - 1)];
    }),
  );
  return calls;
}

/** Makes back-off instant and records the requested delays. */
function instantSleep() {
  const delays: number[] = [];
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
  return delays;
}

const THROTTLE = { message: "Too many calls", code: 17 };

beforeEach(() => {
  metaEnv.appId = "app123";
  metaEnv.appSecret = "secret123";
  metaEnv.redirectUri = "https://app.example.com/callback";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Graph API version", () => {
  it("requests go to v25.0 (Marketing API latest per Meta's version table, 2026-11-11), never the expired v21.0", async () => {
    const calls = stubFetch([okResponse({ data: [] })]);
    await new MetaConnector().getPages(TOKEN);
    expect(calls[0].url).toContain("https://graph.facebook.com/v25.0/me/accounts");
    expect(calls[0].url).not.toContain("v21.0");
  });

  it("the OAuth dialog uses the same version", () => {
    const url = new URL(new MetaConnector().getAuthorizationUrl("s"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
  });
});

describe("back-off for throttled non-create calls", () => {
  it("retries a throttled read once and returns the later success", async () => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse(THROTTLE), okResponse({ data: [{ id: "p1", name: "Toko" }] })]);
    const pages = await new MetaConnector().getPages(TOKEN);
    expect(pages).toEqual([{ id: "p1", name: "Toko" }]);
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([1000]);
  });

  it("gives up after two retries with exponential delays and throws the structured error", async () => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse(THROTTLE)]);
    const error = await new MetaConnector().getPages(TOKEN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect(error).toMatchObject({ status: 400, code: 17 });
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it("honours Retry-After on a 429", async () => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse({ message: "slow down" }, 429, "3"), okResponse({ data: [] })]);
    await new MetaConnector().getPages(TOKEN);
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([3000]);
  });

  it("does not wait inside the request for a long Retry-After", async () => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse({ message: "slow down" }, 429, "120")]);
    await expect(new MetaConnector().getPages(TOKEN)).rejects.toBeInstanceOf(ConnectorApiError);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it.each([
    ["an ordinary API error (code 100)", errorResponse({ message: "Invalid parameter", code: 100 })],
    ["an expired token (code 190)", errorResponse({ message: "token", code: 190 }, 401)],
    ["a server error", errorResponse({ message: "oops" }, 500)],
    ["Meta's abuse-prevention 613 (no subcode)", errorResponse({ message: "613", code: 613 })],
    ["the hourly ad set budget limit (613/1487632)", errorResponse({ message: "613", code: 613, error_subcode: 1487632 })],
  ])("never retries %s", async (_label, response) => {
    const delays = instantSleep();
    const calls = stubFetch([response]);
    await expect(new MetaConnector().getPages(TOKEN)).rejects.toBeInstanceOf(ConnectorApiError);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("a success on the first call never sleeps", async () => {
    const delays = instantSleep();
    const calls = stubFetch([okResponse({ data: [] })]);
    await new MetaConnector().getPages(TOKEN);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("also retries the idempotent PAUSE write", async () => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse({ message: "app limit", code: 4 }), okResponse({ success: true })]);
    await new MetaConnector().pauseCampaign(TOKEN, "act_1", "123");
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([1000]);
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ status: "PAUSED" });
  });

  it("the thrown provider message is unchanged (callers branch on structured fields only)", async () => {
    instantSleep();
    stubFetch([errorResponse({ message: "Application request limit reached", code: 4 })]);
    await expect(new MetaConnector().getPages(TOKEN)).rejects.toThrow("Application request limit reached");
  });
});

describe("CREATE calls are never retried", () => {
  it.each([
    ["createCampaign", (c: MetaConnector) => c.createCampaign(TOKEN, "act_1", { name: "n", objective: "OUTCOME_AWARENESS", dailyBudgetMinorUnits: 1000 })],
    [
      "createAdSet",
      (c: MetaConnector) =>
        c.createAdSet(TOKEN, "act_1", {
          campaignId: "1",
          name: "n",
          dailyBudgetMinorUnits: 1000,
          targetingCountries: ["ID"],
          optimizationGoal: "REACH",
        }),
    ],
    [
      "createCreative",
      (c: MetaConnector) =>
        c.createCreative(TOKEN, "act_1", {
          name: "n",
          headline: "h",
          primaryText: "p",
          cta: "LEARN_MORE",
          linkUrl: "https://toko.example.com",
          imageUrl: "https://img.example.com/a.jpg",
          pageId: "42",
        }),
    ],
    ["createAd", (c: MetaConnector) => c.createAd(TOKEN, "act_1", { name: "n", adSetId: "1", creativeId: "2" })],
  ])("%s: a throttle answer makes exactly one request, no sleep, and is reported as NOT created", async (_name, call) => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse(THROTTLE)]);
    const error = await call(new MetaConnector()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(classifyCreateFailure(error)).toBe("NOT_CREATED");
  });
});

describe("createAdSet end_time", () => {
  const baseInput = {
    campaignId: "123",
    name: "Ad Set",
    dailyBudgetMinorUnits: 50_000,
    targetingCountries: ["ID"],
    optimizationGoal: "REACH",
  };

  it("sends end_time next to daily_budget, never lifetime_budget, and keeps the ad set PAUSED", async () => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    await new MetaConnector().createAdSet(TOKEN, "act_1", { ...baseInput, endTimeUnixSeconds: 1_800_000_000 });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(calls[0].url).toContain("/act_1/adsets");
    expect(body).toMatchObject({ daily_budget: 50_000, end_time: 1_800_000_000, status: "PAUSED" });
    expect(body).not.toHaveProperty("lifetime_budget");
  });

  it("without endTimeUnixSeconds the payload has no end_time (unchanged behaviour)", async () => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    await new MetaConnector().createAdSet(TOKEN, "act_1", baseInput);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).not.toHaveProperty("end_time");
    expect(body).not.toHaveProperty("lifetime_budget");
    expect(body.daily_budget).toBe(50_000);
  });

  it.each([0, -5, 1.5, Number.NaN, "1800000000", null])("an invalid end time %j is refused before any request", async (value) => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    const error = await new MetaConnector()
      .createAdSet(TOKEN, "act_1", { ...baseInput, endTimeUnixSeconds: value as unknown as number })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });
});
