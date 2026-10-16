import { describe, expect, it, vi, beforeEach } from "vitest";

// Mutable so individual tests can switch META_LOGIN_CONFIG_ID on and off.
const { metaEnv } = vi.hoisted(() => ({
  metaEnv: {
    appId: "app123",
    appSecret: "secret123",
    redirectUri: "https://app.example.com/callback",
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

describe("MetaConnector#getPages — Track B", () => {
  let connector: MetaConnector;

  beforeEach(() => {
    connector = new MetaConnector();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ data: [{ id: "page_1", name: "Toko A" }, { id: "page_2", name: "Toko B" }] }),
        // Expose the requested URL so the test below can assert on it.
        _url: url,
      })),
    );
  });

  it("calls /me/accounts (distinct from /me/adaccounts) with the access token", async () => {
    await connector.getPages("token-abc");

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/me/accounts");
    expect(calledUrl).not.toContain("/me/adaccounts");
    expect(calledUrl).toContain("access_token=token-abc");
  });

  it("maps the Graph API response to plain {id, name} pairs", async () => {
    const pages = await connector.getPages("token-abc");

    expect(pages).toEqual([
      { id: "page_1", name: "Toko A" },
      { id: "page_2", name: "Toko B" },
    ]);
  });

  it("propagates a Graph API error rather than returning a fake empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Invalid OAuth access token." } }),
      })),
    );

    await expect(connector.getPages("bad-token")).rejects.toThrow("Invalid OAuth access token.");
  });
});

// A made-up numeric id. The real Configuration ID must never appear in the
// repository — it is supplied only through the META_LOGIN_CONFIG_ID env var.
const DUMMY_CONFIG_ID = "1234567890123456";

describe("MetaConnector#getAuthorizationUrl", () => {
  beforeEach(() => {
    metaEnv.loginConfigId = undefined;
  });

  it("with a valid Configuration ID: sends config_id + code flow and NO scope", () => {
    metaEnv.loginConfigId = DUMMY_CONFIG_ID;
    const url = new URL(new MetaConnector().getAuthorizationUrl("state-xyz"));

    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth");
    expect(url.searchParams.get("config_id")).toBe(DUMMY_CONFIG_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.get("client_id")).toBe("app123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/callback");
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("trims surrounding whitespace from the Configuration ID", () => {
    metaEnv.loginConfigId = `  ${DUMMY_CONFIG_ID}\n`;
    const url = new URL(new MetaConnector().getAuthorizationUrl("s"));
    expect(url.searchParams.get("config_id")).toBe(DUMMY_CONFIG_ID);
  });

  it("without a Configuration ID: keeps the previous scope-based behaviour exactly", () => {
    const url = new URL(new MetaConnector().getAuthorizationUrl("state-xyz"));

    expect(url.searchParams.get("scope")).toBe("ads_management,ads_read,business_management,pages_show_list");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.has("config_id")).toBe(false);
    expect(url.searchParams.has("override_default_response_type")).toBe(false);
  });

  it.each([
    ["letters", "abc"],
    ["digits with a space inside", "123 456"],
    ["digits and letters", "123abc"],
    ["a pasted URL", "https://example.com/123"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["negative number", "-123"],
    ["scientific notation", "1e5"],
    ["too long", "1".repeat(33)],
    ["a quote injection attempt", `${DUMMY_CONFIG_ID}&scope=ads_management`],
  ])("rejects an invalid Configuration ID (%s) with ConnectorConfigError", (_label, value) => {
    metaEnv.loginConfigId = value;
    expect(() => new MetaConnector().getAuthorizationUrl("s")).toThrow(ConnectorConfigError);
  });

  it("an invalid Configuration ID never silently falls back to the classic dialog", () => {
    metaEnv.loginConfigId = "not-a-number";
    let produced: string | undefined;
    try {
      produced = new MetaConnector().getAuthorizationUrl("s");
    } catch {
      /* expected */
    }
    expect(produced).toBeUndefined();
  });

  it("does not leak the Configuration ID into the error message", () => {
    metaEnv.loginConfigId = "bad value 999";
    try {
      new MetaConnector().getAuthorizationUrl("s");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain("bad value 999");
    }
  });
});

describe("MetaConnector#exchangeCodeForToken — unchanged by the Configuration ID", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        // One body that satisfies all three Graph calls (short-lived, long-lived, debug_token).
        json: async () => ({ access_token: "tok", expires_in: 5184000, data: { scopes: ["ads_read"] } }),
      })),
    );
  });

  it.each([
    ["with a Configuration ID", DUMMY_CONFIG_ID],
    ["without a Configuration ID", undefined],
  ])("sends the same redirect_uri as the dialog (%s)", async (_label, configId) => {
    metaEnv.loginConfigId = configId;
    const connector = new MetaConnector();
    const dialogRedirect = new URL(connector.getAuthorizationUrl("s")).searchParams.get("redirect_uri");

    await connector.exchangeCodeForToken("the-code");

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const first = new URL(fetchMock.mock.calls[0][0] as string);
    expect(first.pathname.endsWith("/oauth/access_token")).toBe(true);
    expect(first.searchParams.get("redirect_uri")).toBe(dialogRedirect);
    expect(first.searchParams.get("code")).toBe("the-code");
    expect(first.searchParams.has("config_id")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("MetaConnector Graph errors", () => {
  it("throws ConnectorApiError with structured fields and the unchanged message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: "Invalid OAuth access token.", code: 190, error_subcode: 463, type: "OAuthException" },
        }),
      })),
    );

    const failure = await new MetaConnector().getPages("bad-token").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectorApiError);
    expect(failure).toMatchObject({
      message: "Invalid OAuth access token.",
      platform: "META",
      status: 400,
      code: 190,
      subcode: 463,
      type: "OAuthException",
    });
  });
});

// ---------------------------------------------------------------------------
// PR #36 — creative / ad set contracts and the per-call timeout.
// No real network: fetch is always a stub.
// ---------------------------------------------------------------------------

function stubFetchOk(body: unknown = { id: "new_1" }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
interface SentBody {
  object_story_spec: { link_data: Record<string, unknown> };
  [key: string]: unknown;
}
function sentBody(fetchMock: { mock: { calls: unknown[][] } }): SentBody {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as SentBody;
}

describe("MetaConnector#createCreative — PR #36", () => {
  const base = {
    name: "C",
    headline: "H",
    primaryText: "P",
    cta: "Pelajari",
    pageId: "page_1",
    linkUrl: "https://toko-saya.co.id/produk",
    imageUrl: "https://proj.supabase.co/storage/v1/object/public/product-media/t1/p1/a.jpg",
  };

  it("sends `picture` (never image_url), the tenant link, and the same link in the CTA", async () => {
    const fetchMock = stubFetchOk();
    await new MetaConnector().createCreative("tok", "act_1", base);

    const linkData = sentBody(fetchMock).object_story_spec.link_data;
    expect(linkData.picture).toBe(base.imageUrl);
    expect(linkData).not.toHaveProperty("image_url");
    expect(linkData.link).toBe(base.linkUrl);
    expect(linkData.call_to_action).toEqual({ type: "LEARN_MORE", value: { link: base.linkUrl } });
    expect(JSON.stringify(sentBody(fetchMock))).not.toContain("tanyopo");
  });

  it.each([
    ["linkUrl", { linkUrl: undefined }],
    ["imageUrl", { imageUrl: undefined }],
    ["pageId", { pageId: undefined }],
    ["empty linkUrl", { linkUrl: "" }],
    ["empty imageUrl", { imageUrl: "" }],
  ])("refuses to call Meta without %s (no tanyopo.ai fallback, no empty image)", async (_label, patch) => {
    const fetchMock = stubFetchOk();
    const failure = await new MetaConnector().createCreative("tok", "act_1", { ...base, ...patch }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectorConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MetaConnector#createAdSet — PR #36", () => {
  const base = { campaignId: "c1", name: "AS", dailyBudgetMinorUnits: 50000, targetingCountries: ["ID"] };

  it("uses the explicit goal with its verified billing event", async () => {
    const fetchMock = stubFetchOk();
    await new MetaConnector().createAdSet("tok", "act_1", { ...base, optimizationGoal: "REACH" });

    expect(sentBody(fetchMock)).toMatchObject({
      optimization_goal: "REACH",
      billing_event: "IMPRESSIONS",
      status: "PAUSED",
      targeting: { geo_locations: { countries: ["ID"] } },
    });
  });

  it.each([undefined, "", "LINK_CLICKS", "OFFSITE_CONVERSIONS"])("refuses goal %j and calls nothing (no invented pairing)", async (goal) => {
    const fetchMock = stubFetchOk();
    const failure = await new MetaConnector()
      .createAdSet("tok", "act_1", { ...base, optimizationGoal: goal })
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectorConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MetaConnector timeout — PR #36", () => {
  it("passes a timeout signal to every Graph call", async () => {
    const fetchMock = stubFetchOk({ data: [] });
    await new MetaConnector().getPages("tok");
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("17. a timed-out create call becomes a status-less ConnectorApiError and is NOT retried", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const fetchMock = vi.fn(async () => {
      throw timeout;
    });
    vi.stubGlobal("fetch", fetchMock);

    const failure = await new MetaConnector()
      .createCampaign("tok", "act_1", { name: "N", objective: "OUTCOME_AWARENESS", dailyBudgetMinorUnits: 1 })
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectorApiError);
    expect((failure as ConnectorApiError).status).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No status => the launch treats it as UNCERTAIN (Meta may have created it) and never retries.
    const { classifyCreateFailure } = await import("@/lib/campaigns/launch-reconciliation");
    expect(classifyCreateFailure(failure)).toBe("UNCERTAIN");
  });

  it("does not hide other network errors as timeouts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNRESET");
    }));
    await expect(new MetaConnector().getPages("tok")).rejects.toThrow("ECONNRESET");
  });
});
