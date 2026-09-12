import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLAN_TIERS } from "@/lib/billing/plans";

/**
 * Batch B9 — static safety-invariant checks on the entitlement migration.
 * This project has no live-Postgres integration test harness (unit tests
 * run against mocked Supabase clients only, see tests/unit/setup.ts), so
 * the migration's actual runtime behavior (advisory locks, fail-closed
 * fallbacks, tenant derivation) cannot be executed here. These tests
 * instead pin the SQL text itself, so an edit that accidentally removes
 * one of these safety properties fails CI even without a live database —
 * and a founder/reviewer with a Supabase branch can still run the
 * migration for full end-to-end confirmation before go-live (see the B9
 * remediation report's "Residual risk" section).
 */
const migrationPath = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260912090000_prompter_b9_entitlement_enforcement.sql",
);
const sql = readFileSync(migrationPath, "utf-8");

describe("B9 entitlement migration — canonical numbers match lib/billing/plans.ts", () => {
  it("never invents a number — every non-null limit in the migration's seed matches PLAN_TIERS exactly", () => {
    for (const tier of PLAN_TIERS) {
      const row = new RegExp(
        `\\('${tier.id}',\\s*${tier.limits.aiUsageAllowance},\\s*` +
          `${tier.limits.maxActiveProducts ?? "null"},\\s*` +
          `${tier.limits.maxActiveCampaigns ?? "null"},\\s*` +
          `${tier.limits.maxUsers ?? "null"},\\s*'${tier.availability}'\\)`,
      );
      expect(sql, `seed row for ${tier.id} must mirror PLAN_TIERS`).toMatch(row);
    }
  });
});

describe("B9 entitlement migration — safety invariants", () => {
  it("every enforcement function derives tenant identity from fn_current_tenant_id(), never a client-supplied parameter", () => {
    expect(sql).toContain("v_tenant_id := public.fn_current_tenant_id();");
    expect(sql).not.toMatch(/p_tenant_id/);
  });

  it("the AI usage, product, and campaign gates each take a per-tenant advisory transaction lock (P1-2 TOCTOU fix)", () => {
    const lockCount = (sql.match(/pg_advisory_xact_lock/g) ?? []).length;
    expect(lockCount).toBeGreaterThanOrEqual(3);
  });

  it("an unrecognized plan falls back to the conservative FREE tier rather than granting unlimited access (fail-closed)", () => {
    const fallbacks = (sql.match(/where plan = 'FREE';/g) ?? []).length;
    expect(fallbacks).toBeGreaterThanOrEqual(3);
  });

  it("every sensitive function revokes execute from anon/public and grants only to authenticated", () => {
    for (const fn of [
      "fn_create_ai_job_if_entitled(text, jsonb)",
      "fn_activate_product(uuid)",
      "fn_archive_product(uuid)",
      "fn_reserve_active_campaign_slot(uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn} from anon;`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
  });

  it("the campaign gate's consuming-status set matches the B9 canonical definition (ACTIVE/SCHEDULED/AWAITING_APPROVAL/PAUSED)", () => {
    expect(sql).toContain("status in ('ACTIVE', 'SCHEDULED', 'AWAITING_APPROVAL', 'PAUSED')");
  });

  it("Agency (COMING_SOON) cannot be persisted onto prompter_subscriptions even via a direct write — DB trigger backstop for P1-1", () => {
    expect(sql).toContain("before insert or update of plan on public.prompter_subscriptions");
    expect(sql).toContain("v_availability = 'COMING_SOON'");
  });

  it("no destructive DDL — additive/idempotent only", () => {
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).not.toMatch(/delete from/i);
    expect(sql).not.toMatch(/truncate/i);
  });
});
