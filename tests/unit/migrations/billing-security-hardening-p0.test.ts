import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Billing Security Hardening P0 — static invariants on the migration text. The behavioural proof
 * (negative + positive, PR #31/#44 integration, rollback, reapply) is supabase/tests/hardening
 * (run in CI job `billing-hardening-sql` against a throw-away PostgreSQL); these checks pin the SQL
 * so a safety property cannot be removed silently.
 */
const root = path.resolve(__dirname, "../../..");
const name = "20261020180000_prompter_billing_security_hardening_p0";
const sql = readFileSync(path.join(root, `supabase/migrations/${name}.sql`), "utf-8");
const code = sql.replace(/--.*$/gm, "");

describe("billing security hardening P0 migration", () => {
  it("closes direct plan updates: policy dropped, UPDATE revoked from authenticated and anon", () => {
    expect(code).toMatch(/drop policy if exists "Owner kelola subscription" on public\.prompter_subscriptions/);
    expect(code).toMatch(/revoke update on public\.prompter_subscriptions from authenticated, anon/);
  });

  it("closes direct transaction inserts and revokes every client write on the billing evidence tables", () => {
    expect(code).toMatch(/drop policy if exists "Buat payment transaction tenant sendiri"/);
    for (const t of ["prompter_payment_transactions", "prompter_invoices", "prompter_webhook_events"]) {
      expect(code).toMatch(new RegExp(`revoke insert, update, delete, truncate on public\\.${t} from authenticated, anon`));
    }
    expect(code).toMatch(/revoke update, delete, truncate on public\.prompter_audit_logs from authenticated, anon/);
  });

  it("the only client-reachable plan writer is SECURITY DEFINER with a pinned search_path, JWT-derived tenant, Owner + TRIALING only", () => {
    const fn = code.slice(code.indexOf("create or replace function public.fn_set_trial_plan_preference"), code.indexOf("comment on function public.fn_set_trial_plan_preference"));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = public/);
    expect(fn).toMatch(/fn_current_tenant_id\(\)/);
    expect(fn).toMatch(/fn_current_role\(\) is distinct from 'owner'/);
    expect(fn).toMatch(/v_status <> 'TRIALING'/);
    expect(fn).not.toMatch(/p_tenant|status\s*=\s*'ACTIVE'/);
    expect(code).toMatch(/revoke all on function public\.fn_set_trial_plan_preference\(text\) from public, anon/);
    expect(code).toMatch(/grant execute on function public\.fn_set_trial_plan_preference\(text\) to authenticated/);
  });

  it("refuses to run before PR #44 (fn_begin_checkout) unless explicitly overridden", () => {
    expect(code).toMatch(/to_regprocedure\('public\.fn_begin_checkout/);
    expect(code).toMatch(/allow_close_txn_insert_without_v2/);
    expect(code).toMatch(/raise exception 'refused/);
  });

  it("trial carryover is capped at 14 days and only on TRIALING -> ACTIVE with a period change", () => {
    expect(code).toMatch(/old\.status = 'TRIALING' and new\.status = 'ACTIVE'/);
    expect(code).toMatch(/interval '14 days'/);
    expect(code).toMatch(/new\.current_period_end is distinct from old\.current_period_end/);
  });

  it("touches only prompter_ objects: no PUBLOE/UMKMpro/Apotek or other shared table is referenced", () => {
    const refs = [...code.matchAll(/public\.([a-z_0-9]+)/g)].map((m) => m[1]);
    for (const r of refs) expect(r, r).toMatch(/^(prompter_|fn_)/);
    expect(code).not.toMatch(/\b(tenants|user_profiles)\b/);
  });

  it("modifies no rows (no mass change of existing tenants' entitlements)", () => {
    const outsideFunctions = code.replace(/create or replace function[\s\S]*?\$\$;/g, "");
    expect(outsideFunctions).not.toMatch(/\b(insert into|delete from|update\s+public\.|truncate\s+table)\b/i);
  });

  it("has a rollback script that restores the previous grants and policies", () => {
    const down = path.join(root, `supabase/rollback/${name}.down.sql`);
    expect(existsSync(down)).toBe(true);
    const d = readFileSync(down, "utf-8");
    expect(d).toMatch(/grant update \(plan\) on public\.prompter_subscriptions to authenticated/);
    expect(d).toMatch(/create policy "Owner kelola subscription"/);
    expect(d).toMatch(/create policy "Buat payment transaction tenant sendiri"/);
    expect(d).toMatch(/drop trigger if exists trg_prompter_subscriptions_trial_carryover/);
  });
});
