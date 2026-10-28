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

const ACC_A = { id: "act_1001", name: "Akun Lama", account_status: 1, currency: "IDR", is_prepay_account: false, funding_source: FUNDING_ID };
const ACC_B = { id: "act_2002", name: "PT Tanyopo Future Technology", account_status: 1, currency: "IDR", is_prepay_account: false, funding_source: FUNDING_ID };

describe("MetaConnector#listAdAccounts (F-2b)", () => {
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

  it("makes exactly one read-only GET and requests no funding details", async () => {
    const calls = stubFetch([jsonResponse({ data: [ACC_A, ACC_B] })]);
    await connector.listAdAccounts(TOKEN);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.pathname.endsWith("/me/adaccounts")).toBe(true);
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("fields")).toBe("id,name,account_status,currency,is_prepay_account,funding_source");
    expect(url.searchParams.get("fields")).not.toContain("funding_source_details");
    const init = calls[0].init;
    expect(init?.method === undefined || init.method === "GET").toBe(true);
    expect(init?.body).toBeUndefined();
  });

  it("returns id, name and a normalised snapshot, and never the funding source id", async () => {
    stubFetch([jsonResponse({ data: [ACC_A, ACC_B] })]);
    const listing = await connector.listAdAccounts(TOKEN);
    expect(listing.truncated).toBe(false);
    expect(listing.accounts.map((a) => [a.id, a.name])).toEqual([
      ["act_1001", "Akun Lama"],
      ["act_2002", "PT Tanyopo Future Technology"],
    ]);
    expect(listing.accounts[0].snapshot).toEqual({
      accountStatus: 1,
      currency: "IDR",
      isPrepayAccount: false,
      hasFundingSource: true,
      minDailyBudgetRaw: null,
    });
    const text = JSON.stringify(listing);
    expect(text).not.toContain(FUNDING_ID);
    expect(text).not.toContain(TOKEN);
  });

  it("handles zero accounts, a next page (truncated), malformed ids and duplicates", async () => {
    stubFetch([jsonResponse({ data: [] })]);
    expect(await connector.listAdAccounts(TOKEN)).toEqual({ accounts: [], truncated: false });

    stubFetch([
      jsonResponse({
        data: [ACC_A, ACC_A, { ...ACC_B, id: "act_bad id" }, { ...ACC_B, id: 42 }, { ...ACC_B, id: "2002" }, ACC_B],
        paging: { next: "https://graph.facebook.com/next?access_token=SECRET" },
      }),
    ]);
    const listing = await connector.listAdAccounts(TOKEN);
    expect(listing.accounts.map((a) => a.id)).toEqual(["act_1001", "act_2002"]);
    expect(listing.truncated).toBe(true);
    expect(JSON.stringify(listing)).not.toContain("SECRET");
  });

  it("sanitises display names and never leaves one empty", async () => {
    stubFetch([
      jsonResponse({
        data: [
          { ...ACC_A, name: "  Toko\u0000\nBaru  " },
          { ...ACC_B, name: "" },
          { id: "act_3003", name: 42 },
          { id: "act_4004", name: "x".repeat(500) },
        ],
      }),
    ]);
    const names = (await connector.listAdAccounts(TOKEN)).accounts.map((a) => a.name);
    expect(names[0]).toBe("Toko  Baru");
    expect(names[1]).toBe("Akun iklan tanpa nama");
    expect(names[2]).toBe("Akun iklan tanpa nama");
    expect(names[3]).toHaveLength(80);
  });

  it("keeps missing fields as null (never guessed)", async () => {
    stubFetch([jsonResponse({ data: [{ id: "act_5005", name: "Minim" }] })]);
    const [only] = (await connector.listAdAccounts(TOKEN)).accounts;
    expect(only.snapshot).toEqual({
      accountStatus: null,
      currency: null,
      isPrepayAccount: null,
      hasFundingSource: null,
      minDailyBudgetRaw: null,
    });
  });

  it("propagates Graph failures as structured errors (token, permission, provider, timeout)", async () => {
    stubFetch([jsonResponse({ error: { message: `bad ${TOKEN}`, code: 190 } }, { ok: false, status: 400 })]);
    const e1 = await catchError(connector.listAdAccounts(TOKEN));
    expect(classifyGraphFailure(e1)).toBe("TOKEN_EXPIRED");

    stubFetch([jsonResponse({ error: { message: "x", code: 200 } }, { ok: false, status: 403 })]);
    expect(classifyGraphFailure(await catchError(connector.listAdAccounts(TOKEN)))).toBe("PERMISSION_MISSING");

    stubFetch([jsonResponse({}, { ok: false, status: 500 })]);
    expect(classifyGraphFailure(await catchError(connector.listAdAccounts(TOKEN)))).toBe("PROVIDER_ERROR");

    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    stubFetch([timeout]);
    const e4 = await catchError(connector.listAdAccounts(TOKEN));
    expect(e4).toBeInstanceOf(ConnectorApiError);
  });

  it("makes no request when Meta is not configured", async () => {
    metaEnv.appId = undefined;
    const calls = stubFetch([jsonResponse({ data: [] })]);
    const err = await catchError(new MetaConnector().listAdAccounts(TOKEN));
    expect(err).toBeInstanceOf(ConnectorConfigError);
    expect(calls).toHaveLength(0);
  });
});

describe("MetaConnector#getAccountReadinessSnapshot with a confirmed selection (F-2b)", () => {
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

  it("without confirmation, several accounts are still MULTIPLE (limit=2, first account never assumed)", async () => {
    const calls = stubFetch([jsonResponse({ data: [ACC_A, ACC_B] })]);
    const result = await connector.getAccountReadinessSnapshot(TOKEN, "act_1001");
    expect(result).toEqual({ kind: "MULTIPLE" });
    expect(new URL(calls[0].url).searchParams.get("limit")).toBe("2");
    expect(calls).toHaveLength(1);
  });

  it("with confirmation, evaluates exactly the confirmed account even when it is not the first", async () => {
    const calls = stubFetch([jsonResponse({ data: [ACC_A, ACC_B] }), jsonResponse({ min_daily_budget: "3000" })]);
    const result = await connector.getAccountReadinessSnapshot(TOKEN, "act_2002", { selectionConfirmed: true });
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") return;
    expect(result.snapshot.minDailyBudgetRaw).toBe(3000);
    expect(new URL(calls[0].url).searchParams.get("limit")).toBe("50");
    expect(new URL(calls[1].url).pathname.endsWith("/act_2002")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(FUNDING_ID);
    for (const call of calls) {
      expect(call.init?.method === undefined || call.init.method === "GET").toBe(true);
    }
  });

  it("with confirmation, accepts the stored id with or without the act_ prefix", async () => {
    stubFetch([jsonResponse({ data: [ACC_A, ACC_B] }), jsonResponse({})]);
    expect((await connector.getAccountReadinessSnapshot(TOKEN, "2002", { selectionConfirmed: true })).kind).toBe("OK");
  });

  it("with confirmation, a stored account that is no longer accessible is a MISMATCH (changed access), not the first one", async () => {
    const calls = stubFetch([jsonResponse({ data: [ACC_A, ACC_B] })]);
    const result = await connector.getAccountReadinessSnapshot(TOKEN, "act_9999", { selectionConfirmed: true });
    expect(result).toEqual({ kind: "MISMATCH" });
    expect(calls).toHaveLength(1);
  });

  it("with confirmation, no accounts at all is NONE", async () => {
    stubFetch([jsonResponse({ data: [] })]);
    expect(await connector.getAccountReadinessSnapshot(TOKEN, "act_1001", { selectionConfirmed: true })).toEqual({ kind: "NONE" });
  });
});
