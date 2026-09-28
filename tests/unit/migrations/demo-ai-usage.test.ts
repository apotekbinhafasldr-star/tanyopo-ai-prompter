import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * LINOE Demo Environment Phase 1 — static safety-invariant checks on the
 * demo AI-usage migration, mirroring the pattern established by
 * tests/unit/migrations/b9-entitlement-enforcement.test.ts. This project
 * has no live-Postgres integration test harness, so these pin the SQL
 * text itself: an edit that accidentally weakens one of these properties
 * (e.g. re-scoping the table by tenant, or opening it to `authenticated`)
 * fails CI even without a live database.
 */
const migrationPath = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260928120000_prompter_demo_ai_usage.sql",
);
const sql = readFileSync(migrationPath, "utf-8");

describe("demo AI-usage migration — safety invariants", () => {
  it("creates the table with RLS enabled", () => {
    expect(sql).toContain(
      "alter table public.prompter_demo_ai_usage enable row level security;",
    );
  });

  it("revokes all table access from anon and authenticated — service-role/admin-client only, no policy grants either role a path in", () => {
    expect(sql).toContain("revoke all on public.prompter_demo_ai_usage from anon, authenticated;");
    // No CREATE POLICY at all — deny-by-default for every non-service-role caller.
    expect(sql).not.toMatch(/create policy/i);
  });

  it("is never scoped by tenant_id — a demo session is never a real tenant", () => {
    expect(sql).not.toMatch(/tenant_id/);
    expect(sql).not.toMatch(/fn_current_tenant_id/);
  });

  it("the consume function is SECURITY DEFINER with a pinned search_path, and revokes execute from anon/authenticated/public", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain(
      "revoke all on function public.fn_consume_demo_ai_usage(text, integer) from public, anon, authenticated;",
    );
  });

  it("the used_count column can never go negative", () => {
    expect(sql).toMatch(/check\s*\(used_count >= 0\)/);
  });

  it("schedules no cron job (Founder STOP condition — production cron requires separate approval)", () => {
    expect(sql).not.toMatch(/cron\.schedule/);
  });

  it("the RPC derives the hard cap from its own parameter, never a hardcoded/looser value baked into SQL", () => {
    expect(sql).toContain("v_used_count > p_hard_cap");
  });
});
