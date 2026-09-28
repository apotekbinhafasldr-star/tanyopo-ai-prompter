import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { getPaymentProviderMock } = vi.hoisted(() => ({ getPaymentProviderMock: vi.fn() }));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: getPaymentProviderMock }));

import { reconcileCheckoutReturn } from "@/services/payment-reconciliation";

function mockSupabase(row: Record<string, unknown> | null) {
  const eqCalls: Array<[string, unknown]> = [];
  const maybeSingle = vi.fn(async () => ({ data: row }));
  const eq = vi.fn((...args: [string, unknown]) => {
    eqCalls.push(args);
    return { eq, maybeSingle };
  });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, maybeSingle, eqCalls } as unknown as SupabaseClient<Database> & {
    from: typeof from;
    eqCalls: typeof eqCalls;
  };
}

function mockProvider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "xendit",
    isConfigured: vi.fn(() => true),
    createCheckoutSession: vi.fn(),
    getPaymentStatus: vi.fn(async () => "PENDING"),
    cancelSubscription: vi.fn(),
    verifyWebhookSignature: vi.fn(() => true),
    parseWebhookEvent: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  getPaymentProviderMock.mockReset();
  getPaymentProviderMock.mockReturnValue(mockProvider());
});

describe("reconcileCheckoutReturn — Payment Remediation Phase 6", () => {
  it("Poin N — scopes the lookup to both the transaction id AND the caller's own tenant id, never trusting the browser alone", async () => {
    const supabase = mockSupabase({ status: "PAID", plan: "PRO", provider_payment_id: "pay_1" });

    await reconcileCheckoutReturn(supabase, "tenant-a", "txn_1");

    expect(supabase.eqCalls).toContainEqual(["id", "txn_1"]);
    expect(supabase.eqCalls).toContainEqual(["tenant_id", "tenant-a"]);
  });

  it("reports NOT_FOUND when no row matches (wrong tenant, or a nonexistent/tampered id) rather than guessing a status", async () => {
    const supabase = mockSupabase(null);

    const result = await reconcileCheckoutReturn(supabase, "tenant-a", "txn_missing");

    expect(result.status).toBe("NOT_FOUND");
  });

  it("reports the real PAID status straight from the database once the webhook has already activated it", async () => {
    const supabase = mockSupabase({ status: "PAID", plan: "GROWTH", provider_payment_id: "pay_1" });

    const result = await reconcileCheckoutReturn(supabase, "tenant-a", "txn_1");

    expect(result).toEqual({ status: "PAID", plan: "GROWTH" });
    // Never polls the provider once our own DB already has a final status.
    const provider = getPaymentProviderMock();
    expect(provider.getPaymentStatus).not.toHaveBeenCalled();
  });

  it("Poin M — never reports PAID from a provider poll alone; a still-PENDING row stays PENDING even if the provider already confirms payment", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider({ getPaymentStatus: vi.fn(async () => "PAID") }));
    const supabase = mockSupabase({ status: "PENDING", plan: "PRO", provider_payment_id: "pay_1" });

    const result = await reconcileCheckoutReturn(supabase, "tenant-a", "txn_1");

    // Only the webhook (fn_apply_verified_payment) may ever set PAID in
    // the database — this function only reports what it observes.
    expect(result.status).toBe("PENDING");
  });

  it("does not fail when the provider poll throws — falls back to the local PENDING status", async () => {
    getPaymentProviderMock.mockReturnValue(
      mockProvider({
        getPaymentStatus: vi.fn(async () => {
          throw new Error("network error");
        }),
      }),
    );
    const supabase = mockSupabase({ status: "PENDING", plan: "PRO", provider_payment_id: "pay_1" });

    const result = await reconcileCheckoutReturn(supabase, "tenant-a", "txn_1");

    expect(result.status).toBe("PENDING");
  });

  it("reports FAILED/EXPIRED/CANCELLED straight from the database", async () => {
    const supabase = mockSupabase({ status: "EXPIRED", plan: "PRO", provider_payment_id: null });

    const result = await reconcileCheckoutReturn(supabase, "tenant-a", "txn_1");

    expect(result.status).toBe("EXPIRED");
  });
});
