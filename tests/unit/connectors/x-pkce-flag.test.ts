// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: { x: { clientId: "cid", clientSecret: "sec", redirectUri: "https://app.example/cb" } },
  isConnectorConfigured: (c: Record<string, string | undefined>) => Object.values(c).every((v) => !!v),
}));

import { X_OAUTH_PKCE_WIRED, XConnector } from "@/lib/connectors/x-connector";
import { isPkceConnector } from "@/lib/connectors/pkce-connector";

describe("X_OAUTH_PKCE_WIRED (fail-closed switch)", () => {
  it("is false in code: it never turns on by itself", () => {
    expect(X_OAUTH_PKCE_WIRED).toBe(false);
  });

  it("the default connector (what get-connector.ts builds) is not configured even with credentials", () => {
    expect(new XConnector().isConfigured()).toBe(false);
  });

  it("is not controllable from the environment", () => {
    vi.stubEnv("X_OAUTH_PKCE_WIRED", "true");
    expect(new XConnector().isConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("declares itself a PKCE connector and keeps the non-PKCE path closed even when wired", async () => {
    const wired = new XConnector(undefined, { pkceWired: true });
    expect(isPkceConnector(wired)).toBe(true);
    expect(wired.isConfigured()).toBe(true);
    expect(() => wired.getAuthorizationUrl("s")).toThrow(/PKCE/);
    await expect(wired.exchangeCodeForToken("c")).rejects.toThrow(/PKCE/);
  });
});
