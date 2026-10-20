import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { getPaymentProviderMock } = vi.hoisted(() => ({ getPaymentProviderMock: vi.fn() }));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: getPaymentProviderMock }));

import { runPaymentReconciliation } from "@/services/payment-reconciliation-job";

const TXN = "33333333-3333-4333-8333-333333333333";
const claimed = (provider = "midtrans") => ({
  data: [{ out_transaction_id: TXN, out_provider: provider, out_provider_payment_id: "inv-1", out_amount: 99000, out_currency: "IDR", out_plan: "STARTER", out_attempts: 1 }],
  error: null,
});

function mockAdmin(claim: unknown, apply: unknown = { data: [{ result_outcome: "APPLIED", result_reason: null }], error: null }) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "fn_claim_reconciliation_batch") return claim;
    if (name === "fn_apply_payment_event") return apply;
    return { data: [], error: null };
  });
  return { rpc } as unknown as SupabaseClient<Database> & { rpc: typeof rpc };
}

function provider(over: Record<string, unknown> = {}) {
  return {
    name: "midtrans",
    isConfigured: vi.fn(() => true),
    getPaymentStatus: vi.fn(async () => "PENDING"),
    ...over,
  };
}

beforeEach(() => getPaymentProviderMock.mockReset());

describe("runPaymentReconciliation — lost-webhook recovery", () => {
  it("does nothing (and calls nothing) when no provider is configured", async () => {
    getPaymentProviderMock.mockReturnValue(provider({ isConfigured: vi.fn(() => false) }));
    const admin = mockAdmin(claimed());
    const s = await runPaymentReconciliation(admin);
    expect(s.claimed).toBe(0);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("a gateway timeout is recorded as ERROR — never as a failure, never expiring anything", async () => {
    getPaymentProviderMock.mockReturnValue(provider({ getPaymentStatus: vi.fn(async () => { throw new Error("ETIMEDOUT"); }) }));
    const admin = mockAdmin(claimed());
    const s = await runPaymentReconciliation(admin);
    expect(s.errors).toBe(1);
    expect(admin.rpc).toHaveBeenCalledWith("fn_record_reconciliation_attempt", expect.objectContaining({ p_result: "ERROR" }));
    expect(admin.rpc).not.toHaveBeenCalledWith("fn_apply_payment_event", expect.anything());
  });

  it("PAID with gateway-verified details is applied through the same function as the webhook (source RECONCILIATION)", async () => {
    getPaymentProviderMock.mockReturnValue(
      provider({ getPaymentDetails: vi.fn(async () => ({ status: "PAID", amount: 99000, currency: "IDR" })) }),
    );
    const admin = mockAdmin(claimed());
    const s = await runPaymentReconciliation(admin);
    expect(s.applied).toBe(1);
    expect(admin.rpc).toHaveBeenCalledWith(
      "fn_apply_payment_event",
      expect.objectContaining({ p_status: "PAID", p_amount: 99000, p_currency: "IDR", p_source: "RECONCILIATION", p_provider_event_id: null }),
    );
  });

  it("PAID from an adapter that cannot report the amount is sent with a null amount, so the database queues it for review instead of crediting it", async () => {
    getPaymentProviderMock.mockReturnValue(provider({ getPaymentStatus: vi.fn(async () => "PAID") }));
    const admin = mockAdmin(claimed(), { data: [{ result_outcome: "EXCEPTION", result_reason: "INVALID_PAYLOAD" }], error: null });
    const s = await runPaymentReconciliation(admin);
    expect(s.needsReview).toBe(1);
    expect(s.applied).toBe(0);
    expect(admin.rpc).toHaveBeenCalledWith("fn_apply_payment_event", expect.objectContaining({ p_amount: null }));
  });

  it("gateway says still PENDING: attempt recorded as NOT_PAID (backoff), nothing applied", async () => {
    getPaymentProviderMock.mockReturnValue(provider());
    const admin = mockAdmin(claimed());
    const s = await runPaymentReconciliation(admin);
    expect(s.notPaid).toBe(1);
    expect(admin.rpc).toHaveBeenCalledWith("fn_record_reconciliation_attempt", expect.objectContaining({ p_result: "NOT_PAID" }));
  });

  it("a transaction that belongs to a different provider than the active adapter is kept PENDING (ERROR), never asked of the wrong gateway", async () => {
    const p = provider();
    getPaymentProviderMock.mockReturnValue(p);
    const admin = mockAdmin(claimed("doku"));
    const s = await runPaymentReconciliation(admin);
    expect(s.errors).toBe(1);
    expect(p.getPaymentStatus).not.toHaveBeenCalled();
  });
});
