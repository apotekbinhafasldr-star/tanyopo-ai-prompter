import { describe, expect, it, vi } from "vitest";
import { getTrialState, changePlan, TRIAL_DURATION_DAYS } from "@/services/billing";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];

/** Mocks changePlan()'s flow: `.select("status")...maybeSingle()` reads the tenant's current status
 * (UX pre-check), then the plan PREFERENCE is written through the authorised RPC
 * fn_set_trial_plan_preference (billing hardening P0 — clients can no longer UPDATE
 * prompter_subscriptions at all). `rpcResult` is what the database function returns. */
function mockSupabaseForChangePlan(
  existingStatus: Database["public"]["Tables"]["prompter_subscriptions"]["Row"]["status"] | null,
  rpcResult: { data: unknown; error: { message: string } | null } = { data: [{ out_ok: true, out_reason: null }], error: null },
) {
  const maybeSingle = vi.fn(async () => ({ data: existingStatus ? { status: existingStatus } : null, error: null }));
  const selectEq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: selectEq }));
  const update = vi.fn();
  const rpc = vi.fn(async () => rpcResult);

  const from = vi.fn(() => ({ select, update }));
  return { from, select, selectEq, maybeSingle, update, rpc } as unknown as SupabaseClient<Database> & {
    from: typeof from;
    update: typeof update;
    rpc: typeof rpc;
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
    cancel_at_period_end: false,
    provider_subscription_id: null,
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
  it("never writes status or UPDATEs the table — the preference goes through fn_set_trial_plan_preference only", async () => {
    const supabase = mockSupabaseForChangePlan("TRIALING");

    await changePlan(supabase, "t1", "PRO");

    expect(supabase.rpc).toHaveBeenCalledWith("fn_set_trial_plan_preference", { p_plan: "PRO" });
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("allows a TRIALING tenant (never paid) to set a plan preference", async () => {
    const supabase = mockSupabaseForChangePlan("TRIALING");

    const result = await changePlan(supabase, "t1", "GROWTH");

    expect(result.error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith("fn_set_trial_plan_preference", { p_plan: "GROWTH" });
  });

  it("Batch B10 A.2 — rejects the change before the RPC once the tenant has a real paid (ACTIVE) subscription", async () => {
    const supabase = mockSupabaseForChangePlan("ACTIVE");

    const result = await changePlan(supabase, "t1", "BUSINESS");

    expect(result.error).not.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("Batch B10 A.2 — also rejects for a PAST_DUE tenant", async () => {
    const supabase = mockSupabaseForChangePlan("PAST_DUE");

    const result = await changePlan(supabase, "t1", "GROWTH");

    expect(result.error).not.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("defence in depth — if the database refuses (NOT_TRIALING, e.g. a stale read), the user gets the same honest message", async () => {
    const supabase = mockSupabaseForChangePlan("TRIALING", { data: [{ out_ok: false, out_reason: "NOT_TRIALING" }], error: null });
    const result = await changePlan(supabase, "t1", "PRO");
    expect(result.error).toMatch(/sudah aktif/i);
  });

  it("any other database refusal or RPC error is a clean failure, never a silent success", async () => {
    for (const rpcResult of [
      { data: [{ out_ok: false, out_reason: "NOT_OWNER" }], error: null },
      { data: null, error: { message: "boom" } },
      { data: [], error: null },
    ]) {
      const supabase = mockSupabaseForChangePlan("TRIALING", rpcResult);
      const result = await changePlan(supabase, "t1", "PRO");
      expect(result.error).toBe("Gagal mengubah paket.");
    }
  });

  it("Batch B9 P1-1 — rejects Agency (COMING_SOON) without ever reaching the database", async () => {
    const supabase = mockSupabaseForChangePlan("TRIALING");

    const result = await changePlan(supabase, "t1", "AGENCY");

    expect(result.error).not.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("still allows every other public tier (Free/Starter/Growth/Pro/Business) for a TRIALING tenant", async () => {
    for (const plan of ["FREE", "STARTER", "GROWTH", "PRO", "BUSINESS"] as const) {
      const supabase = mockSupabaseForChangePlan("TRIALING");
      const result = await changePlan(supabase, "t1", plan);
      expect(result.error).toBeNull();
    }
  });

  it("still allows UMKMPRO_BUNDLE — a separate cross-sell bundle outside B8/B9's pricing scope, not tracked as COMING_SOON", async () => {
    const supabase = mockSupabaseForChangePlan("TRIALING");
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
