import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR-1 (DORMANT methods): validate-only creates, entity status read/write,
 * pauseObject and the optional lifetime budget. fetch is mocked: no network, no
 * Meta account. Passing here does NOT prove Meta accepts these requests.
 */

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

const TOKEN = "token-pr1-abc";
const OBJECT_ID = "120210000000001";
const PROVIDER_TEXT = "SECRET-PROVIDER-TEXT echo act_999 token-pr1-abc";

type StubResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: { get: (name: string) => string | null };
};

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

/** fetch that always rejects with `error` (timeout, network failure). */
function stubFetchRejecting(error: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      throw error;
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

const timeoutError = () => Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
const THROTTLE = { message: "Too many calls", code: 17 };

const campaignInput = { name: "N", objective: "OUTCOME_AWARENESS", dailyBudgetMinorUnits: 1000 };
const adSetInput = {
  campaignId: "123",
  name: "Ad Set",
  dailyBudgetMinorUnits: 50_000,
  targetingCountries: ["ID"],
  optimizationGoal: "REACH",
};
const creativeInput = {
  name: "Cr",
  headline: "h",
  primaryText: "p",
  cta: "LEARN_MORE",
  linkUrl: "https://toko.example.com",
  imageUrl: "https://img.example.com/a.jpg",
  pageId: "42",
};
const adInput = { name: "Ad", adSetId: "1", creativeId: "2" };

const bodyOf = (call: { init: RequestInit | undefined }) => JSON.parse(String(call.init?.body));

beforeEach(() => {
  metaEnv.appId = "app123";
  metaEnv.appSecret = "secret123";
  metaEnv.redirectUri = "https://app.example.com/callback";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("create payloads without validateOnly are byte-identical to before PR-1", () => {
  it("createCampaign", async () => {
    const calls = stubFetch([okResponse({ id: "camp_1" })]);
    const result = await new MetaConnector().createCampaign(TOKEN, "act_1", campaignInput);
    expect(result).toEqual({ id: "camp_1" });
    expect(calls[0].init?.body).toBe(
      `{"name":"N","objective":"OUTCOME_AWARENESS","status":"PAUSED","special_ad_categories":[],"is_adset_budget_sharing_enabled":false,"access_token":"${TOKEN}"}`,
    );
  });

  it("createAdSet (daily budget, with and without end_time)", async () => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    const connector = new MetaConnector();
    expect(await connector.createAdSet(TOKEN, "act_1", adSetInput)).toEqual({ id: "adset_1" });
    await connector.createAdSet(TOKEN, "act_1", { ...adSetInput, endTimeUnixSeconds: 1_800_000_000 });
    const tail = `"billing_event":"IMPRESSIONS","optimization_goal":"REACH","bid_strategy":"LOWEST_COST_WITHOUT_CAP","targeting":{"geo_locations":{"countries":["ID"]}},"status":"PAUSED","access_token":"${TOKEN}"}`;
    expect(calls[0].init?.body).toBe(`{"name":"Ad Set","campaign_id":"123","daily_budget":50000,${tail}`);
    expect(calls[1].init?.body).toBe(`{"name":"Ad Set","campaign_id":"123","daily_budget":50000,"end_time":1800000000,${tail}`);
  });

  it("createCreative", async () => {
    const calls = stubFetch([okResponse({ id: "cr_1" })]);
    expect(await new MetaConnector().createCreative(TOKEN, "act_1", creativeInput)).toEqual({ id: "cr_1" });
    expect(calls[0].init?.body).toBe(
      `{"name":"Cr","object_story_spec":{"page_id":"42","link_data":{"message":"p","name":"h","link":"https://toko.example.com","picture":"https://img.example.com/a.jpg","call_to_action":{"type":"LEARN_MORE","value":{"link":"https://toko.example.com"}}}},"access_token":"${TOKEN}"}`,
    );
  });

  it("createAd", async () => {
    const calls = stubFetch([okResponse({ id: "ad_1" })]);
    expect(await new MetaConnector().createAd(TOKEN, "act_1", adInput)).toEqual({ id: "ad_1" });
    expect(calls[0].init?.body).toBe(
      `{"name":"Ad","adset_id":"1","creative":{"creative_id":"2"},"status":"PAUSED","access_token":"${TOKEN}"}`,
    );
  });

  it("validateOnly: false is the same as not passing it", async () => {
    const calls = stubFetch([okResponse({ id: "camp_1" })]);
    const falseOption = { validateOnly: false } as unknown as { validateOnly: true };
    const result = await new MetaConnector().createCampaign(TOKEN, "act_1", campaignInput, falseOption);
    expect(result).toEqual({ id: "camp_1" });
    expect(calls[0].init?.body).not.toContain("execution_options");
  });
});

describe("validateOnly creates", () => {
  const cases: [string, (c: MetaConnector) => Promise<unknown>, string][] = [
    ["createCampaign", (c) => c.createCampaign(TOKEN, "act_1", campaignInput, { validateOnly: true }), "/act_1/campaigns"],
    ["createAdSet", (c) => c.createAdSet(TOKEN, "act_1", adSetInput, { validateOnly: true }), "/act_1/adsets"],
    ["createCreative", (c) => c.createCreative(TOKEN, "act_1", creativeInput, { validateOnly: true }), "/act_1/adcreatives"],
    ["createAd", (c) => c.createAd(TOKEN, "act_1", adInput, { validateOnly: true }), "/act_1/ads"],
  ];

  it.each(cases)("%s: sends execution_options, returns a validation result and no id", async (_name, call, path) => {
    const calls = stubFetch([okResponse({ success: true })]);
    const result = await call(new MetaConnector());
    expect(result).toEqual({ validated: true });
    expect(result).not.toHaveProperty("id");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(path);
    const body = bodyOf(calls[0]);
    expect(body.execution_options).toEqual(["validate_only"]);
    // still PAUSED where the object carries a status
    if (path !== "/act_1/adcreatives") expect(body.status).toBe("PAUSED");
  });

  it.each(cases)("%s: an answer carrying an id is never returned as a created object (UNCERTAIN)", async (_name, call) => {
    stubFetch([okResponse({ id: "999", success: true })]);
    const error = await call(new MetaConnector()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect((error as ConnectorApiError).status).toBeUndefined();
    expect(classifyCreateFailure(error)).toBe("UNCERTAIN");
  });

  it.each(cases)("%s: an unrecognised success answer is UNCERTAIN, not a validation", async (_name, call) => {
    stubFetch([okResponse({ success: false })]);
    const error = await call(new MetaConnector()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect(classifyCreateFailure(error)).toBe("UNCERTAIN");
  });

  it.each(cases)("%s: is never retried (throttle -> one request, no sleep)", async (_name, call) => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse(THROTTLE)]);
    const error = await call(new MetaConnector()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(classifyCreateFailure(error)).toBe("NOT_CREATED");
  });

  it("a rejected validation (HTTP 400) is thrown like any create error", async () => {
    stubFetch([errorResponse({ message: "Invalid parameter", code: 100 })]);
    const error = await new MetaConnector()
      .createCampaign(TOKEN, "act_1", campaignInput, { validateOnly: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect(error).toMatchObject({ status: 400, code: 100 });
  });

  it("configuration checks still run before any request", async () => {
    const calls = stubFetch([okResponse({ success: true })]);
    const error = await new MetaConnector()
      .createAdSet(TOKEN, "act_1", { ...adSetInput, optimizationGoal: undefined }, { validateOnly: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });
});

describe("getEntityStatus", () => {
  it("reads GET /{id}?fields=status,configured_status,effective_status and returns the parsed values", async () => {
    const calls = stubFetch([okResponse({ id: OBJECT_ID, status: "PAUSED", configured_status: "ACTIVE", effective_status: "CAMPAIGN_PAUSED" })]);
    const result = await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID);
    expect(result).toEqual({ status: "PAUSED", configuredStatus: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED" });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://graph.facebook.com/v25.0/${OBJECT_ID}`);
    expect(url.searchParams.get("fields")).toBe("status,configured_status,effective_status");
    // a read: no method override, no body
    expect(calls[0].init?.method).toBeUndefined();
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("keeps a partial answer and nulls the missing fields", async () => {
    stubFetch([okResponse({ effective_status: "ACTIVE" })]);
    expect(await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID)).toEqual({
      status: null,
      configuredStatus: null,
      effectiveStatus: "ACTIVE",
    });
  });

  it.each([
    ["an empty object", {}],
    ["an array", []],
    ["a string", "PAUSED"],
    ["a number", 5],
    ["only wrongly typed fields", { status: 5, configured_status: {}, effective_status: ["ACTIVE"] }],
    ["only lower-case tokens", { status: "paused", effective_status: "active" }],
    ["tokens with spaces or symbols", { status: "PAUSED; DROP", effective_status: "A B" }],
  ])("fails closed (null) for %s", async (_label, body) => {
    stubFetch([okResponse(body)]);
    expect(await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID)).toBeNull();
  });

  it("a JSON null body surfaces as a safe ConnectorApiError (existing Graph handling), never a raw TypeError", async () => {
    stubFetch([okResponse(null)]);
    const error = await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
  });

  it("drops an invalid field but keeps the valid ones", async () => {
    stubFetch([okResponse({ status: "PAUSED", effective_status: "paused" })]);
    expect(await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID)).toEqual({
      status: "PAUSED",
      configuredStatus: null,
      effectiveStatus: null,
    });
  });

  it.each(["", "act_123", "12 34", "../me", "123?fields=x", "1".repeat(40)])("a malformed id %j returns null without any request", async (id) => {
    const calls = stubFetch([okResponse({ status: "PAUSED" })]);
    expect(await new MetaConnector().getEntityStatus(TOKEN, id)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("uses the existing back-off for a throttled read", async () => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse(THROTTLE), okResponse({ effective_status: "PAUSED" })]);
    const result = await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID);
    expect(result?.effectiveStatus).toBe("PAUSED");
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([1000]);
  });

  it("a provider error is rethrown without the provider text, keeping the structured fields", async () => {
    stubFetch([errorResponse({ message: PROVIDER_TEXT, code: 100, error_subcode: 33 }, 400)]);
    const error = await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect(error).toMatchObject({ status: 400, code: 100, subcode: 33 });
    expect((error as Error).message).not.toContain("SECRET-PROVIDER-TEXT");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("a timeout is thrown as a ConnectorApiError without status or provider text", async () => {
    stubFetchRejecting(timeoutError());
    const error = await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect((error as ConnectorApiError).status).toBeUndefined();
  });

  it("a raw network failure is wrapped, never rethrown as is", async () => {
    stubFetchRejecting(new TypeError(PROVIDER_TEXT));
    const error = await new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect((error as Error).message).not.toContain("SECRET-PROVIDER-TEXT");
  });

  it("without Meta credentials it throws ConnectorConfigError and makes no request", async () => {
    metaEnv.appId = undefined;
    const calls = stubFetch([okResponse({})]);
    await expect(new MetaConnector().getEntityStatus(TOKEN, OBJECT_ID)).rejects.toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });
});

describe("setEntityStatus", () => {
  it.each(["PAUSED", "ARCHIVED", "ACTIVE"] as const)("%s: one POST /{id} with only status and token, APPLIED on success", async (status) => {
    const calls = stubFetch([okResponse({ success: true })]);
    const result = await new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, status);
    expect(result).toEqual({ kind: "APPLIED" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://graph.facebook.com/v25.0/${OBJECT_ID}`);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe(JSON.stringify({ status, access_token: TOKEN }));
  });

  it.each([
    ["HTTP 429 with Retry-After (a read would be retried)", errorResponse({ message: PROVIDER_TEXT }, 429, "1"), 429],
    ["a throttle code (17)", errorResponse({ message: PROVIDER_TEXT, code: 17 }, 400), 400],
    ["HTTP 500", errorResponse({ message: PROVIDER_TEXT }, 500), 500],
    ["HTTP 503", errorResponse({ message: PROVIDER_TEXT }, 503), 503],
    ["HTTP 408", errorResponse({ message: PROVIDER_TEXT }, 408), 408],
    ["Graph code 2 (temporary service error)", errorResponse({ message: PROVIDER_TEXT, code: 2 }, 400), 400],
  ])("%s: exactly one request, no sleep, UNCERTAIN, no provider text", async (_label, response, httpStatus) => {
    const delays = instantSleep();
    const calls = stubFetch([response]);
    const result = await new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, "PAUSED");
    expect(result.kind).toBe("UNCERTAIN");
    expect(result).toMatchObject({ httpStatus });
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("SECRET-PROVIDER-TEXT");
  });

  it("a timeout is UNCERTAIN (returned, not thrown) and is not repeated", async () => {
    const delays = instantSleep();
    const calls = stubFetchRejecting(timeoutError());
    const result = await new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, "PAUSED");
    expect(result).toEqual({ kind: "UNCERTAIN" });
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("a network failure is UNCERTAIN and is not repeated", async () => {
    const calls = stubFetchRejecting(new TypeError(PROVIDER_TEXT));
    const result = await new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, "PAUSED");
    expect(result).toEqual({ kind: "UNCERTAIN" });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SECRET-PROVIDER-TEXT");
  });

  it("an unreadable body is UNCERTAIN", async () => {
    const calls = stubFetch([{ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("bad json")) }]);
    expect(await new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, "PAUSED")).toEqual({ kind: "UNCERTAIN" });
    expect(calls).toHaveLength(1);
  });

  it.each([["{}", {}], ["success false", { success: false }], ["success as a string", { success: "true" }], ["null", null]])(
    "HTTP 200 with %s is UNCERTAIN, never APPLIED",
    async (_label, body) => {
      stubFetch([okResponse(body)]);
      expect((await new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, "PAUSED")).kind).toBe("UNCERTAIN");
    },
  );

  it.each([
    ["an invalid parameter (400/100)", errorResponse({ message: PROVIDER_TEXT, code: 100 }, 400), 400, 100],
    ["an expired token (401/190)", errorResponse({ message: PROVIDER_TEXT, code: 190 }, 401), 401, 190],
  ])("%s is a definitive REJECTED with structured fields only", async (_label, response, httpStatus, code) => {
    const calls = stubFetch([response]);
    const result = await new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, "PAUSED");
    expect(result).toEqual({ kind: "REJECTED", httpStatus, code });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SECRET-PROVIDER-TEXT");
  });

  it("never logs the provider text or the token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    stubFetch([errorResponse({ message: PROVIDER_TEXT, code: 100 }, 400)]);
    await new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, "PAUSED");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it.each(["", "act_123", "abc", "12 34", "../me", "1".repeat(40)])("a malformed id %j throws ConnectorConfigError before any request", async (id) => {
    const calls = stubFetch([okResponse({ success: true })]);
    await expect(new MetaConnector().setEntityStatus(TOKEN, id, "PAUSED")).rejects.toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });

  it.each(["DELETED", "active", "paused", "", "WITH_ISSUES"])("an unsupported status %j throws ConnectorConfigError before any request", async (status) => {
    const calls = stubFetch([okResponse({ success: true })]);
    await expect(new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, status as unknown as "PAUSED")).rejects.toBeInstanceOf(
      ConnectorConfigError,
    );
    expect(calls).toHaveLength(0);
  });

  it("without Meta credentials it throws ConnectorConfigError and makes no request", async () => {
    metaEnv.appSecret = undefined;
    const calls = stubFetch([okResponse({ success: true })]);
    await expect(new MetaConnector().setEntityStatus(TOKEN, OBJECT_ID, "PAUSED")).rejects.toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });
});

describe("pauseObject and the unchanged pauseCampaign", () => {
  it("pauseObject sends PAUSED once and reports APPLIED", async () => {
    const calls = stubFetch([okResponse({ success: true })]);
    expect(await new MetaConnector().pauseObject(TOKEN, OBJECT_ID)).toEqual({ kind: "APPLIED" });
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.body).toBe(JSON.stringify({ status: "PAUSED", access_token: TOKEN }));
  });

  it("pauseObject is not retried on a throttle and reports UNCERTAIN", async () => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse({ message: "app limit", code: 4 }), okResponse({ success: true })]);
    expect((await new MetaConnector().pauseObject(TOKEN, OBJECT_ID)).kind).toBe("UNCERTAIN");
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("pauseCampaign keeps its behaviour: same body, resolves to undefined, still retried on a throttle", async () => {
    const delays = instantSleep();
    const calls = stubFetch([errorResponse({ message: "app limit", code: 4 }), okResponse({ success: true })]);
    const result = await new MetaConnector().pauseCampaign(TOKEN, "act_1", "123");
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([1000]);
    expect(calls[1].init?.body).toBe(`{"status":"PAUSED","access_token":"${TOKEN}"}`);
    expect(calls[1].url).toBe("https://graph.facebook.com/v25.0/123");
  });
});

describe("createAdSet lifetime budget (dormant, exclusive with the daily budget)", () => {
  const lifetimeInput = {
    campaignId: "123",
    name: "Ad Set",
    targetingCountries: ["ID"],
    optimizationGoal: "REACH",
    lifetimeBudgetMinorUnits: 700_000,
    endTimeUnixSeconds: 1_800_000_000,
  };

  it("sends lifetime_budget and end_time, never daily_budget, and stays PAUSED", async () => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    const result = await new MetaConnector().createAdSet(TOKEN, "act_1", lifetimeInput);
    expect(result).toEqual({ id: "adset_1" });
    const body = bodyOf(calls[0]);
    expect(body).toMatchObject({ lifetime_budget: 700_000, end_time: 1_800_000_000, status: "PAUSED" });
    expect(body).not.toHaveProperty("daily_budget");
  });

  it("works together with validateOnly", async () => {
    const calls = stubFetch([okResponse({ success: true })]);
    const result = await new MetaConnector().createAdSet(TOKEN, "act_1", lifetimeInput, { validateOnly: true });
    expect(result).toEqual({ validated: true });
    const body = bodyOf(calls[0]);
    expect(body.execution_options).toEqual(["validate_only"]);
    expect(body).not.toHaveProperty("daily_budget");
  });

  it.each([50_000, 0, null])("a daily budget (%j) together with a lifetime budget is refused before any request", async (daily) => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    const error = await new MetaConnector()
      .createAdSet(TOKEN, "act_1", { ...lifetimeInput, dailyBudgetMinorUnits: daily as unknown as number })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });

  it("a lifetime budget without end time is refused before any request", async () => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    const withoutEnd = {
      campaignId: "123",
      name: "Ad Set",
      targetingCountries: ["ID"],
      optimizationGoal: "REACH",
      lifetimeBudgetMinorUnits: 700_000,
    };
    const error = await new MetaConnector().createAdSet(TOKEN, "act_1", withoutEnd).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });

  it.each([0, -5, 1.5, Number.NaN, "1800000000", null])("a lifetime budget with an invalid end time %j is refused", async (value) => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    const error = await new MetaConnector()
      .createAdSet(TOKEN, "act_1", { ...lifetimeInput, endTimeUnixSeconds: value as unknown as number })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "700000", null])("an invalid lifetime budget %j is refused", async (value) => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    const error = await new MetaConnector()
      .createAdSet(TOKEN, "act_1", { ...lifetimeInput, lifetimeBudgetMinorUnits: value as unknown as number })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });

  it("without lifetimeBudgetMinorUnits the daily budget is sent as before and no lifetime_budget appears", async () => {
    const calls = stubFetch([okResponse({ id: "adset_1" })]);
    await new MetaConnector().createAdSet(TOKEN, "act_1", adSetInput);
    const body = bodyOf(calls[0]);
    expect(body.daily_budget).toBe(50_000);
    expect(body).not.toHaveProperty("lifetime_budget");
  });
});
