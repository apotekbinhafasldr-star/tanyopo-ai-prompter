import { describe, expect, it } from "vitest";
import { generateOAuthState, statesMatch, oauthStateCookieName } from "@/lib/connectors/oauth-state";

describe("OAuth CSRF state validation", () => {
  it("generates a sufficiently random, non-empty state token", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).toHaveLength(64); // 32 bytes hex-encoded
    expect(a).not.toBe(b);
  });

  it("matches identical states", () => {
    const state = generateOAuthState();
    expect(statesMatch(state, state)).toBe(true);
  });

  it("rejects a mismatched state (forged callback)", () => {
    expect(statesMatch(generateOAuthState(), generateOAuthState())).toBe(false);
  });

  it("rejects when either side is missing (cookie expired or callback tampered)", () => {
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch("abc", undefined)).toBe(false);
    expect(statesMatch(undefined, undefined)).toBe(false);
  });

  it("rejects a state of different length without throwing", () => {
    expect(statesMatch("short", "a-much-longer-state-value")).toBe(false);
  });

  it("scopes the state cookie name per platform, so a Meta flow can't be confused with a TikTok one", () => {
    expect(oauthStateCookieName("META")).toBe("promoter_oauth_state_meta");
    expect(oauthStateCookieName("TIKTOK")).toBe("promoter_oauth_state_tiktok");
    expect(oauthStateCookieName("X")).toBe("promoter_oauth_state_x");
  });
});
