import { describe, expect, it } from "vitest";
import { MetaConnector } from "@/lib/connectors/meta-connector";
import { TikTokConnector } from "@/lib/connectors/tiktok-connector";
import { XConnector } from "@/lib/connectors/x-connector";

/**
 * This environment genuinely has no META_APP_ID/TIKTOK_APP_ID/X_CLIENT_ID
 * etc. configured (Stage 2 verification confirmed this) — these tests
 * exercise the real, current NOT_CONFIGURED path rather than mocking env
 * vars, since that's exactly the state a fresh checkout of this repo is
 * always in until an operator adds real app credentials.
 */
describe("connectors report NOT_CONFIGURED honestly when credentials are absent", () => {
  it("MetaConnector.isConfigured() is false and buildAuthorizationUrl returns NOT_CONFIGURED", () => {
    const connector = new MetaConnector();
    expect(connector.isConfigured()).toBe(false);

    const result = connector.buildAuthorizationUrl("11111111-1111-1111-1111-111111111111");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_CONFIGURED");
  });

  it("TikTokConnector.isConfigured() is false and buildAuthorizationUrl returns NOT_CONFIGURED", () => {
    const connector = new TikTokConnector();
    expect(connector.isConfigured()).toBe(false);

    const result = connector.buildAuthorizationUrl("11111111-1111-1111-1111-111111111111");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_CONFIGURED");
  });

  it("XConnector.isConfigured() is false and buildAuthorizationUrl returns NOT_CONFIGURED", () => {
    const connector = new XConnector();
    expect(connector.isConfigured()).toBe(false);

    const result = connector.buildAuthorizationUrl("11111111-1111-1111-1111-111111111111");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_CONFIGURED");
  });

  it("never returns an authorizationUrl when NOT_CONFIGURED (no fake success)", () => {
    for (const connector of [new MetaConnector(), new TikTokConnector(), new XConnector()]) {
      const result = connector.buildAuthorizationUrl("tenant");
      expect(result.ok).toBe(false);
    }
  });
});
