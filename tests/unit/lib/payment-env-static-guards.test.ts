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
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const D3_FILES = [
  "lib/billing/providers/payment-env-guard.ts",
  "lib/billing/payment-env-stamp.ts",
  "lib/billing/providers/midtrans-payment-provider.ts",
  "lib/billing/providers/xendit-payment-provider.ts",
  "services/checkout.ts",
  "services/payment-verification.ts",
  "services/payment-webhook.ts",
];

describe("D3 — static guards", () => {
  it("G1: no console output anywhere in the D3 payment path", () => {
    for (const f of D3_FILES) expect(read(f), f).not.toMatch(/console\./);
  });

  it("the new guard and stamp modules are pure: no env access, no I/O, no database client", () => {
    for (const f of ["lib/billing/providers/payment-env-guard.ts", "lib/billing/payment-env-stamp.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/process\.env|serverEnv|publicEnv|NODE_ENV|fetch\(|createAdminClient|from\("/);
      expect(src, f).not.toMatch(/@\/lib\/env/);
    }
  });

  it("G2: D3 phase A-C adds no database migration (the allow-list in the B3 static test is unchanged)", () => {
    const migrations = readdirSync(path.join(root, "supabase/migrations")).filter((m) => m.slice(0, 14) > "20261127110000");
    expect(migrations).toEqual([]);
  });

  it("G3: no new public variable, no balance / wallet / ledger writer in the new files", () => {
    for (const f of ["lib/billing/providers/payment-env-guard.ts", "lib/billing/payment-env-stamp.ts"]) {
      expect(read(f), f).not.toMatch(/NEXT_PUBLIC_|wallet|saldo|ledger|top_?up/i);
    }
    expect(read("lib/env.ts")).not.toMatch(/NEXT_PUBLIC_PAYMENT/);
  });

  it("G4: the live flag is still not read in app, features or components", () => {
    const offenders = [...walk("app"), ...walk("features"), ...walk("components")].filter((f) => /PAYMENT_LIVE_ENABLED/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("B8: each adapter checks the key prefix BEFORE the database guard, and the guard is evaluated before any network call", () => {
    const midtrans = read("lib/billing/providers/midtrans-payment-provider.ts");
    const runtime = midtrans.slice(midtrans.indexOf("export function resolveMidtransRuntime"), midtrans.indexOf("/** Snap payment page lifetime"));
    expect(runtime.indexOf("startsWith(mode.keyPrefix)")).toBeGreaterThan(-1);
    expect(runtime.indexOf("evaluatePaymentEnvironment")).toBeGreaterThan(runtime.indexOf("startsWith(mode.keyPrefix)"));
    expect(midtrans.indexOf("requireConfig()", midtrans.indexOf("async createCheckoutSession"))).toBeLessThan(midtrans.indexOf("await fetch(", midtrans.indexOf("async createCheckoutSession")));
    expect(midtrans.indexOf("requireConfig()", midtrans.indexOf("async getVerifiedPayment"))).toBeLessThan(midtrans.indexOf("await fetch(", midtrans.indexOf("async getVerifiedPayment")));
    const xendit = read("lib/billing/providers/xendit-payment-provider.ts");
    const xr = xendit.slice(xendit.indexOf("function resolveXenditRuntimeRef"), xendit.indexOf("/**\n * Batch B11"));
    expect(xr.indexOf("evaluatePaymentEnvironment")).toBeGreaterThan(xr.indexOf("xnd_development_"));
  });

  it("the sandbox allow-list setting is still read only by lib/env.ts (never by the new modules)", () => {
    const offenders = [...walk("app"), ...walk("features"), ...walk("components"), ...walk("services"), ...walk("lib")].filter(
      (f) => /PAYMENT_SANDBOX_DB_PROJECT_REFS/.test(read(f)) && f !== "lib/env.ts",
    );
    expect(offenders).toEqual([]);
  });

  it("the stamp is checked before the gateway is asked, and before the activation function", () => {
    const src = read("services/payment-verification.ts");
    const body = src.slice(src.indexOf("export async function verifyAndSettle"), src.indexOf("async function applyVerifiedPaid"));
    expect(body.indexOf("checkStamp(")).toBeGreaterThan(body.indexOf("WRONG_PROVIDER"));
    expect(body.indexOf("checkStamp(")).toBeLessThan(body.indexOf("getVerifiedPayment(transactionId)"));
  });

  it("checkout stamps before it opens a gateway session", () => {
    const src = read("services/checkout.ts");
    expect(src.indexOf("stampTransaction(admin")).toBeGreaterThan(-1);
    expect(src.indexOf("stampTransaction(admin")).toBeLessThan(src.indexOf("provider.createCheckoutSession("));
    expect(src).toContain("ENV_STAMP_FAILED");
  });
});
