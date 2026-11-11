// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildPkceVerifierCookieValue,
  checkPkceVerifier,
  pkceVerifierCookieName,
} from "@/lib/connectors/oauth-state";
import { isPkceConnector } from "@/lib/connectors/pkce-connector";
import { generatePkcePair } from "@/lib/connectors/x-pkce";

const { codeVerifier } = generatePkcePair();
const tenantId = "11111111-1111-4111-8111-111111111111";
const state = "stateABC_-123";
const cookie = buildPkceVerifierCookieValue({ state, tenantId, codeVerifier });

describe("pkceVerifierCookieName", () => {
  it("derives x_oauth_verifier from x_oauth_state", () => {
    expect(pkceVerifierCookieName("x_oauth_state")).toBe("x_oauth_verifier");
  });
  it("refuses a name that does not follow the convention", () => {
    expect(() => pkceVerifierCookieName("x_cookie")).toThrow();
  });
});

describe("checkPkceVerifier", () => {
  it("accepts the verifier bound to this state and tenant", () => {
    expect(checkPkceVerifier({ state, verifierCookie: cookie, tenantId })).toEqual({ ok: true, codeVerifier });
  });

  it.each([
    ["missing", undefined, "no_verifier"],
    ["empty", "", "no_verifier"],
    ["wrong part count", "a:b", "verifier_malformed"],
    ["extra part", `${cookie}:x`, "verifier_malformed"],
    ["short verifier", `${state}:${tenantId}:short`, "verifier_malformed"],
    ["other state", buildPkceVerifierCookieValue({ state: "other", tenantId, codeVerifier }), "verifier_state_mismatch"],
    ["other tenant", buildPkceVerifierCookieValue({ state, tenantId: "t-x", codeVerifier }), "verifier_tenant_mismatch"],
  ])("rejects %s", (_label, verifierCookie, reason) => {
    expect(checkPkceVerifier({ state, verifierCookie, tenantId })).toEqual({ ok: false, reason });
  });

  it("never echoes the verifier in a rejection", () => {
    const result = checkPkceVerifier({
      state: "other",
      verifierCookie: cookie,
      tenantId,
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
