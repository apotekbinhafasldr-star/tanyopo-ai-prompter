import { afterEach, describe, expect, it, vi } from "vitest";

describe("MetaConnector.handleCallback — error handling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects a mismatched OAuth state before attempting any network call (CSRF protection)", async () => {
    // Even with credentials configured, a state mismatch must short-circuit
    // before the token exchange — never trust an unverified callback.
    vi.stubEnv("META_APP_ID", "test-app-id");
    vi.stubEnv("META_APP_SECRET", "test-app-secret");
    vi.stubEnv("META_REDIRECT_URI", "https://example.com/api/connections/meta/callback");
    vi.resetModules();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { MetaConnector } = await import("@/lib/connectors/meta-connector");
    const connector = new MetaConnector();

    const result = await connector.handleCallback({
      tenantId: "11111111-1111-1111-1111-111111111111",
      code: "some-code",
      state: "state-the-callback-sent",
      expectedState: "state-the-app-actually-issued",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ERROR");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports NOT_CONFIGURED (not a crash) when TOKEN_ENCRYPTION_KEY is missing, even with valid state", async () => {
    vi.stubEnv("META_APP_ID", "test-app-id");
    vi.stubEnv("META_APP_SECRET", "test-app-secret");
    vi.stubEnv("META_REDIRECT_URI", "https://example.com/api/connections/meta/callback");
    vi.resetModules();

    const { MetaConnector } = await import("@/lib/connectors/meta-connector");
    const { generateOAuthState } = await import("@/lib/connectors/oauth-state");
    const connector = new MetaConnector();
    const state = generateOAuthState();

    const result = await connector.handleCallback({
      tenantId: "11111111-1111-1111-1111-111111111111",
      code: "some-code",
      state,
      expectedState: state,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_CONFIGURED");
  });
});
