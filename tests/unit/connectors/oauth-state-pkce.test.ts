// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildPkceVerifierCookieValue,
  checkPkceVerifier,
  pkceVerifierCookieName,
  pkceVerifierCookiePath,
} from "@/lib/connectors/oauth-state";
import { isPkceConnector } from "@/lib/connectors/pkce-connector";
import { generatePkcePair } from "@/lib/connectors/x-pkce";

const { codeVerifier } = generatePkcePair();
const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const state = "stateABC_-123";
const cookie = buildPkceVerifierCookieValue({ state, tenantId, userId, codeVerifier });

describe("pkceVerifierCookieName", () => {
  it("derives x_oauth_verifier from x_oauth_state", () => {
    expect(pkceVerifierCookieName("x_oauth_state")).toBe("x_oauth_verifier");
  });
  it("refuses a name that does not follow the convention", () => {
    expect(() => pkceVerifierCookieName("x_cookie")).toThrow();
  });
});

describe("pkceVerifierCookiePath", () => {
  it("limits the cookie to the platform callback route, never the whole site", () => {
    expect(pkceVerifierCookiePath("X")).toBe("/api/connections/x/callback");
    expect(pkceVerifierCookiePath("X")).not.toBe("/");
  });
});

describe("checkPkceVerifier", () => {
  it("accepts the verifier bound to this state, tenant and user", () => {
    expect(checkPkceVerifier({ state, verifierCookie: cookie, tenantId, userId })).toEqual({ ok: true, codeVerifier });
  });

  it.each([
    ["missing", undefined, "no_verifier"],
    ["empty", "", "no_verifier"],
    ["wrong part count", "a:b", "verifier_malformed"],
    ["old three-part format", `${state}:${tenantId}:${codeVerifier}`, "verifier_malformed"],
    ["extra part", `${cookie}:x`, "verifier_malformed"],
    ["short verifier", `${state}:${tenantId}:${userId}:short`, "verifier_malformed"],
    [
      "other state",
      buildPkceVerifierCookieValue({ state: "other", tenantId, userId, codeVerifier }),
      "verifier_state_mismatch",
    ],
    [
      "other tenant",
      buildPkceVerifierCookieValue({ state, tenantId: "t-x", userId, codeVerifier }),
      "verifier_tenant_mismatch",
    ],
    [
      "other user (same tenant, same browser)",
      buildPkceVerifierCookieValue({ state, tenantId, userId: "u-other", codeVerifier }),
      "verifier_user_mismatch",
    ],
  ])("rejects %s", (_label, verifierCookie, reason) => {
    expect(checkPkceVerifier({ state, verifierCookie, tenantId, userId })).toEqual({ ok: false, reason });
  });

  it("rejects a verifier whose state differs only in the last character or in length", () => {
    for (const other of [`${state.slice(0, -1)}X`, `${state}X`, state.slice(0, -1)]) {
      const bound = buildPkceVerifierCookieValue({ state: other, tenantId, userId, codeVerifier });
      expect(checkPkceVerifier({ state, verifierCookie: bound, tenantId, userId })).toEqual({
        ok: false,
        reason: "verifier_state_mismatch",
      });
    }
  });

  it("never echoes the verifier in a rejection", () => {
    const result = checkPkceVerifier({
      state: "other",
      verifierCookie: cookie,
      tenantId,
      userId,
    });
    expect(JSON.stringify(result)).not.toContain(codeVerifier);
  });
});

describe("isPkceConnector", () => {
  const base = { getAuthorizationUrlWithPkce: () => "", exchangeCodeForTokenWithPkce: async () => ({}) };
  it("requires the explicit usesPkce marker and both methods", () => {
    expect(isPkceConnector({ ...base, usesPkce: true } as never)).toBe(true);
    expect(isPkceConnector(base as never)).toBe(false);
    expect(isPkceConnector({ usesPkce: true } as never)).toBe(false);
    expect(isPkceConnector({ platform: "META" } as never)).toBe(false);
  });
});
