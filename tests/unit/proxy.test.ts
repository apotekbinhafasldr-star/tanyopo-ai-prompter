import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({
  publicEnv: { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "pk" },
}));

import { isPublicAsset, hasValidBasicAuth } from "@/proxy";

describe("isPublicAsset — B12 hotfix regression: auth routes that handle their own session-less auth", () => {
  it("exempts /auth/confirm from cookie gating (signup confirmation arrives with no session yet)", () => {
    expect(isPublicAsset("/auth/confirm")).toBe(true);
  });

  it("still exempts /auth/callback (password recovery — unaffected by this fix)", () => {
    expect(isPublicAsset("/auth/callback")).toBe(true);
  });

  it("does not exempt an actual protected app route", () => {
    expect(isPublicAsset("/dashboard")).toBe(false);
    expect(isPublicAsset("/billing")).toBe(false);
  });

  it("does not exempt an unrelated /auth/ path by accident (exact match only)", () => {
    expect(isPublicAsset("/auth/confirm/extra")).toBe(false);
    expect(isPublicAsset("/auth/confirmx")).toBe(false);
  });

  it("Batch B11 hotfix — exempts /api/webhooks/payment so Xendit's callback never hits cookie gating or Basic-Auth", () => {
    expect(isPublicAsset("/api/webhooks/payment")).toBe(true);
  });
});

function requestWithAuthHeader(header: string | null) {
  return { headers: { get: () => header } } as unknown as Parameters<typeof hasValidBasicAuth>[0];
}

describe("hasValidBasicAuth — Batch B11 hotfix, Netlify Team Login SSO replacement", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error — test-only global, mirrors Netlify's Edge Function runtime shape
    delete globalThis.Netlify;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error — test-only global, mirrors Netlify's Edge Function runtime shape
    delete globalThis.Netlify;
  });

  it("is a no-op (always true) when unconfigured — production, where these env vars are never set", () => {
    expect(hasValidBasicAuth(requestWithAuthHeader(null))).toBe(true);
  });

  it("rejects a missing Authorization header once configured via process.env", () => {
    vi.stubEnv("PREVIEW_BASIC_AUTH_USER", "founder");
    vi.stubEnv("PREVIEW_BASIC_AUTH_PASSWORD", "sandbox-only");
    expect(hasValidBasicAuth(requestWithAuthHeader(null))).toBe(false);
  });

  it("accepts the exact configured credentials via process.env", () => {
    vi.stubEnv("PREVIEW_BASIC_AUTH_USER", "founder");
    vi.stubEnv("PREVIEW_BASIC_AUTH_PASSWORD", "sandbox-only");
    const header = `Basic ${Buffer.from("founder:sandbox-only").toString("base64")}`;
    expect(hasValidBasicAuth(requestWithAuthHeader(header))).toBe(true);
  });

  it("rejects wrong credentials", () => {
    vi.stubEnv("PREVIEW_BASIC_AUTH_USER", "founder");
    vi.stubEnv("PREVIEW_BASIC_AUTH_PASSWORD", "sandbox-only");
    const header = `Basic ${Buffer.from("founder:wrong-password").toString("base64")}`;
    expect(hasValidBasicAuth(requestWithAuthHeader(header))).toBe(false);
  });

  it("does not throw on malformed base64/header rather than crashing the proxy", () => {
    vi.stubEnv("PREVIEW_BASIC_AUTH_USER", "founder");
    vi.stubEnv("PREVIEW_BASIC_AUTH_PASSWORD", "sandbox-only");
    expect(() => hasValidBasicAuth(requestWithAuthHeader("Basic not-valid-base64!!"))).not.toThrow();
    expect(() => hasValidBasicAuth(requestWithAuthHeader("Bearer xyz"))).not.toThrow();
  });

  it("does not throw when the supplied credential length differs from the configured one", () => {
    vi.stubEnv("PREVIEW_BASIC_AUTH_USER", "founder");
    vi.stubEnv("PREVIEW_BASIC_AUTH_PASSWORD", "sandbox-only");
    const header = `Basic ${Buffer.from("f:short").toString("base64")}`;
    expect(() => hasValidBasicAuth(requestWithAuthHeader(header))).not.toThrow();
    expect(hasValidBasicAuth(requestWithAuthHeader(header))).toBe(false);
  });

  it("Batch B11 hotfix round 2 — falls back to Netlify.env.get() when process.env lacks the var (Edge Function runtime gap)", () => {
    const store: Record<string, string> = {
      PREVIEW_BASIC_AUTH_USER: "founder",
      PREVIEW_BASIC_AUTH_PASSWORD: "sandbox-only",
    };
    // @ts-expect-error — test-only global, mirrors Netlify's Edge Function runtime shape
    globalThis.Netlify = { env: { get: (name: string) => store[name] } };

    const header = `Basic ${Buffer.from("founder:sandbox-only").toString("base64")}`;
    expect(hasValidBasicAuth(requestWithAuthHeader(header))).toBe(true);
  });

  it("prefers process.env over Netlify.env.get() when both are present", () => {
    vi.stubEnv("PREVIEW_BASIC_AUTH_USER", "founder");
    vi.stubEnv("PREVIEW_BASIC_AUTH_PASSWORD", "sandbox-only");
    // @ts-expect-error — test-only global, mirrors Netlify's Edge Function runtime shape
    globalThis.Netlify = { env: { get: () => "should-not-be-used" } };

    const header = `Basic ${Buffer.from("founder:sandbox-only").toString("base64")}`;
    expect(hasValidBasicAuth(requestWithAuthHeader(header))).toBe(true);
  });

  it("does not throw when Netlify.env.get() itself throws", () => {
    // @ts-expect-error — test-only global, mirrors Netlify's Edge Function runtime shape
    globalThis.Netlify = {
      env: {
        get: () => {
          throw new Error("not available in this runtime");
        },
      },
    };
    expect(() => hasValidBasicAuth(requestWithAuthHeader(null))).not.toThrow();
    expect(hasValidBasicAuth(requestWithAuthHeader(null))).toBe(true);
  });
});
