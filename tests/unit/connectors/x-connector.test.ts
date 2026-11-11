// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { xEnv } = vi.hoisted(() => ({
  xEnv: {
    clientId: "cid" as string | undefined,
    clientSecret: "sec" as string | undefined,
    redirectUri: "https://app.example/api/connections/x/callback" as string | undefined,
  },
}));

vi.mock("@/lib/env", () => ({
  serverEnv: { x: xEnv },
  isConnectorConfigured: (credentials: Record<string, string | undefined>) =>
    Object.values(credentials).every((v) => !!v && v.length > 0),
}));

import { XConnector } from "@/lib/connectors/x-connector";
import { ConnectorConfigError } from "@/lib/connectors/types";
import { createXClient } from "@/lib/connectors/x-api-client";

function makeConnector(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const client = createXClient({
    fetch: async (url, init) => {
      calls.push(url);
      return handler(url, init);
    },
    sleep: async () => {},
  });
  return { connector: new XConnector(client), calls };
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("XConnector — fail-closed", () => {
  beforeEach(() => {
    xEnv.clientId = "cid";
    xEnv.clientSecret = "sec";
    xEnv.redirectUri = "https://app.example/api/connections/x/callback";
  });

  it("isConfigured() false walau kredensial ada: PKCE belum tersambung di jalur bersama", () => {
    expect(makeConnector(() => ok({})).connector.isConfigured()).toBe(false);
  });

  it("jalur bersama getAuthorizationUrl / exchangeCodeForToken melempar ConnectorConfigError tanpa jaringan", async () => {
    const { connector, calls } = makeConnector(() => ok({}));
    expect(() => connector.getAuthorizationUrl("state")).toThrow(ConnectorConfigError);
    expect(() => connector.getAuthorizationUrl("state")).toThrow(/PKCE/);
    await expect(connector.exchangeCodeForToken("code")).rejects.toThrow(/PKCE/);
    expect(calls).toHaveLength(0);
  });

  it("tanpa kredensial: pesan konfigurasi biasa", () => {
    xEnv.clientSecret = undefined;
    expect(() => makeConnector(() => ok({})).connector.getAuthorizationUrl("s")).toThrow(/X_CLIENT_SECRET/);
  });

  it.each([
    ["createCampaign", (c: XConnector) => c.createCampaign()],
    ["createAdSet", (c: XConnector) => c.createAdSet()],
    ["createCreative", (c: XConnector) => c.createCreative()],
    ["createAd", (c: XConnector) => c.createAd()],
    ["getInsights", (c: XConnector) => c.getInsights()],
    ["pauseCampaign", (c: XConnector) => c.pauseCampaign()],
    ["updateBudget", (c: XConnector) => c.updateBudget()],
  ])("%s (iklan) ditolak eksplisit dan tidak mengirim permintaan apa pun", async (_name, run) => {
    const { connector, calls } = makeConnector(() => ok({}));
    await expect(run(connector)).rejects.toBeInstanceOf(ConnectorConfigError);
    await expect(run(connector)).rejects.toThrow(/OAuth 1\.0a/);
    expect(calls).toHaveLength(0);
  });

  it("tidak pernah menyentuh host lama twitter.com / ads-api.twitter.com", async () => {
    const { connector, calls } = makeConnector(() => ok({ data: { id: "1", name: "n", username: "u" } }));
    await connector.getAccounts("AT");
    expect(calls.every((u) => u.startsWith("https://api.x.com/"))).toBe(true);
  });
});

describe("XConnector — bagian X-spesifik yang siap", () => {
  beforeEach(() => {
    xEnv.clientId = "cid";
    xEnv.clientSecret = "sec";
    xEnv.redirectUri = "https://app.example/api/connections/x/callback";
  });

  it("URL otorisasi PKCE memuat scope publikasi dan challenge S256", () => {
    const url = new URL(makeConnector(() => ok({})).connector.getAuthorizationUrlWithPkce("st", "chal"));
    expect(url.host).toBe("x.com");
    expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual(
      ["media.write", "offline.access", "tweet.read", "tweet.write", "users.read"].sort(),
    );
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("penukaran kode PKCE mengembalikan token dengan expiresAt dan scope", async () => {
    const { connector } = makeConnector(() =>
      ok({ access_token: "AT", refresh_token: "RT", expires_in: 7200, scope: "tweet.read offline.access" }),
    );
    const t = await connector.exchangeCodeForTokenWithPkce("code", "verifier");
    expect(t.accessToken).toBe("AT");
    expect(t.refreshToken).toBe("RT");
    expect(t.scopes).toEqual(["tweet.read", "offline.access"]);
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 7000 * 1000);
  });

  it("getAccounts mengembalikan akun X pemilik token (bukan akun iklan)", async () => {
    const { connector } = makeConnector(() => ok({ data: { id: "42", name: "Toko", username: "toko" } }));
    expect(await connector.getAccounts("AT")).toEqual([{ id: "42", name: "@toko" }]);
  });

  it("publishPost meneruskan ke POST /2/tweets lewat klien palsu", async () => {
    const { connector, calls } = makeConnector(() => ok({ data: { id: "7", text: "hai" } }, 201));
    expect(await connector.publishPost("AT", { text: "hai" })).toEqual({ id: "7", text: "hai" });
    expect(calls).toEqual(["https://api.x.com/2/tweets"]);
  });

  it("disconnect memanggil revoke", async () => {
    const { connector, calls } = makeConnector(() => ok({ revoked: true }));
    await connector.disconnect("AT");
    expect(calls).toEqual(["https://api.x.com/2/oauth2/revoke"]);
  });
});
