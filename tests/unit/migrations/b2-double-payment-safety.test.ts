import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Static invariants for Billing B2 (no live Postgres in this job). The behavioural proof (scenarios A-F: parallel
 * checkout, double payment, repeated / parallel webhooks, activation failure, second payment during trial, late payment,
 * plan conflict, #74/#75 composition, rollback) runs in CI job billing-b2-sql: supabase/tests/b2-double-payment.
 */
const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");
const executable = (sql: string) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const MIG = "supabase/migrations/20261030140000_prompter_b2_double_payment_safety.sql";
const DOWN = "supabase/rollback/20261030140000_prompter_b2_double_payment_safety.down.sql";
const sql = executable(read(MIG)).replace(/comment on (function|table)[\s\S]*?';/g, "");

describe("B2 migration: payment activation", () => {
  it("adds one period to a running same-plan paid period instead of overwriting it", () => {
    expect(sql).toMatch(/v_end := v_sub\.current_period_end \+ interval '1 month';/);
    expect(sql).toMatch(/v_end := v_now \+ interval '1 month';/);
  });

  it("requires the subscription UPDATE to affect exactly one row, otherwise raises (nothing is left PAID)", () => {
    expect(sql).toMatch(/get diagnostics v_rows = row_count;/);
    expect(sql).toMatch(/if v_rows <> 1 then[\s\S]*raise exception 'SUBSCRIPTION_UPDATE_AFFECTED_%/);
  });

  it("never changes the plan during a paid period and never drops a payment it cannot apply (REVIEW)", () => {
    expect(sql).toContain("v_review := 'PLAN_CONFLICT_ACTIVE_PERIOD'");
    expect(sql).toContain("v_review := 'AMOUNT_OR_CURRENCY_MISMATCH'");
    expect(sql).toContain("v_review := 'NO_SUBSCRIPTION'");
    expect(sql).toContain("v_review := 'LATE_PAYMENT_' || v_txn.status");
    expect(sql).toMatch(/set status = 'REVIEW'/);
  });

  it("stays idempotent per transaction and locks the transaction then the subscription row", () => {
    expect(sql).toMatch(/where id = p_transaction_id for update;/);
    expect(sql).toMatch(/if v_txn\.status = 'PAID' then[\s\S]*?'ALREADY_PROCESSED'/);
    expect(sql).toMatch(/from public\.prompter_subscriptions where tenant_id = v_txn\.tenant_id for update;/);
  });

  it("does not add its own trial bonus (the carryover trigger remains the single place, TRIALING -> ACTIVE only)", () => {
    expect(sql).not.toMatch(/interval '14 days'|interval '13 days'|v_remaining/);
  });
});

describe("B2 migration: checkout", () => {
  it("enforces one open PENDING invoice per tenant with a partial unique index", () => {
    expect(sql).toMatch(/create unique index if not exists uq_prompter_payment_txn_one_pending_per_tenant[\s\S]*?where status = 'PENDING';/);
  });

  it("refuses a plan change during a paid period and returns the same invoice for an identical request", () => {
    expect(sql).toContain("'PLAN_CHANGE_NOT_ALLOWED'");
    expect(sql).toContain("'EXISTING'");
    expect(sql).toMatch(/interval '30 minutes'/);
  });

  it("still has NO amount / currency parameter on fn_begin_checkout", () => {
    const sig = sql.match(/create or replace function public\.fn_begin_checkout\(([\s\S]*?)\) returns table/);
    expect(sig?.[1]).toBeTruthy();
    expect(sig?.[1]).not.toMatch(/amount|currency|price/i);
  });
});

describe("B2 resolver", () => {
  it("demands gateway evidence: recorded reference, status PAID, matching amount, and leaves an audit row", () => {
    expect(sql).toContain("'NO_RECORDED_PAYMENT_REFERENCE'");
    expect(sql).toContain("p_gateway_reference <> v_txn.provider_payment_id");
    expect(sql).toContain("'GATEWAY_REFERENCE_MISMATCH'");
    expect(sql).toContain("p_gateway_status is distinct from 'PAID'");
    expect(sql).toContain("'payment.review_resolution_attempted'");
  });
});

describe("B2 migration: privileges and scope", () => {
  it("all three functions are service_role only", () => {
    for (const fn of [
      "fn_apply_verified_payment(uuid, text, text, numeric, text)",
      "fn_resolve_review_payment(uuid, numeric, text, text, text)",
      "fn_begin_checkout(uuid, uuid, text, text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });

  it("only touches the Prompter payment objects (no PUBLOE / UMKMpro / user_profiles / subscriptions DDL)", () => {
    expect(sql).not.toMatch(/alter table public\.(prompter_subscriptions|user_profiles|tenants)/);
    expect(sql).not.toMatch(/publoe|mitapeng|umkmpro_/i);
    expect(sql).not.toMatch(/\bdelete from\b|\btruncate\b/);
  });

  it("does not modify B1 / #74 objects (guard trigger, price catalog, client privileges)", () => {
    expect(sql).not.toMatch(/trg_prompter_payment_txn_insert_guard|trg_prompter_subscriptions_block_client_update|trg_prompter_subscriptions_trial_carryover/);
    expect(sql).not.toMatch(/prompter_plan_prices\s+(set|\()|grant .* to (anon|authenticated)/);
  });
});

describe("B2 rollback", () => {
  const down = executable(read(DOWN));
  it("never modifies or deletes a transaction, subscription or audit row (evidence and customer data untouched)", () => {
    const outsideFunctions = down.replace(/create or replace function[\s\S]*?\n\$\$;/g, "");
    expect(outsideFunctions).not.toMatch(/\b(delete from|truncate|insert into)\b|\bupdate\s+public\./i);
  });
  it("is fail-closed while any REVIEW transaction exists and restores the v1 functions", () => {
    expect(down).toMatch(/where status = 'REVIEW'[\s\S]*?rollback refused/);
    expect(down).toContain("drop function if exists public.fn_resolve_review_payment(uuid, numeric, text, text, text);");
    expect(down).toContain("drop index if exists public.uq_prompter_payment_txn_one_pending_per_tenant;");
    expect(down).toMatch(/create or replace function public\.fn_apply_verified_payment/);
    expect(down).toMatch(/create or replace function public\.fn_begin_checkout/);
  });
});
