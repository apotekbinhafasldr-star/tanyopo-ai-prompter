import { describe, expect, it, vi } from "vitest";
import { getTrialState, changePlan, TRIAL_DURATION_DAYS } from "@/services/billing";
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

describe("changePlan", () => {
  it("never writes status, so selecting a plan cannot self-activate a subscription without payment", async () => {
    const supabase = mockSupabase();

    await changePlan(supabase, "t1", "PRO");

    expect(supabase.upsert).toHaveBeenCalledWith({ tenant_id: "t1", plan: "PRO" });
    expect(supabase.upsert).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.anything() }));
  });

  it("does not disturb an existing legitimate ACTIVE subscription's status", async () => {
    const supabase = mockSupabase();

    await changePlan(supabase, "t1", "GROWTH");

    // Only tenant_id/plan are sent — Supabase upsert only updates the
    // columns present in the payload, so an existing row's `status`
    // (whatever it legitimately was) is left exactly as-is, not reset.
    expect(supabase.upsert).toHaveBeenCalledWith({ tenant_id: "t1", plan: "GROWTH" });
  });

  it("Batch B9 P1-1 — rejects Agency (COMING_SOON) without ever reaching the database", async () => {
    const supabase = mockSupabase();

    const result = await changePlan(supabase, "t1", "AGENCY");

    expect(result.error).not.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("still allows every other public tier (Free/Starter/Growth/Pro/Business)", async () => {
    for (const plan of ["FREE", "STARTER", "GROWTH", "PRO", "BUSINESS"] as const) {
      const supabase = mockSupabase();
      const result = await changePlan(supabase, "t1", plan);
      expect(result.error).toBeNull();
    }
  });

  it("still allows UMKMPRO_BUNDLE — a separate cross-sell bundle outside B8/B9's pricing scope, not tracked as COMING_SOON", async () => {
    const supabase = mockSupabase();
    const result = await changePlan(supabase, "t1", "UMKMPRO_BUNDLE");
    expect(result.error).toBeNull();
  });
});

describe("TRIAL_DURATION_DAYS", () => {
  it("is a positive, sane number of days", () => {
    expect(TRIAL_DURATION_DAYS).toBeGreaterThan(0);
    expect(TRIAL_DURATION_DAYS).toBeLessThanOrEqual(30);
  });
});
