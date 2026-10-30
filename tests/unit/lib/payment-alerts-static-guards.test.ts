// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const OPS_FILES = ["services/payment-alerts.ts", "services/payment-operator.ts", "app/ops/payments/actions.ts", "app/ops/payments/page.tsx"];
const MIGRATION = "supabase/migrations/20261031100000_prompter_b4_payment_alerts.sql";

describe("Billing B4.1 — static guards", () => {
  it("the operator page and its services can never activate, check out, or edit payments / subscriptions", () => {
    for (const f of OPS_FILES) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/fn_apply_verified_payment|fn_resolve_review_payment|fn_begin_checkout|verifyAndSettle|reconcileCheckoutReturn|getPaymentProvider/);
      expect(src, f).not.toMatch(/prompter_subscriptions|prompter_payment_transactions|prompter_audit_logs/);
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });

  it("every operator surface goes through the dedicated allowlist, and the page is not a client component", () => {
    expect(read("app/ops/payments/page.tsx")).toContain("getPaymentOperator()");
    expect(read("app/ops/payments/page.tsx")).toContain("notFound()");
    expect(read("app/ops/payments/page.tsx")).not.toMatch(/["']use client["']/);
    const actions = read("app/ops/payments/actions.ts");
    expect(actions.match(/await getPaymentOperator\(\)/g)?.length).toBe(3);
    // the allowlist is NOT the Admin Center / Finance Hub (those depend on unapplied migrations)
    for (const f of OPS_FILES) expect(read(f), f).not.toMatch(/finance_platform_admins|platform-admin|admin-access|ADMIN_CENTER/);
  });

  it("services are server-only", () => {
    for (const f of ["services/payment-alerts.ts", "services/payment-operator.ts"]) expect(read(f)).toMatch(/^import "server-only";/m);
  });

  it("the B3 dedupe weakness is gone: alarms no longer read or write the tenant-writable audit table", () => {
    const src = strip(read("services/payment-verification.ts"));
    expect(src).not.toMatch(/prompter_audit_logs|payment\.refund_reported|PENDING_B4/);
    expect(src).toContain("recordPaymentAlarm");
  });

  it("the migration is additive, own-prefixed, service_role-only and free of cron / pg_net / Finance Hub", () => {
    const sql = strip(read(MIGRATION).replace(/^--.*$/gm, ""));
    expect(sql).not.toMatch(/cron\.|pg_net|net\.http|create extension|finance_|linoe_accounting/i);
    expect(sql).not.toMatch(/drop table|alter table public\.prompter_(payment_transactions|subscriptions|webhook_events|audit_logs)/i);
    expect(sql).not.toMatch(/(update|delete from|insert into)\s+public\.(prompter_payment_transactions|prompter_subscriptions)/i);
    for (const t of ["prompter_payment_operators", "prompter_payment_alerts", "prompter_payment_alert_actions", "prompter_payment_alert_evidence", "prompter_payment_alert_sync_state"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`));
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant [^;]*to (anon|authenticated|public)/i);
    const created = [...sql.matchAll(/create (?:table|index|or replace function|trigger)(?: if not exists)? (?:public\.)?([a-z_0-9]+)/gi)].map((m) => m[1]);
    for (const name of created) expect(name, name).toMatch(/^(prompter_|fn_|idx_|trg_|uq_)/);
  });

  it("every function in the migration pins search_path to `public, pg_temp` (pg_temp LAST) and none uses a bare `public`", () => {
    const sql = strip(read(MIGRATION).replace(/^--.*$/gm, ""));
    const functions = [...sql.matchAll(/create or replace function public\.([a-z_0-9]+)\(/gi)].map((m) => m[1]);
    expect(functions.length).toBe(8);
    expect([...sql.matchAll(/set search_path = public, pg_temp\s/g)].length).toBe(functions.length);
    expect(sql).not.toMatch(/set search_path = public\s*(\n|;|\$)/);
    expect(sql).not.toMatch(/set search_path to|search_path = (pg_temp|""|'')/i);
  });

  it("a SECURITY DEFINER function is never granted to a client role, and every one is explicitly revoked first", () => {
    const sql = strip(read(MIGRATION).replace(/^--.*$/gm, ""));
    const chunks = sql.split(/create or replace function public\./i).slice(1);
    const definers = chunks.filter((c) => /security definer/i.test(c.split(/\bas \$\$/i)[0])).map((c) => c.slice(0, c.indexOf("(")));
    expect(definers.sort()).toEqual(
      ["fn_ack_payment_alert", "fn_is_payment_operator", "fn_note_payment_alert_sync_failure", "fn_record_payment_alarm", "fn_resolve_payment_alert", "fn_sync_payment_alerts"].sort(),
    );
    for (const name of definers) expect(sql, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
  });

  it("B4.1 is the migration right after B2 (no other new schema change rides along)", () => {
    const newer = readdirSync(path.join(root, "supabase/migrations")).filter((m) => m.slice(0, 14) > "20261030140000");
    expect(newer).toContain("20261031100000_prompter_b4_payment_alerts.sql");
    expect(newer.filter((m) => m.slice(0, 14) < "20261031100000")).toEqual([]);
  });

  it("no scheduler, notification provider or secret handling ships in B4.1 (delivery stays disabled until approved)", () => {
    for (const f of [...OPS_FILES, "app/ops/payments/loading.tsx"]) {
      expect(strip(read(f)), f).not.toMatch(/telegram|whatsapp|smtp|resend|sendgrid|process\.env|serverEnv|fetch\(/i);
    }
  });
});
