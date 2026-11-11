// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const ADAPTER = "lib/billing/providers/doku-payment-provider.ts";

describe("DOKU adapter — static guards (sandbox only, secrets stay on the server)", () => {
  it("is a server-only module", () => {
    expect(read(ADAPTER)).toMatch(/^import "server-only";/m);
  });

  it("contains the sandbox host only: no production DOKU host exists in the code", () => {
    const src = read(ADAPTER);
    expect(src).toContain("https://api-sandbox.doku.com");
    expect(src).not.toMatch(/https?:\/\/api\.doku\.com/);
    expect(src).not.toMatch(/\bLIVE_MODE\b|PRODUCTION_API|api\.doku\.com/);
  });

  it("requires an explicit sandbox statement and treats any live flag as 'not configured'", () => {
    const src = read(ADAPTER);
    expect(src).toContain('(providerEnv ?? "").trim() !== "sandbox"');
    expect(src).toContain('(liveFlag ?? "").trim() !== ""');
  });

  it("never logs, and never places the secret key in a URL", () => {
    const src = read(ADAPTER);
    expect(src).not.toMatch(/console\.(log|info|warn|error|debug)/);
    // no template literal builds a URL from apiBase and then interpolates a secret
    expect(src).not.toMatch(/apiBase\}[^`]*\$\{[^}]*(secret|apiKey)/i);
  });

  it("is registered next to Midtrans / Xendit (the fallback is kept) and selected only by PAYMENT_PROVIDER_NAME", () => {
    const src = read("lib/billing/get-payment-provider.ts");
    expect(src).toContain('serverEnv.payment.providerName === "doku"');
    expect(src).toContain('serverEnv.payment.providerName === "midtrans"');
    expect(src).toContain('serverEnv.payment.providerName === "xendit"');
    expect(read("lib/billing/providers/midtrans-payment-provider.ts")).toContain('readonly name = "midtrans"');
  });

  it("the new credential variable is read only by lib/env.ts and the provider layer, and is not NEXT_PUBLIC", () => {
    expect(read("lib/env.ts")).toContain('readOptional("PAYMENT_PROVIDER_CLIENT_ID")');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
        const rel = path.join(dir, name);
        if (/\.(ts|tsx)$/.test(name)) {
          if (/PAYMENT_PROVIDER_CLIENT_ID|NEXT_PUBLIC_[A-Z_]*DOKU/.test(read(rel)) && rel !== "lib/env.ts" && !rel.startsWith("lib/billing/providers/")) offenders.push(rel);
        } else if (!name.includes(".")) {
          walk(rel);
        }
      }
    };
    for (const d of ["app", "features", "components", "services", "lib"]) walk(d);
    expect(offenders).toEqual([]);
  });

  it("P1-C: the sandbox DB guard is wired into the adapter configuration and knows the production project", () => {
    const src = read(ADAPTER);
    expect(src).toContain("evaluateSandboxDbGuard");
    // the guard runs inside resolveDokuConfig, i.e. before checkout, verification AND webhook authentication
    const cfg = src.slice(src.indexOf("export function resolveDokuConfig"), src.indexOf("// Parsing helpers"));
    expect(cfg.indexOf("evaluateSandboxDbGuard")).toBeGreaterThan(cfg.indexOf("CLIENT_ID_PATTERN"));
    expect(cfg.indexOf("evaluateSandboxDbGuard")).toBeLessThan(cfg.indexOf("return { clientId"));
    const guard = read("lib/billing/providers/doku-sandbox-db-guard.ts");
    expect(guard).toContain("wjjyqovhmwenbcvbnkgx");
    expect(guard).not.toMatch(/process\.env|NODE_ENV|console\./);
    expect(read("lib/env.ts")).toContain('readOptional("PAYMENT_SANDBOX_DB_PROJECT_REFS")');
  });

  it("P1-C: the allow-list variable is read only by lib/env.ts (never NEXT_PUBLIC, never elsewhere)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
        const rel = path.join(dir, name);
        if (/\.(ts|tsx)$/.test(name)) {
          if (/PAYMENT_SANDBOX_DB_PROJECT_REFS/.test(read(rel)) && rel !== "lib/env.ts") offenders.push(rel);
        } else if (!name.includes(".")) {
          walk(rel);
        }
      }
    };
    for (const d of ["app", "features", "components", "services", "lib"]) walk(d);
    expect(offenders).toEqual([]);
    expect(read("lib/env.ts")).not.toMatch(/NEXT_PUBLIC_PAYMENT_SANDBOX/);
  });

  it("P1-A/B: the adapter has no 'assume IDR' fallback and PAID is gated by an explicit settled-type list", () => {
    const src = read(ADAPTER);
    expect(src).toContain("SETTLED_TRANSACTION_TYPES");
    expect(src).toContain('currency !== "IDR"');
    expect(src).not.toMatch(/currency\s*\?\?\s*["']IDR["']/);
    expect(src).toContain('currency: "IDR"'); // sent explicitly in the checkout order
  });

  it("P2: the replay short-circuit exists only for header-signed providers, so Midtrans / Xendit behave exactly as before", () => {
    const webhook = read("services/payment-webhook.ts");
    const idx = webhook.indexOf("Replay guard");
    expect(idx).toBeGreaterThan(0);
    expect(webhook.slice(idx, idx + 900)).toContain("provider.verifyWebhookRequest &&");
  });

  it("the activation path is unchanged: the webhook core still activates only through the verified settle path", () => {
    const webhook = read("services/payment-webhook.ts");
    const verifiedBlock = webhook.slice(webhook.indexOf("canVerifyServerSide(provider)"), webhook.indexOf('if (event.status !== "PAID")'));
    expect(verifiedBlock).not.toContain("fn_apply_verified_payment");
    expect(read("services/payment-verification.ts")).toContain('"fn_apply_verified_payment"');
    // a header-signing provider with no request context can never verify
    expect(webhook).toContain("request !== undefined && provider.verifyWebhookRequest(rawBody, request)");
  });

  it("the route still bounds the body before anything else and passes headers + path", () => {
    const route = read("app/api/webhooks/payment/route.ts");
    expect(route.indexOf("readBodyWithLimit")).toBeLessThan(route.indexOf("processPaymentWebhook"));
    expect(route).toContain("headers: request.headers");
    expect(route).toContain("path: request.nextUrl.pathname");
  });

  it("adds no database migration, does not touch the proxy allowlist and does not enable the sweeper", () => {
    const known = new Set(readdirSync(path.join(root, "supabase/migrations")).map((m) => m.slice(0, 14)));
    // The adapter itself added none. The only later migration allowed is P0-3 (20261111130000, DOKU alert coverage), reviewed separately.
    expect([...known].filter((v) => v > "20261103170000" && v !== "20261111130000")).toEqual([]);
    expect(read("proxy.ts")).toContain('pathname === "/api/webhooks/payment"');
    expect(read("proxy.ts")).not.toMatch(/doku/i);
  });
});
