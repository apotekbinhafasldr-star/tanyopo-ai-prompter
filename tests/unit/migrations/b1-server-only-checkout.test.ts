import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLAN_TIERS } from "@/lib/billing/plans";

/**
 * Static invariants for Billing B1 (no live Postgres in this job). The behavioural proof (Owner cannot create a
 * transaction, only the service-role RPC can, priced from the DB catalog; tenant isolation; webhook still works;
 * #74 composes; fail-closed rollback; trial carryover) runs in CI job billing-b1-sql: supabase/tests/b1-checkout.
 */
const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");
const executable = (sql: string) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const MIG = "supabase/migrations/20261030100000_prompter_b1_server_only_checkout.sql";
const MIG2 = "supabase/migrations/20261030100100_prompter_b1_trial_remainder_carryover.sql";
const DOWN = "supabase/rollback/20261030100000_prompter_b1_server_only_checkout.down.sql";
const DOWN2 = "supabase/rollback/20261030100100_prompter_b1_trial_remainder_carryover.down.sql";
const sql = executable(read(MIG)).replace(/comment on (function|table)[\s\S]*?';/g, "");

describe("B1 migration: no client write path to prompter_payment_transactions", () => {
  it("drops the client INSERT policy and revokes every client privilege, granting SELECT back only to authenticated", () => {
    expect(sql).toContain('drop policy if exists "Buat payment transaction tenant sendiri" on public.prompter_payment_transactions;');
    expect(sql).toMatch(/revoke all on public\.prompter_payment_transactions from public, anon, authenticated;/);
    expect(sql).toMatch(/grant select on public\.prompter_payment_transactions to authenticated;/);
    expect(sql).not.toMatch(/create policy/i);
  });

  it("has no amount, price or currency parameter on fn_begin_checkout", () => {
    const sig = sql.match(/create or replace function public\.fn_begin_checkout\(([\s\S]*?)\)\s*returns/);
    expect(sig).not.toBeNull();
    expect(sig![1]).not.toMatch(/amount|price|currency/i);
    expect(sig![1]).toMatch(/p_tenant_id uuid[\s\S]*p_user_id uuid[\s\S]*p_plan text[\s\S]*p_provider text/);
  });

  it("fn_begin_checkout is SECURITY DEFINER with a pinned search_path, revoked from clients and granted to service_role only", () => {
    expect(sql).toMatch(/fn_begin_checkout[\s\S]*?security definer\s+set search_path = public/);
    expect(sql).toContain("revoke all on function public.fn_begin_checkout(uuid, uuid, text, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.fn_begin_checkout(uuid, uuid, text, text) to service_role;");
    expect(sql).not.toMatch(/grant execute on function public\.fn_begin_checkout[^;]*to[^;]*(anon|authenticated|public)/);
  });

  it("re-verifies Owner membership and plan availability in SQL and prices only from the catalog", () => {
    expect(sql).toMatch(/from public\.user_profiles where id = p_user_id/);
    expect(sql).toMatch(/v_role is distinct from 'owner'/);
    expect(sql).toMatch(/from public\.prompter_plan_prices pr\s+join public\.prompter_plan_entitlements e/);
    expect(sql).toMatch(/v_availability is distinct from 'ACTIVE'/);
    expect(sql).toMatch(/insert into public\.prompter_payment_transactions \(tenant_id, user_id, provider, plan, amount, currency\)\s+values \(p_tenant_id, p_user_id, p_provider, p_plan, v_price, v_currency\)/);
  });

  it("the insert guard is SECURITY INVOKER (so current_user is the real caller), rejects client roles and checks the catalog", () => {
    const fn = sql.match(/create or replace function public\.fn_payment_txn_insert_guard\(\)[\s\S]*?\$\$;/)![0];
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toContain("current_user in ('anon', 'authenticated')");
    expect(fn).toMatch(/from public\.prompter_plan_prices where plan = new\.plan/);
    expect(sql).toMatch(/create trigger trg_prompter_payment_txn_insert_guard\s+before insert on public\.prompter_payment_transactions/);
  });

  it("price table is closed to clients (RLS on, all privileges revoked, no policy) and seeded idempotently", () => {
    expect(sql).toContain("alter table public.prompter_plan_prices enable row level security;");
    expect(sql).toContain("revoke all on public.prompter_plan_prices from public, anon, authenticated;");
    expect(sql).toMatch(/on conflict \(plan\) do nothing;/);
  });

  it("does not touch prompter_subscriptions, fn_apply_verified_payment, #74 objects, service_role grants on tables or any other product's tables", () => {
    expect(sql).not.toMatch(/alter table public\.prompter_subscriptions|policy[^;]*on public\.prompter_subscriptions|trigger[^;]*on public\.prompter_subscriptions/i);
    expect(sql).not.toMatch(/fn_apply_verified_payment|fn_set_trial_plan_preference|fn_block_client_subscription_update/);
    expect(sql).not.toMatch(/\b(delete from|truncate table|drop table|drop column)\b/i);
    expect(sql).not.toMatch(/\bupdate public\./i);
    expect(sql).not.toMatch(/publoe|mitapeng|umkmpro_|apotek/i);
  });

  it("runs in one transaction context with a lock timeout", () => {
    expect(sql).toMatch(/^\s*set local lock_timeout = '3s';/m);
  });
});

describe("B1 price catalog never drifts from lib/billing/plans.ts", () => {
  const seeded = Array.from(read(MIG).matchAll(/\('([A-Z_]+)',\s*(\d+)\)/g)).map((m) => [m[1], Number(m[2])] as const);

  it("seeds exactly the ACTIVE paid tiers with the same priceIDR as the code catalog", () => {
    const expected = PLAN_TIERS.filter((t) => t.availability === "ACTIVE" && t.priceIDR > 0).map((t) => [t.id, t.priceIDR] as const);
    expect([...seeded].sort()).toEqual([...expected].sort());
  });

  it("never seeds FREE, AGENCY (coming soon) or the bundle", () => {
    const ids = seeded.map(([id]) => id);
    for (const bad of ["FREE", "AGENCY", "UMKMPRO_BUNDLE"]) expect(ids).not.toContain(bad);
  });
});

describe("B1 rollback files", () => {
  it("transaction rollback is fail-closed, never re-grants UPDATE / DELETE / TRUNCATE, and is plain SQL", () => {
    const down = read(DOWN);
    expect(down).toContain("REPLACE_WITH_CONFIRMATION");
    expect(down).toContain("I_UNDERSTAND_THIS_REOPENS_CLIENT_TXN_INSERT");
    const code = executable(down);
    expect(code).not.toMatch(/grant (update|delete|truncate|all)/i);
    expect(code).not.toMatch(/drop table/i);
    expect(code).not.toMatch(/^\s*\\/m);
  });

  it("carryover migration only touches its own trigger and the trial -> active transition, and its rollback just drops them", () => {
    const code = executable(read(MIG2));
    expect(code).toMatch(/old\.status = 'TRIALING' and new\.status = 'ACTIVE'/);
    expect(code).toContain("interval '14 days'");
    expect(code).not.toMatch(/\b(insert into|delete from|truncate|update public\.)/i);
    const down = executable(read(DOWN2));
    expect(down).toMatch(/drop trigger if exists trg_prompter_subscriptions_trial_carryover/);
    expect(down).toMatch(/drop function if exists public\.fn_subscription_trial_carryover\(\)/);
  });
});
