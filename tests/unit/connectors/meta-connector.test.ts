import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: {
    meta: { appId: "app123", appSecret: "secret123", redirectUri: "https://app.example.com/callback" },
  },
  isConnectorConfigured: (credentials: Record<string, string | undefined>) =>
    Object.values(credentials).every((v) => !!v && v.length > 0),
}));

import { MetaConnector } from "@/lib/connectors/meta-connector";

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
