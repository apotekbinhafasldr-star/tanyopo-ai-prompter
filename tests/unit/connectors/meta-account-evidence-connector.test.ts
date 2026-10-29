import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/env", () => ({
  serverEnv: {
    meta: { appId: "app123", appSecret: "secret123", redirectUri: "https://app.example.com/callback", loginConfigId: undefined },
  },
  isConnectorConfigured: (credentials: Record<string, string | undefined>) =>
    Object.values(credentials).every((v) => !!v && v.length > 0),
}));

import { MetaConnector } from "@/lib/connectors/meta-connector";
import { ConnectorApiError } from "@/lib/connectors/types";

/** A local fetch double. Nothing here ever reaches the network or Meta. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const ID = "act_555";

describe("MetaConnector#getAdAccountCurrencyEvidence — read-only", () => {
  it("makes exactly one GET for id,currency,account_status of the stored account and returns VERIFIED", async () => {
    const fetchMock = stubFetch({ id: ID, currency: "IDR", account_status: 1 });
    const result = await new MetaConnector().getAdAccountCurrencyEvidence("tok", ID);

    expect(result).toEqual({ kind: "VERIFIED", accountId: ID, currency: "IDR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/${ID}?`);
    const query = new URL(url).searchParams;
    expect(query.get("fields")).toBe("id,currency,account_status");
    // A read: no method override (GET) and no body.
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
    // Bounded by a timeout (the readiness-check timeout), like the other reads.
    expect(init?.signal).toBeDefined();
  });

  it("a response for another account is UNVERIFIED (ACCOUNT_ID_MISMATCH)", async () => {
    stubFetch({ id: "act_999", currency: "IDR", account_status: 1 });
    expect(await new MetaConnector().getAdAccountCurrencyEvidence("tok", ID)).toEqual({ kind: "UNVERIFIED", reason: "ACCOUNT_ID_MISMATCH" });
  });

  it.each([
    [{ id: ID, account_status: 1 }, "CURRENCY_INVALID"],
    [{ id: ID, currency: "idr", account_status: 1 }, "CURRENCY_INVALID"],
    [{ id: ID, currency: "IDR" }, "STATUS_UNKNOWN"],
    [{ id: ID, currency: "IDR", account_status: 2 }, "STATUS_NOT_ACTIVE"],
    [{}, "ACCOUNT_ID_MISMATCH"],
    [[], "RESPONSE_INVALID"],
  ])("an invalid response %j is UNVERIFIED (%s) — no default currency", async (body, reason) => {
    stubFetch(body);
    expect(await new MetaConnector().getAdAccountCurrencyEvidence("tok", ID)).toEqual({ kind: "UNVERIFIED", reason });
  });

  it.each(["", "1", "act_", "act_1/../me", "act_1?fields=x", "ACT_1", null, undefined])(
    "a malformed id (%j) never reaches a request",
    async (id) => {
      const fetchMock = stubFetch({ id: ID, currency: "IDR", account_status: 1 });
      const result = await new MetaConnector().getAdAccountCurrencyEvidence("tok", id as string);
      expect(result).toEqual({ kind: "UNVERIFIED", reason: "ACCOUNT_ID_INVALID" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("a Meta error (expired token, no access) propagates as ConnectorApiError and is never turned into evidence", async () => {
    stubFetch({ error: { message: "Error validating access token: SECRET-TOKEN-TEXT", code: 190 } }, { ok: false, status: 400 });
    await expect(new MetaConnector().getAdAccountCurrencyEvidence("tok", ID)).rejects.toBeInstanceOf(ConnectorApiError);
  });

  it("is not a write: the method source has no POST, no body and no budget field", () => {
    const src = readFileSync("lib/connectors/meta-connector.ts", "utf8");
    const start = src.indexOf("async getAdAccountCurrencyEvidence(");
    const end = src.indexOf("async createCampaign(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const method = src.slice(start, end);
    expect(method).not.toMatch(/method:|body:|POST|DELETE|daily_budget|lifetime_budget|status:\s*"/);
  });

  it("the OAuth scopes are unchanged", () => {
    expect(readFileSync("lib/connectors/meta-connector.ts", "utf8")).toContain(
      'const SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list"];',
    );
  });
});
