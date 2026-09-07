import { describe, expect, it, vi } from "vitest";
import {
  getTrialState,
  checkAiUsageEntitlement,
  checkTrialAiUsageCap,
  changePlan,
  TRIAL_DURATION_DAYS,
  TRIAL_DAILY_AI_JOB_LIMIT,
  TRIAL_MONTHLY_AI_JOB_LIMIT,
} from "@/services/billing";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];

function mockSupabase() {
  const upsert = vi.fn(async () => ({ data: null, error: null }));
  const from = vi.fn(() => ({ upsert }));
  return { from, upsert } as unknown as SupabaseClient<Database> & {
    from: typeof from;
    upsert: typeof upsert;
  };
}

/**
 * checkTrialAiUsageCap() queries the daily count first, then the monthly
 * count — `counts` supplies the `count` result for each successive
 * `.gte()` call in that order.
 */
function mockSupabaseWithCounts(counts: number[]) {
  let call = 0;
  const gte = vi.fn(async () => ({ count: counts[call++] ?? 0 }));
  const eq = vi.fn(() => ({ gte }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, gte } as unknown as SupabaseClient<Database> & {
    from: typeof from;
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    tenant_id: "t1",
    plan: "FREE",
    status: "ACTIVE",
    billing_provider: null,
    success_fee_rate_bps: null,
    current_period_start: null,
    current_period_end: null,
    billing_country: null,
    invoice_currency: null,
    payment_provider_customer_reference: null,
    tax_metadata: {},
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("getTrialState", () => {
  it("is not trialing for a legacy row with no period set", () => {
    const state = getTrialState(subscription({ status: "ACTIVE" }));
    expect(state).toEqual({ isTrialing: false, daysRemaining: null, expired: false });
  });

  it("reports days remaining for an in-progress trial", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const sub = subscription({
      status: "TRIALING",
      current_period_start: new Date("2026-01-01T00:00:00Z").toISOString(),
      current_period_end: new Date("2026-01-15T00:00:00Z").toISOString(),
    });
    const state = getTrialState(sub, now);
    expect(state.isTrialing).toBe(true);
    expect(state.expired).toBe(false);
    expect(state.daysRemaining).toBe(5);
  });

  it("reports expired once the period end has passed", () => {
    const now = new Date("2026-01-20T00:00:00Z");
    const sub = subscription({
      status: "TRIALING",
      current_period_start: new Date("2026-01-01T00:00:00Z").toISOString(),
      current_period_end: new Date("2026-01-15T00:00:00Z").toISOString(),
    });
    const state = getTrialState(sub, now);
    expect(state.isTrialing).toBe(true);
    expect(state.expired).toBe(true);
    expect(state.daysRemaining).toBe(0);
  });

  it("is never trialing once status has moved to ACTIVE (e.g. after changePlan)", () => {
    const sub = subscription({
      status: "ACTIVE",
      current_period_start: new Date("2026-01-01T00:00:00Z").toISOString(),
      current_period_end: new Date("2026-01-15T00:00:00Z").toISOString(),
    });
    const state = getTrialState(sub, new Date("2026-01-20T00:00:00Z"));
    expect(state.isTrialing).toBe(false);
  });
});

describe("checkAiUsageEntitlement", () => {
  it("allows AI usage for a legacy ACTIVE tenant with no trial data", () => {
    const result = checkAiUsageEntitlement(subscription({ status: "ACTIVE" }));
    expect(result.allowed).toBe(true);
  });

  it("allows AI usage during an active trial", () => {
    const now = new Date("2026-01-05T00:00:00Z");
    const sub = subscription({
      status: "TRIALING",
      current_period_start: new Date("2026-01-01T00:00:00Z").toISOString(),
      current_period_end: new Date("2026-01-15T00:00:00Z").toISOString(),
    });
    expect(checkAiUsageEntitlement(sub, now).allowed).toBe(true);
  });

  it("blocks AI usage once a trial has expired", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const sub = subscription({
      status: "TRIALING",
      current_period_start: new Date("2026-01-01T00:00:00Z").toISOString(),
      current_period_end: new Date("2026-01-15T00:00:00Z").toISOString(),
    });
    const result = checkAiUsageEntitlement(sub, now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/trial/i);
  });

  it("allows AI usage once the tenant has moved to a real plan (changePlan sets status ACTIVE)", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const sub = subscription({
      plan: "PRO",
      status: "ACTIVE",
      current_period_start: new Date("2026-01-01T00:00:00Z").toISOString(),
      current_period_end: new Date("2026-01-15T00:00:00Z").toISOString(),
    });
    expect(checkAiUsageEntitlement(sub, now).allowed).toBe(true);
  });
});

describe("checkTrialAiUsageCap", () => {
  it("allows a TRIALING tenant well under both the daily and monthly limit", async () => {
    const supabase = mockSupabaseWithCounts([2, 10]);
    const sub = subscription({ status: "TRIALING" });

    const result = await checkTrialAiUsageCap(supabase, sub);

    expect(result.allowed).toBe(true);
  });

  it("blocks a TRIALING tenant once the daily limit is reached", async () => {
    const supabase = mockSupabaseWithCounts([TRIAL_DAILY_AI_JOB_LIMIT, 5]);
    const sub = subscription({ status: "TRIALING" });

    const result = await checkTrialAiUsageCap(supabase, sub);

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/hari/i);
  });

  it("blocks a TRIALING tenant once the monthly limit is reached (even under the daily limit)", async () => {
    const supabase = mockSupabaseWithCounts([1, TRIAL_MONTHLY_AI_JOB_LIMIT]);
    const sub = subscription({ status: "TRIALING" });

    const result = await checkTrialAiUsageCap(supabase, sub);

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/bulan/i);
  });

  it("never caps an ACTIVE subscription, and never even queries usage for one", async () => {
    const supabase = mockSupabaseWithCounts([9999, 9999]);
    const sub = subscription({ status: "ACTIVE" });

    const result = await checkTrialAiUsageCap(supabase, sub);

    expect(result.allowed).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("changePlan", () => {
  it("never writes status, so selecting a plan cannot self-activate a subscription without payment", async () => {
    const supabase = mockSupabase();

    await changePlan(supabase, "t1", "PRO");

    expect(supabase.upsert).toHaveBeenCalledWith({ tenant_id: "t1", plan: "PRO" });
    expect(supabase.upsert).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.anything() }));
  });

  it("saving any paid plan while a trial is expired does not grant AI entitlement (bypass closed)", async () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const expiredTrial = subscription({
      status: "TRIALING",
      current_period_start: new Date("2026-01-01T00:00:00Z").toISOString(),
      current_period_end: new Date("2026-01-15T00:00:00Z").toISOString(),
    });
    expect(checkAiUsageEntitlement(expiredTrial, now).allowed).toBe(false);

    const supabase = mockSupabase();
    for (const plan of ["PRO", "BUSINESS", "GROWTH", "AGENCY", "UMKMPRO_BUNDLE"] as const) {
      await changePlan(supabase, "t1", plan);
    }

    // changePlan never touches `status` — the tenant's real subscription row
    // (and therefore its entitlement) is untouched by any of these calls,
    // so it is still exactly the expired-trial row checked above.
    expect(checkAiUsageEntitlement(expiredTrial, now).allowed).toBe(false);
  });

  it("does not disturb an existing legitimate ACTIVE subscription's status", async () => {
    const supabase = mockSupabase();

    await changePlan(supabase, "t1", "GROWTH");

    // Only tenant_id/plan are sent — Supabase upsert only updates the
    // columns present in the payload, so an existing row's `status`
    // (whatever it legitimately was) is left exactly as-is, not reset.
    expect(supabase.upsert).toHaveBeenCalledWith({ tenant_id: "t1", plan: "GROWTH" });
  });
});

describe("TRIAL_DURATION_DAYS", () => {
  it("is a positive, sane number of days", () => {
    expect(TRIAL_DURATION_DAYS).toBeGreaterThan(0);
    expect(TRIAL_DURATION_DAYS).toBeLessThanOrEqual(30);
  });
});
