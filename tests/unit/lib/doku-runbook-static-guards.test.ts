// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards for docs/DOKU_E2E_SANDBOX_RUNBOOK.md. The runbook is a PUBLIC document about payments: it must never carry a
 * credential or a value, and the code facts it relies on (env names, error markers, the sweeper route) must keep existing,
 * otherwise the document silently drifts away from the code it describes.
 */
const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const DOC = "docs/DOKU_E2E_SANDBOX_RUNBOOK.md";

describe("DOKU E2E sandbox runbook — no secrets, no values", () => {
  const doc = read(DOC);

  it("contains no credential-shaped strings", () => {
    expect(doc).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT
    expect(doc).not.toMatch(/sb_secret_[A-Za-z0-9]/);
    expect(doc).not.toMatch(/sb_publishable_[A-Za-z0-9]{8,}/);
    expect(doc).not.toMatch(/SB-Mid-server-[A-Za-z0-9]/);
    expect(doc).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(doc).not.toMatch(/HMACSHA256=[A-Za-z0-9+/]{20,}/);
    expect(doc).not.toMatch(/postgres(ql)?:\/\/[^\s/@]+:[^\s/@]+@/); // connection string with a password
  });

  it("assigns no value to a payment or secret variable (names only)", () => {
    expect(doc).not.toMatch(/\b(PAYMENT_PROVIDER_API_KEY|SUPABASE_SECRET_KEY|PAYMENT_SWEEPER_SECRET)\s*=\s*\S/);
    expect(doc).not.toMatch(/\bPAYMENT_LIVE_ENABLED\s*=\s*\S/);
  });

  it("never names the production database ref and never writes a real e-mail address", () => {
    expect(doc).not.toContain("wjjyqovhmwenbcvbnkgx");
    const emails = doc.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g) ?? [];
    expect(emails.filter((e) => !e.endsWith("@sandbox.invalid"))).toEqual([]);
  });

  it("does not create credentials in SQL (users are created in the dashboard with a password-manager password)", () => {
    expect(doc).not.toMatch(/encrypted_password|crypt\s*\(|insert\s+into\s+auth\.users/i);
  });

  it("keeps PAYMENT_LIVE_ENABLED OFF and never recommends a laptop or a local CLI as a prerequisite", () => {
    expect(doc).toContain("`PAYMENT_LIVE_ENABLED` kosong");
    expect(doc).not.toMatch(/npm (install|ci|run)\b|supabase (db push|link)|netlify (dev|deploy)/i);
  });
});

describe("DOKU E2E sandbox runbook — coverage and drift", () => {
  const doc = read(DOC);

  it("covers every required scenario and section", () => {
    for (let i = 0; i <= 15; i++) expect(doc).toMatch(new RegExp(`\\| S${i} \\|`));
    for (const word of ["VA", "QRIS", "e-wallet", "Kartu", "Replay", "Idempoten", "Check Status", "Refund", "Settlement", "Rekonsiliasi", "Invoice", "Chargeback", "Isolasi tenant"]) {
      expect(doc.toLowerCase()).toContain(word.toLowerCase());
    }
    for (const word of ["B-CUR", "PR #114", "EXTERNAL BLOCKED", "BELUM TERVERIFIKASI", "P0-A", "P0-B", "P0-C", "P1-D", "P1-E", "P1-F"]) {
      expect(doc).toContain(word);
    }
  });

  it("keeps the exact B-CUR evidence query and the separation of who does what", () => {
    expect(doc).toContain("select error from prompter_webhook_events where source_system='doku' and status='FAILED';");
    for (const heading of ["Bisa dikode", "Butuh Founder", "Butuh DOKU"]) expect(doc).toContain(heading);
  });

  it("lists only environment variables the code really reads", () => {
    const env = read("lib/env.ts");
    const adapter = read("lib/billing/providers/doku-payment-provider.ts");
    for (const name of ["PAYMENT_PROVIDER_NAME", "PAYMENT_PROVIDER_CLIENT_ID", "PAYMENT_PROVIDER_API_KEY", "PAYMENT_SANDBOX_DB_PROJECT_REFS", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
      expect(doc).toContain(`\`${name}\``);
      expect(env).toContain(name);
    }
    expect(doc).toContain("`PAYMENT_PROVIDER_ENV`");
    expect(adapter).toContain("PAYMENT_PROVIDER_ENV");
    expect(doc).toContain("`PAYMENT_SWEEPER_ENABLED`");
    expect(read("netlify/lib/pending-sweep-core.ts")).toContain("PAYMENT_SWEEPER_ENABLED");
  });

  it("refers to error markers and routes that exist in the code", () => {
    const webhook = read("services/payment-webhook.ts");
    const verification = read("services/payment-verification.ts");
    for (const marker of ["VERIFIED_STATUS_UNKNOWN", "VERIFIED_STATUS_NOT_PAID"]) {
      expect(doc).toContain(marker);
      expect(webhook).toContain(marker);
    }
    expect(doc).toContain("GATEWAY_VERIFICATION_FAILED");
    expect(verification).toContain("GATEWAY_VERIFICATION_FAILED");
    expect(doc).toContain("/api/webhooks/payment");
    expect(read("proxy.ts")).toContain('pathname === "/api/webhooks/payment"');
    // the runbook states the sweeper route is already exempted in proxy.ts
    expect(read("proxy.ts")).toContain('pathname === "/api/internal/payments/sweep"');
  });

  it("relies on the plan price and the sandbox facts it quotes", () => {
    expect(read("lib/billing/plans.ts")).toContain("99_000");
    expect(doc).toContain("99.000");
    expect(read("lib/billing/providers/doku-sandbox-db-guard.ts")).toContain("PRODUCTION_SUPABASE_REFS");
    expect(read("supabase/sandbox/doku/01_shim_shared_objects.sql")).toContain("handle_new_user");
  });

  it("every cited official source was accessed on 2026-11-11 and is listed with a URL", () => {
    expect(doc).toContain("2026-11-11");
    expect((doc.match(/https:\/\/[a-z.]*doku\.com\//g) ?? []).length).toBeGreaterThanOrEqual(10);
  });
});
