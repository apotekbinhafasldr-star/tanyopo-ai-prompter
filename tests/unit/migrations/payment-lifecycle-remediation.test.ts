import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Payment Remediation (post-B11 payment-readiness audit) — static
 * safety-invariant checks on the new payment/subscription lifecycle
 * migration, same rationale as the other tests/unit/migrations/*.test.ts
 * files: this project has no live-Postgres integration harness in CI, so
 * these pin the SQL text itself against accidental removal of a safety
 * property, rather than exercising it.
 */
const migrationPath = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260926120000_prompter_payment_lifecycle_remediation.sql",
);
const sql = readFileSync(migrationPath, "utf-8");

describe("Payment lifecycle remediation migration", () => {
  it("does not touch fn_apply_verified_payment, fn_schedule_cancellation, or fn_apply_scheduled_cancellations (FROZEN)", () => {
    expect(sql).not.toMatch(/create or replace function public\.fn_apply_verified_payment/);
    expect(sql).not.toMatch(/create or replace function public\.fn_schedule_cancellation\(/);
    expect(sql).not.toMatch(/create or replace function public\.fn_apply_scheduled_cancellations/);
  });

  it("does not touch the B9 entitlement functions or the Trial Expiry fix (FROZEN)", () => {
    expect(sql).not.toMatch(/create or replace function public\.fn_create_ai_job_if_entitled/);
    expect(sql).not.toMatch(/create or replace function public\.fn_activate_product/);
    expect(sql).not.toMatch(/create or replace function public\.fn_reserve_active_campaign_slot/);
  });

  it("no destructive DDL anywhere in this migration", () => {
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdrop column\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
  });

  describe("Poin G/H/I — fn_apply_expired_subscriptions()", () => {
    it("only matches ACTIVE subscriptions whose current_period_end has already passed", () => {
      expect(sql).toContain("where status = 'ACTIVE'");
      expect(sql).toContain("and current_period_end is not null");
      expect(sql).toContain("and current_period_end < now()");
    });

    it("moves them to the existing PAST_DUE status — no new status introduced", () => {
      expect(sql).toContain("set status = 'PAST_DUE'");
    });

    it("is revoked from anon/authenticated (service_role / pg_cron only)", () => {
      expect(sql).toContain("revoke all on function public.fn_apply_expired_subscriptions() from anon;");
      expect(sql).toContain("revoke all on function public.fn_apply_expired_subscriptions() from authenticated;");
    });
  });

  describe("Poin G/H/I — fn_expire_stale_payment_transactions()", () => {
    it("only matches PENDING transactions older than the expiry window", () => {
      expect(sql).toContain("where status = 'PENDING'");
      expect(sql).toContain("and created_at < now() - interval '24 hours'");
    });

    it("moves them to the existing EXPIRED status, never PAID/FAILED/CANCELLED", () => {
      expect(sql).toContain("set status = 'EXPIRED'");
    });

    it("never appears anywhere with a status filter that would match PAID (never expires a paid transaction)", () => {
      const updateBlock = sql.slice(
        sql.indexOf("fn_expire_stale_payment_transactions()\nreturns integer"),
      );
      expect(updateBlock).not.toMatch(/status = 'PAID'/);
    });

    it("is revoked from anon/authenticated (service_role / pg_cron only)", () => {
      expect(sql).toContain("revoke all on function public.fn_expire_stale_payment_transactions() from anon;");
      expect(sql).toContain("revoke all on function public.fn_expire_stale_payment_transactions() from authenticated;");
    });
  });

  describe("pg_cron scheduling — separate jobs from the FROZEN P0-3 job", () => {
    it("does not reuse or redefine the P0-3 job name", () => {
      // The P0-3 job name may appear in an explanatory comment (it does,
      // for context) but must never appear as an argument to
      // cron.schedule() in this migration — that would mean this
      // migration is re-scheduling/modifying the FROZEN P0-3 job.
      expect(sql).not.toMatch(/cron\.schedule\(\s*\n\s*'prompter-apply-scheduled-cancellations'/);
    });

    it("schedules two distinct, uniquely-named jobs", () => {
      expect(sql).toContain("'prompter-apply-expired-subscriptions'");
      expect(sql).toContain("'prompter-expire-stale-payment-transactions'");
    });

    it("enables pg_cron idempotently (no-op on the shared project where it's already enabled)", () => {
      expect(sql).toContain("create extension if not exists pg_cron;");
    });
  });
});
