// @vitest-environment node
/**
 * QA/Security (2026-11-11) — route registry.
 *
 * Every HTTP route under app/ must be classified here with the mechanism that protects it. A new route.ts that is not
 * listed fails this test, so nobody can ship an unauthenticated endpoint by accident. For each entry the test also
 * checks (a) that the source actually contains the guard it claims, and (b) that proxy.ts agrees about whether the
 * path is publicly reachable without a Supabase session.
 *
 * Label: CODE + UNIT TEST. Static source inspection plus the pure isPublicAsset() function; no network, no database.
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/env", () => ({
  publicEnv: { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "pk" },
}));

import { isPublicAsset } from "@/proxy";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === "route.ts" || name === "route.tsx") out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

interface Entry {
  /** Who may call it. */
  auth: "session-oauth" | "admin-permission" | "payment-operator" | "bearer-secret" | "hmac-service" | "provider-signature" | "demo-cookie" | "supabase-code" | "public-probe";
  /** Must proxy.ts let the request through WITHOUT a Supabase session cookie? */
  proxyPublic: boolean;
  /** Every pattern must appear in the source. */
  mustContain: RegExp[];
}

const REGISTRY: Record<string, Entry> = {
  "app/admin/finance/tax/coretax-package/route.ts": {
    auth: "admin-permission",
    proxyPublic: false,
    mustContain: [/isAdminCenterEnabled\(\)/, /request\.nextUrl\.origin/, /requireAdminPermission\(/],
  },
  "app/admin/finance/tax/optimization/decision/route.ts": {
    auth: "admin-permission",
    proxyPublic: false,
    mustContain: [/isAdminCenterEnabled\(\)/, /request\.nextUrl\.origin/, /requireAdminPermission\(/],
  },
  "app/admin/staff/save/route.ts": {
    auth: "admin-permission",
    proxyPublic: false,
    mustContain: [/isAdminCenterEnabled\(\)/, /request\.nextUrl\.origin/, /requireAdminPermission\("staff\.manage"\)/],
  },
  "app/ops/payments/export/route.ts": {
    auth: "payment-operator",
    proxyPublic: false,
    mustContain: [/getPaymentOperator\(\)/],
  },
  "app/api/connections/meta/authorize/route.ts": { auth: "session-oauth", proxyPublic: false, mustContain: [/handleConnectorOauthAuthorize\(/] },
  "app/api/connections/tiktok/authorize/route.ts": { auth: "session-oauth", proxyPublic: false, mustContain: [/handleConnectorOauthAuthorize\(/, /canStartOauth\(/] },
  "app/api/connections/x/authorize/route.ts": { auth: "session-oauth", proxyPublic: false, mustContain: [/handleConnectorOauthAuthorize\(/] },
  "app/api/connections/meta/callback/route.ts": { auth: "session-oauth", proxyPublic: false, mustContain: [/handleConnectorOauthCallback\(/] },
  "app/api/connections/tiktok/callback/route.ts": { auth: "session-oauth", proxyPublic: false, mustContain: [/handleConnectorOauthCallback\(/] },
  "app/api/connections/x/callback/route.ts": { auth: "session-oauth", proxyPublic: false, mustContain: [/handleConnectorOauthCallback\(/] },
  "app/api/demo/start/route.ts": {
    auth: "demo-cookie",
    proxyPublic: true,
    mustContain: [/checkDemoStartLimit\(/, /getTrustedClientIp\(/, /createDemoSessionToken\(/],
  },
  "app/api/health/route.ts": { auth: "public-probe", proxyPublic: true, mustContain: [/status:\s*"ok"/] },
  "app/api/ready/route.ts": { auth: "public-probe", proxyPublic: true, mustContain: [/checkReadiness\(\)/] },
  "app/api/internal/jobs/process/route.ts": {
    auth: "bearer-secret",
    proxyPublic: false,
    mustContain: [/isAuthorizedProcessorRequest\(/],
  },
  "app/api/internal/payments/sweep/route.ts": {
    auth: "bearer-secret",
    proxyPublic: true,
    mustContain: [/isAuthorizedProcessorRequest\(/],
  },
  "app/api/v1/integrations/umkmpro/conversions/route.ts": { auth: "hmac-service", proxyPublic: true, mustContain: [/authorizeUmkmproRequest\(/] },
  "app/api/v1/integrations/umkmpro/products/route.ts": { auth: "hmac-service", proxyPublic: true, mustContain: [/authorizeUmkmproRequest\(/] },
  "app/api/v1/integrations/umkmpro/promotions/route.ts": { auth: "hmac-service", proxyPublic: true, mustContain: [/authorizeUmkmproRequest\(/] },
  "app/api/v1/integrations/umkmpro/webhooks/route.ts": { auth: "hmac-service", proxyPublic: true, mustContain: [/authorizeUmkmproRequest\(/] },
  "app/api/webhooks/payment/route.ts": {
    auth: "provider-signature",
    proxyPublic: true,
    mustContain: [/readBodyWithLimit\(/, /processPaymentWebhook\(/],
  },
  "app/auth/callback/route.ts": { auth: "supabase-code", proxyPublic: true, mustContain: [/safeNextPath\(/, /exchangeCodeForSession\(/] },
  "app/auth/confirm/route.ts": { auth: "supabase-code", proxyPublic: true, mustContain: [/safeNextPath\(/, /SUPPORTED_TYPES/] },
};

/** Route file -> the URL path it serves (no dynamic segments exist today). */
function urlOf(file: string): string {
  return "/" + file.replace(/^app\//, "").replace(/\/route\.tsx?$/, "");
}

describe("security: every route.ts is classified (new unauthenticated endpoints cannot appear silently)", () => {
  const found = walk(path.join(ROOT, "app")).sort();

  it("the set of route files equals the registry (add the new route here WITH its auth mechanism)", () => {
    expect(found).toEqual(Object.keys(REGISTRY).sort());
  });

  it("route groups / dynamic segments are not used (urlOf() would be wrong): add handling before introducing them", () => {
    expect(found.filter((f) => /[\[()]/.test(f))).toEqual([]);
  });

  it.each(Object.entries(REGISTRY))("%s carries the guard it is classified with", (file, entry) => {
    const src = read(file);
    for (const pattern of entry.mustContain) expect(src, `${file} must match ${pattern}`).toMatch(pattern);
  });

  it.each(Object.entries(REGISTRY))("%s: proxy.ts exposure matches the classification", (file, entry) => {
    expect(isPublicAsset(urlOf(file))).toBe(entry.proxyPublic);
  });

  it("a public-by-proxy route is never one of the session-protected kinds", () => {
    for (const [file, entry] of Object.entries(REGISTRY)) {
      if (entry.proxyPublic) {
        expect(["demo-cookie", "public-probe", "bearer-secret", "hmac-service", "provider-signature", "supabase-code"]).toContain(entry.auth);
        expect(file).not.toMatch(/^app\/(admin|ops)\//);
      }
    }
  });
});

describe("security: secret-authenticated routes verify the secret BEFORE any privileged client or body parse", () => {
  it.each([
    ["app/api/internal/jobs/process/route.ts", "isAuthorizedProcessorRequest(", "createAdminClient()"],
    ["app/api/internal/payments/sweep/route.ts", "isAuthorizedProcessorRequest(", "createAdminClient()"],
  ])("%s", (file, guard, privileged) => {
    const src = read(file);
    expect(src.indexOf(guard)).toBeGreaterThan(-1);
    expect(src.indexOf(guard)).toBeLessThan(src.indexOf(privileged));
  });

  it.each(Object.keys(REGISTRY).filter((f) => f.includes("/umkmpro/")))("%s verifies the HMAC before touching tenant data", (file) => {
    const src = read(file);
    const authAt = src.indexOf("authorizeUmkmproRequest(");
    expect(authAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(src.indexOf("parseJsonBody("));
    expect(authAt).toBeLessThan(src.indexOf("tenantExists("));
  });

  it("the payment webhook verifies authenticity inside processPaymentWebhook before it parses or writes (fail-closed order)", () => {
    const svc = read("services/payment-webhook.ts");
    const notConfigured = svc.indexOf("!provider.isConfigured()");
    const verify = svc.indexOf("provider.verifyWebhookSignature(rawBody");
    const parse = svc.indexOf("parseWebhookEvent(");
    const insert = svc.indexOf('.from("prompter_webhook_events")');
    expect(notConfigured).toBeGreaterThan(-1);
    expect(notConfigured).toBeLessThan(verify);
    expect(verify).toBeLessThan(parse);
    expect(parse).toBeLessThan(insert);
  });
});
