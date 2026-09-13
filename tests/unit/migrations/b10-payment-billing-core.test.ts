import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Batch B10 — static safety-invariant checks on the payment/billing
 * migration, same rationale as tests/unit/migrations/b9-entitlement-enforcement.test.ts:
 * this project has no live-Postgres integration harness in CI, so these
 * pin the SQL text itself against accidental removal of a safety
 * property, rather than exercising it.
 */
const migrationPath = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260913090000_prompter_b10_payment_billing_core.sql",
);
const sql = readFileSync(migrationPath, "utf-8");

describe("B10 payment/billing migration — P0-1 (client cannot self-activate)", () => {
  it("revokes UPDATE on prompter_subscriptions from authenticated/anon and grants only the plan column back", () => {
    expect(sql).toContain("revoke update on public.prompter_subscriptions from authenticated, anon;");
    expect(sql).toContain("grant update (plan) on public.prompter_subscriptions to authenticated;");
  });

  it("the INSERT policy pins a client-initiated subscription row to the canonical fresh-trial shape", () => {
    expect(sql).toContain("status = 'TRIALING'");
    expect(sql).toContain("plan = 'FREE'");
    expect(sql).toContain("billing_provider is null");
  });

  it("fn_apply_verified_payment is the only place that sets prompter_subscriptions.status = 'ACTIVE', and is revoked from authenticated/anon", () => {
    // Distinct from prompter_products/prompter_master_campaigns' own
    // unrelated `status = 'ACTIVE'` values — this pins the exact
    // subscription-activation assignment to appear exactly once.
    const subscriptionActivations = (
      sql.match(/update public\.prompter_subscriptions\s*\n\s*set\s*\n\s*plan = v_txn\.plan,\s*\n\s*status = 'ACTIVE',/g) ??
      []
    ).length;
    expect(subscriptionActivations).toBe(1);
    expect(sql).toContain("revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from authenticated;");
    expect(sql).toContain("revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from anon;");
  });
});

describe("B10 payment/billing migration — B9 gap closure (Gap 1 & Gap 2)", () => {
  it("every entitlement function ignores the plan column while TRIALING and always uses FREE-tier numbers instead", () => {
    const trialingForcesFree = (sql.match(/when v_sub\.status = 'TRIALING' then 'FREE'/g) ?? []).length;
    expect(trialingForcesFree).toBe(3); // fn_create_ai_job_if_entitled, fn_activate_product, fn_reserve_active_campaign_slot
  });

  it("every entitlement function explicitly denies PAST_DUE/CANCELED subscriptions", () => {
    const denialCount = (sql.match(/status in \('PAST_DUE', 'CANCELED'\)/g) ?? []).length;
    expect(denialCount).toBe(3);
  });

  it("B9's canonical numeric limits are not touched by this migration (no new prompter_plan_entitlements seed/update)", () => {
    expect(sql).not.toMatch(/insert into public\.prompter_plan_entitlements/i);
    expect(sql).not.toMatch(/update public\.prompter_plan_entitlements/i);
  });
});

describe("B10 payment/billing migration — payment_transactions integrity", () => {
  it("has a unique constraint on (provider, provider_payment_id) for idempotency", () => {
    expect(sql).toContain("constraint prompter_payment_transactions_provider_payment_unique unique (provider, provider_payment_id)");
  });

  it("client can only ever INSERT a PENDING transaction with no pre-filled payment/paid fields", () => {
    expect(sql).toContain('status = \'PENDING\'\n    and provider_payment_id is null\n    and provider_event_id is null\n    and paid_at is null');
  });

  it("has no UPDATE/DELETE policy for anon/authenticated — only service_role (via fn_apply_verified_payment) can transition status", () => {
    const paymentSectionStart = sql.indexOf("create table if not exists public.prompter_payment_transactions");
    const paymentSectionEnd = sql.indexOf("fn_apply_verified_payment() -- the ONLY code path");
    const paymentSection = sql.slice(paymentSectionStart, paymentSectionEnd);
    expect(paymentSection).not.toMatch(/for update/i);
    expect(paymentSection).not.toMatch(/for delete/i);
  });
});

describe("B10 payment/billing migration — safety", () => {
  it("every advisory-lock-bearing entitlement function still has its lock (untouched by the B10 edit)", () => {
    const lockCount = (sql.match(/pg_advisory_xact_lock/g) ?? []).length;
    expect(lockCount).toBeGreaterThanOrEqual(3);
  });

  it("no destructive DDL — additive/idempotent only", () => {
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it("fn_schedule_cancellation is Owner-callable but fn_apply_scheduled_cancellations is service_role only", () => {
    expect(sql).toContain("grant execute on function public.fn_schedule_cancellation(boolean) to authenticated;");
    expect(sql).toContain("revoke all on function public.fn_apply_scheduled_cancellations() from authenticated;");
  });
});
