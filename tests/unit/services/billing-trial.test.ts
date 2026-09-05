import { describe, expect, it } from "vitest";
import { getTrialState, checkAiUsageEntitlement, TRIAL_DURATION_DAYS } from "@/services/billing";
import type { Database } from "@/types/database";

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];

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

describe("TRIAL_DURATION_DAYS", () => {
  it("is a positive, sane number of days", () => {
    expect(TRIAL_DURATION_DAYS).toBeGreaterThan(0);
    expect(TRIAL_DURATION_DAYS).toBeLessThanOrEqual(30);
  });
});
