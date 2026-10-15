import { describe, expect, it } from "vitest";
import {
  DEFAULT_OAUTH_STATE_MAX_AGE_SECONDS,
  MAX_OAUTH_STATE_MAX_AGE_SECONDS,
  checkOauthState,
  resolveStateCookieMaxAge,
} from "@/lib/connectors/oauth-state";
import { META_OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/connectors/meta-oauth-state";

describe("resolveStateCookieMaxAge", () => {
  it("defaults to 300 seconds (what TikTok and X keep)", () => {
    expect(DEFAULT_OAUTH_STATE_MAX_AGE_SECONDS).toBe(300);
    expect(resolveStateCookieMaxAge()).toBe(300);
    expect(resolveStateCookieMaxAge(undefined)).toBe(300);
  });

  it("allows Meta's 900 seconds and treats it as the ceiling", () => {
    expect(META_OAUTH_STATE_MAX_AGE_SECONDS).toBe(900);
    expect(MAX_OAUTH_STATE_MAX_AGE_SECONDS).toBe(900);
    expect(resolveStateCookieMaxAge(META_OAUTH_STATE_MAX_AGE_SECONDS)).toBe(900);
  });

  it("never issues a cookie longer than the ceiling, however large the request", () => {
    expect(resolveStateCookieMaxAge(901)).toBe(900);
    expect(resolveStateCookieMaxAge(3600)).toBe(900);
    expect(resolveStateCookieMaxAge(Number.MAX_SAFE_INTEGER)).toBe(900);
  });

  it("keeps a shorter explicit request as-is", () => {
    expect(resolveStateCookieMaxAge(120)).toBe(120);
  });

  it.each([0, -1, -900, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("falls back to the default for invalid value %s", (value) => {
    expect(resolveStateCookieMaxAge(value)).toBe(300);
  });
});

describe("checkOauthState", () => {
  const ok = { code: "CODE", state: "STATE", stateCookie: "STATE:t1", tenantId: "t1" };

  it("accepts a matching code, state and tenant, and hands back the code", () => {
    expect(checkOauthState(ok)).toEqual({ ok: true, code: "CODE" });
  });

  it("reports no_code when the code is absent or empty (e.g. the provider answered in a URL fragment)", () => {
    expect(checkOauthState({ ...ok, code: null })).toMatchObject({ ok: false, reason: "no_code" });
    expect(checkOauthState({ ...ok, code: "" })).toMatchObject({ ok: false, reason: "no_code" });
  });

  it("reports no_state when the state parameter is absent or empty", () => {
    expect(checkOauthState({ ...ok, state: null })).toMatchObject({ ok: false, reason: "no_state" });
    expect(checkOauthState({ ...ok, state: "" })).toMatchObject({ ok: false, reason: "no_state" });
  });

  it("reports no_cookie when the cookie is gone (expired, never set, or consumed)", () => {
    expect(checkOauthState({ ...ok, stateCookie: undefined })).toMatchObject({ ok: false, reason: "no_cookie" });
    expect(checkOauthState({ ...ok, stateCookie: "" })).toMatchObject({ ok: false, reason: "no_cookie" });
  });

  it("reports state_mismatch when the returned state is not the one in the cookie", () => {
    expect(checkOauthState({ ...ok, state: "OTHER" })).toMatchObject({ ok: false, reason: "state_mismatch" });
  });

  it("reports tenant_mismatch when the cookie was minted for another tenant", () => {
    expect(checkOauthState({ ...ok, stateCookie: "STATE:t2" })).toMatchObject({ ok: false, reason: "tenant_mismatch" });
    expect(checkOauthState({ ...ok, stateCookie: "STATE" })).toMatchObject({ ok: false, reason: "tenant_mismatch" });
  });

  it("rejects a matching state when BOTH state and tenant are wrong, naming the state first", () => {
    expect(checkOauthState({ ...ok, state: "OTHER", stateCookie: "STATE:t2" })).toMatchObject({
      ok: false,
      reason: "state_mismatch",
    });
  });

  it("always reports which inputs were present, so a missing code stays visible when the cookie is also gone", () => {
    expect(checkOauthState({ code: null, state: null, stateCookie: undefined, tenantId: "t1" })).toEqual({
      ok: false,
      reason: "no_code",
      present: { code: false, state: false, cookie: false },
    });
    expect(checkOauthState({ code: null, state: "STATE", stateCookie: "STATE:t1", tenantId: "t1" })).toEqual({
      ok: false,
      reason: "no_code",
      present: { code: false, state: true, cookie: true },
    });
  });

  it("never echoes the state, cookie or code in a rejection", () => {
    const result = checkOauthState({
      code: "SECRET-CODE",
      state: "SECRET-STATE",
      stateCookie: "OTHER-STATE:t2",
      tenantId: "t1",
    });
    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result);
    for (const secret of ["SECRET-CODE", "SECRET-STATE", "OTHER-STATE", "t2"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
