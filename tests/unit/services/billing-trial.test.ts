import { describe, expect, it, vi } from "vitest";
import { getTrialState, changePlan, TRIAL_DURATION_DAYS } from "@/services/billing";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];

type RpcRow = { out_ok: boolean; out_reason: string | null };

/** Mocks changePlan(): since the P0 plan-tampering fix it makes exactly ONE call, the
 * fn_set_trial_plan_preference RPC, and never touches the table (clients hold no UPDATE
 * privilege on prompter_subscriptions, so a table write could never succeed anyway). */
function mockSupabaseForChangePlan(rpcResult: { data: RpcRow[] | null; error: { message: string } | null }) {
  const rpc = vi.fn(async () => rpcResult);
  const from = vi.fn();
  return { rpc, from } as unknown as SupabaseClient<Database> & { rpc: typeof rpc; from: typeof from };
}

const ok: { data: RpcRow[]; error: null } = { data: [{ out_ok: true, out_reason: null }], error: null };
const refused = (reason: string) => ({ data: [{ out_ok: false, out_reason: reason }], error: null });

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
  it("records the preference ONLY through the fn_set_trial_plan_preference RPC; never writes the table or status", async () => {
    const supabase = mockSupabaseForChangePlan(ok);

    const result = await changePlan(supabase, "PRO");

    expect(result.error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("fn_set_trial_plan_preference", { p_plan: "PRO" });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("passes no tenant id: the tenant is derived from the signed-in user inside the database", async () => {
    const supabase = mockSupabaseForChangePlan(ok);
    await changePlan(supabase, "GROWTH");
    const args = (supabase.rpc as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1];
    expect(Object.keys(args as object)).toEqual(["p_plan"]);
  });

  it("P0 — a paying tenant (ACTIVE / PAST_DUE / CANCELED) is refused by the database and gets the upgrade/downgrade message", async () => {
    const supabase = mockSupabaseForChangePlan(refused("NOT_TRIALING"));

    const result = await changePlan(supabase, "BUSINESS");

    expect(result.error).toMatch(/sudah aktif berdasarkan pembayaran/);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("maps a non-Owner refusal and an unavailable-plan refusal to clear messages", async () => {
    expect((await changePlan(mockSupabaseForChangePlan(refused("NOT_OWNER")), "PRO")).error).toBe("Hanya Owner yang dapat mengubah paket.");
    expect((await changePlan(mockSupabaseForChangePlan(refused("PLAN_NOT_AVAILABLE")), "PRO")).error).toMatch(/belum dapat dipilih/);
  });

  it("fails closed on any other refusal, an RPC error, or an empty result (never reports success)", async () => {
    for (const reason of ["NO_TENANT", "NO_SUBSCRIPTION", "PLAN_UNKNOWN", "NOT_AUTHENTICATED", "SOMETHING_NEW"]) {
      expect((await changePlan(mockSupabaseForChangePlan(refused(reason)), "PRO")).error).toBe("Gagal mengubah paket.");
    }
    expect((await changePlan(mockSupabaseForChangePlan({ data: null, error: { message: "boom" } }), "PRO")).error).toBe("Gagal mengubah paket.");
    expect((await changePlan(mockSupabaseForChangePlan({ data: [], error: null }), "PRO")).error).toBe("Gagal mengubah paket.");
    expect((await changePlan(mockSupabaseForChangePlan({ data: null, error: null }), "PRO")).error).toBe("Gagal mengubah paket.");
  });

  it("Batch B9 P1-1 — rejects Agency (COMING_SOON) without ever reaching the database", async () => {
    const supabase = mockSupabaseForChangePlan(ok);

    const result = await changePlan(supabase, "AGENCY");

    expect(result.error).not.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("still allows every other public tier (Free/Starter/Growth/Pro/Business) to reach the RPC", async () => {
    for (const plan of ["FREE", "STARTER", "GROWTH", "PRO", "BUSINESS"] as const) {
      const supabase = mockSupabaseForChangePlan(ok);
      const result = await changePlan(supabase, plan);
      expect(result.error).toBeNull();
      expect(supabase.rpc).toHaveBeenCalledWith("fn_set_trial_plan_preference", { p_plan: plan });
    }
  });

  it("still allows UMKMPRO_BUNDLE — a separate cross-sell bundle outside B8/B9's pricing scope, not tracked as COMING_SOON", async () => {
    const supabase = mockSupabaseForChangePlan(ok);
    const result = await changePlan(supabase, "UMKMPRO_BUNDLE");
    expect(result.error).toBeNull();
  });
});

describe("TRIAL_DURATION_DAYS", () => {
  it("is a positive, sane number of days", () => {
    expect(TRIAL_DURATION_DAYS).toBeGreaterThan(0);
    expect(TRIAL_DURATION_DAYS).toBeLessThanOrEqual(30);
  });
});
