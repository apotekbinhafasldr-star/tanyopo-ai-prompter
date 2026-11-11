// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(root, dir))) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const rel = path.join(dir, name);
    const full = path.join(root, rel);
    if (statSync(full).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const PAYMENT_FILES = [
  "lib/billing/providers/midtrans-payment-provider.ts",
  "services/payment-verification.ts",
  "services/payment-webhook.ts",
  "services/payment-reconciliation.ts",
  "lib/billing/read-body-limit.ts",
  "app/api/webhooks/payment/route.ts",
];

describe("Billing B3 — static guards (sandbox only, secrets stay on the server)", () => {
  it("the Midtrans adapter is a server-only module", () => {
    expect(read("lib/billing/providers/midtrans-payment-provider.ts")).toMatch(/^import "server-only";/m);
  });

  it("the adapter keeps sandbox as the default and gates the production hosts behind BOTH live switches (C1)", () => {
    const src = read("lib/billing/providers/midtrans-payment-provider.ts");
    expect(src).toContain("https://app.sandbox.midtrans.com/snap/v1/transactions");
    expect(src).toContain("https://api.sandbox.midtrans.com");
    // each production host is written exactly once, as a constant, and only resolveMidtransMode() can select it
    expect(src.match(/https:\/\/app\.midtrans\.com/g)).toHaveLength(1);
    expect(src.match(/https:\/\/api\.midtrans\.com/g)).toHaveLength(1);
    expect(src.match(/\bLIVE_MODE\b/g)?.length).toBeGreaterThan(0);
    expect(src).toContain('flag === "true"');
    expect(src).toContain('env === "production"');
    // the live flag is read from the environment only inside the adapter, never in app / features / components
    const offenders = [...walk("app"), ...walk("features"), ...walk("components")].filter((f) => /PAYMENT_LIVE_ENABLED/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the payment secrets are read only by the provider layer, never from pages, actions, components or client code", () => {
    const allowed = new Set(["lib/env.ts", "lib/billing/get-payment-provider.ts"]);
    const offenders = [...walk("app"), ...walk("features"), ...walk("components"), ...walk("services"), ...walk("lib")]
      .filter((f) => !f.startsWith("lib/billing/providers/") && !allowed.has(f))
      .filter((f) => /serverEnv\.payment|PAYMENT_PROVIDER_API_KEY|PAYMENT_PROVIDER_WEBHOOK_SECRET/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("no payment secret is exposed through a NEXT_PUBLIC variable", () => {
    for (const f of [...PAYMENT_FILES, "lib/env.ts"]) {
      expect(read(f), f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(MIDTRANS|PAYMENT|SERVER_KEY)/);
    }
  });

  it("the payment path never logs (so a key or a raw notification can never reach the logs)", () => {
    for (const f of PAYMENT_FILES) {
      expect(read(f), f).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });

  it("the webhook route bounds the body before anything else and keeps its public path", () => {
    const route = read("app/api/webhooks/payment/route.ts");
    expect(route).toContain("readBodyWithLimit(request, MAX_WEBHOOK_BODY_BYTES)");
    expect(route.indexOf("readBodyWithLimit")).toBeLessThan(route.indexOf("processPaymentWebhook"));
  });

  it("only the verified settle path calls the activation function for a server-verifiable provider", () => {
    const webhook = read("services/payment-webhook.ts");
    const verifiedBlock = webhook.slice(webhook.indexOf("canVerifyServerSide(provider)"), webhook.indexOf("if (event.status !== \"PAID\")"));
    expect(verifiedBlock).not.toContain("fn_apply_verified_payment");
    expect(read("services/payment-verification.ts")).toContain('"fn_apply_verified_payment"');
  });

  it("B3 adds no database migration and does not touch the proxy allowlist", () => {
    const migrations = readdirSync(path.join(root, "supabase/migrations"));
    // B3 itself added none; the only later migrations allowed are B4.1, B4.2, P0-2 and P0-3 (each reviewed separately).
    expect(migrations.filter((m) => m.slice(0, 14) > "20261030140000" && !["20261031100000", "20261101100000", "20261103170000", "20261111130000"].includes(m.slice(0, 14)))).toEqual([]);
    expect(read("proxy.ts")).toContain('pathname === "/api/webhooks/payment"');
  });
});
