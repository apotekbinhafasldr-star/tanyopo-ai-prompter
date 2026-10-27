import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
import { classifyGraphFailure } from "@/lib/connectors/meta-readiness";

const TOKEN = "token-readiness-abc";
const FUNDING_ID = "fs_secret_funding_id_777";
const AD_ACCOUNT = "act_1001";

type FetchCall = { url: string; init: RequestInit | undefined };

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

/** Installs a fetch stub that answers by call order and records every call. */
function stubFetch(responses: Array<ReturnType<typeof jsonResponse> | Error>) {
  const calls: FetchCall[] = [];
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    }),
  );
  return calls;
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
}

const GOOD_ACCOUNT = {
  id: AD_ACCOUNT,
  account_status: 1,
  currency: "IDR",
  is_prepay_account: false,
  funding_source: FUNDING_ID,
};

describe("MetaConnector#getAccountReadinessSnapshot", () => {
  let connector: MetaConnector;

  beforeEach(() => {
    metaEnv.appId = "app123";
    metaEnv.appSecret = "secret123";
    metaEnv.redirectUri = "https://app.example.com/callback";
    connector = new MetaConnector();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a normalised snapshot for the single, matching ad account (success)", async () => {
    const calls = stubFetch([
      jsonResponse({ data: [GOOD_ACCOUNT] }),
      jsonResponse({ id: AD_ACCOUNT, min_daily_budget: 25000 }),
    ]);

    const lookup = await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);

    expect(lookup).toEqual({
      kind: "OK",
      snapshot: {
        accountStatus: 1,
        currency: "IDR",
        isPrepayAccount: false,
        hasFundingSource: true,
        minDailyBudgetRaw: 25000,
      },
    });
    expect(calls).toHaveLength(2);
  });

  it("requests only the readiness fields — never funding_source_details", async () => {
    const calls = stubFetch([jsonResponse({ data: [GOOD_ACCOUNT] }), jsonResponse({ min_daily_budget: 1 })]);

    await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);

    const first = decodeURIComponent(calls[0].url);
    expect(first).toContain("/me/adaccounts");
    expect(first).toContain("fields=id,account_status,currency,is_prepay_account,funding_source");
    expect(first).not.toContain("funding_source_details");
    expect(first).toContain("limit=2");
    const second = decodeURIComponent(calls[1].url);
    expect(second).toContain(`/${AD_ACCOUNT}?`);
    expect(second).toContain("fields=min_daily_budget");
  });

  it("only reads: every call is a GET with no body", async () => {
    const calls = stubFetch([jsonResponse({ data: [GOOD_ACCOUNT] }), jsonResponse({ min_daily_budget: 1 })]);

    await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);

    for (const call of calls) {
      const method = (call.init?.method ?? "GET").toUpperCase();
      expect(method).toBe("GET");
      expect(call.init?.body).toBeUndefined();
    }
  });

  it("never returns the funding source id", async () => {
    stubFetch([jsonResponse({ data: [GOOD_ACCOUNT] }), jsonResponse({ min_daily_budget: 1 })]);

    const lookup = await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);

    expect(JSON.stringify(lookup)).not.toContain(FUNDING_ID);
    expect(JSON.stringify(lookup)).not.toContain(TOKEN);
  });

  it("reports an absent funding_source as null (not as 'none') and a missing is_prepay_account as null", async () => {
    stubFetch([
      jsonResponse({ data: [{ id: AD_ACCOUNT, account_status: 1, currency: "IDR" }] }),
      jsonResponse({ min_daily_budget: 1 }),
    ]);

    const lookup = await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);

    expect(lookup.kind).toBe("OK");
    if (lookup.kind === "OK") {
      expect(lookup.snapshot.hasFundingSource).toBeNull();
      expect(lookup.snapshot.isPrepayAccount).toBeNull();
    }
  });

  it("drops fields of the wrong type instead of guessing", async () => {
    stubFetch([
      jsonResponse({
        data: [{ id: AD_ACCOUNT, account_status: "1", currency: "idr", is_prepay_account: "false", funding_source: 12 }],
      }),
      jsonResponse({}),
    ]);

    const lookup = await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);

    expect(lookup).toEqual({
      kind: "OK",
      snapshot: {
        accountStatus: null,
        currency: null,
        isPrepayAccount: null,
        hasFundingSource: null,
        minDailyBudgetRaw: null,
      },
    });
  });

  it("accepts min_daily_budget as a numeric string", async () => {
    stubFetch([jsonResponse({ data: [GOOD_ACCOUNT] }), jsonResponse({ min_daily_budget: "1000" })]);
    const lookup = await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);
    expect(lookup.kind === "OK" && lookup.snapshot.minDailyBudgetRaw).toBe(1000);
  });

  it("still succeeds when the optional min_daily_budget call fails", async () => {
    stubFetch([
      jsonResponse({ data: [GOOD_ACCOUNT] }),
      jsonResponse({ error: { message: "Unsupported field", code: 100 } }, { ok: false, status: 400 }),
    ]);

    const lookup = await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);

    expect(lookup.kind).toBe("OK");
    expect(lookup.kind === "OK" && lookup.snapshot.minDailyBudgetRaw).toBeNull();
  });

  it("matches the stored account with or without the act_ prefix", async () => {
    stubFetch([jsonResponse({ data: [GOOD_ACCOUNT] }), jsonResponse({})]);
    const lookup = await connector.getAccountReadinessSnapshot(TOKEN, "1001");
    expect(lookup.kind).toBe("OK");
  });
});

describe("MetaConnector#getAccountReadinessSnapshot — ad account discovery fails safe", () => {
  let connector: MetaConnector;

  beforeEach(() => {
    metaEnv.appId = "app123";
    metaEnv.appSecret = "secret123";
    metaEnv.redirectUri = "https://app.example.com/callback";
    connector = new MetaConnector();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not pick the first of several ad accounts", async () => {
    const calls = stubFetch([
      jsonResponse({ data: [GOOD_ACCOUNT, { ...GOOD_ACCOUNT, id: "act_2002" }] }),
    ]);

    const lookup = await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT);

    expect(lookup).toEqual({ kind: "MULTIPLE" });
    expect(calls).toHaveLength(1);
  });

  it("treats a paginated list as more than one account", async () => {
    stubFetch([jsonResponse({ data: [GOOD_ACCOUNT], paging: { next: "https://graph.facebook.com/next" } })]);
    expect(await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT)).toEqual({ kind: "MULTIPLE" });
  });

  it("reports no ad account", async () => {
    const calls = stubFetch([jsonResponse({ data: [] })]);
    expect(await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT)).toEqual({ kind: "NONE" });
    expect(calls).toHaveLength(1);
  });

  it("refuses an account that is not the one LINOE stored", async () => {
    const calls = stubFetch([jsonResponse({ data: [{ ...GOOD_ACCOUNT, id: "act_9999" }] })]);
    expect(await connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT)).toEqual({ kind: "MISMATCH" });
    expect(calls).toHaveLength(1);
  });

  it("never puts a malformed id into a request path", async () => {
    const calls = stubFetch([jsonResponse({ data: [{ ...GOOD_ACCOUNT, id: "act_1/../me?x=" }] })]);
    expect(await connector.getAccountReadinessSnapshot(TOKEN, "act_1/../me?x=")).toEqual({ kind: "MISMATCH" });
    expect(calls).toHaveLength(1);
  });
});

describe("MetaConnector#getAccountReadinessSnapshot — failures", () => {
  let connector: MetaConnector;

  beforeEach(() => {
    metaEnv.appId = "app123";
    metaEnv.appSecret = "secret123";
    metaEnv.redirectUri = "https://app.example.com/callback";
    connector = new MetaConnector();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("expired or revoked token (190) -> ConnectorApiError that classifies as TOKEN_EXPIRED", async () => {
    stubFetch([
      jsonResponse({ error: { message: `Invalid OAuth access token ${TOKEN}`, code: 190, type: "OAuthException" } }, { ok: false, status: 401 }),
    ]);

    const err = await catchError(connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT));

    expect(err).toBeInstanceOf(ConnectorApiError);
    expect((err as ConnectorApiError).code).toBe(190);
    expect(classifyGraphFailure(err)).toBe("TOKEN_EXPIRED");
  });

  it("missing permission (200) classifies as PERMISSION_MISSING", async () => {
    stubFetch([jsonResponse({ error: { message: "Permissions error", code: 200 } }, { ok: false, status: 403 })]);
    const err = await catchError(connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT));
    expect(classifyGraphFailure(err)).toBe("PERMISSION_MISSING");
  });

  it("an HTTP 500 without a Graph error body classifies as PROVIDER_ERROR", async () => {
    stubFetch([jsonResponse({}, { ok: false, status: 500 })]);
    const err = await catchError(connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT));
    expect(err).toBeInstanceOf(ConnectorApiError);
    expect(classifyGraphFailure(err)).toBe("PROVIDER_ERROR");
  });

  it("a timeout becomes a status-less ConnectorApiError (PROVIDER_ERROR)", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    stubFetch([timeout]);

    const err = await catchError(connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT));

    expect(err).toBeInstanceOf(ConnectorApiError);
    expect((err as ConnectorApiError).status).toBeUndefined();
    expect(classifyGraphFailure(err)).toBe("PROVIDER_ERROR");
  });

  it("an unreadable response body is a ConnectorApiError, not a fake empty result", async () => {
    stubFetch([
      {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      } as unknown as ReturnType<typeof jsonResponse>,
    ]);
    const err = await catchError(connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT));
    expect(err).toBeInstanceOf(ConnectorApiError);
  });

  it("refuses to run (and never calls Meta) when the connector is not configured", async () => {
    metaEnv.appId = undefined;
    const calls = stubFetch([jsonResponse({ data: [GOOD_ACCOUNT] })]);

    const err = await catchError(connector.getAccountReadinessSnapshot(TOKEN, AD_ACCOUNT));

    expect(err).toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });
});
