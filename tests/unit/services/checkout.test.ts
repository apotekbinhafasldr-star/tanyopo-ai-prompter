import { describe, expect, it, vi, beforeEach } from "vitest";
import { PLAN_TIERS, findPlanTier } from "@/lib/billing/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { getPaymentProviderMock } = vi.hoisted(() => ({ getPaymentProviderMock: vi.fn() }));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: getPaymentProviderMock }));

import { startCheckout } from "@/services/checkout";

type RpcReply = { data: unknown; error: { message: string } | null };

/** Admin mock: every .rpc(name, args) is answered from `replies[name]`. */
function mockAdmin(replies: Record<string, RpcReply>) {
  const rpc = vi.fn(async (name: string) => replies[name] ?? { data: [], error: null });
  return { rpc } as unknown as SupabaseClient<Database> & { rpc: typeof rpc };
}

const begun = (outcome: string, extra: Record<string, unknown> = {}): RpcReply => ({
  data: [{ out_transaction_id: "11111111-1111-4111-8111-111111111111", out_checkout_url: null, out_outcome: outcome, ...extra }],
  error: null,
});

function mockProvider(overrides: Partial<{ isConfigured: boolean; createCheckoutSession: ReturnType<typeof vi.fn> }> = {}) {
  return {
    name: "midtrans",
    isConfigured: vi.fn(() => overrides.isConfigured ?? true),
    createCheckoutSession:
      overrides.createCheckoutSession ??
      vi.fn(async () => ({ checkoutUrl: "https://pay.example.com/session/abc", externalSessionId: "abc" })),
    getPaymentStatus: vi.fn(),
    cancelSubscription: vi.fn(),
    verifyWebhookSignature: vi.fn(() => false),
    parseWebhookEvent: vi.fn(),
  };
}

const base = {
  tenantId: "t1",
  userId: "u1",
  successUrl: "https://app.example.com/success",
  cancelUrl: "https://app.example.com/cancel",
};

beforeEach(() => {
  getPaymentProviderMock.mockReset();
});

describe("startCheckout — Billing Financial Safety (F3 idempotent checkout)", () => {
  it("never accepts an amount from the caller; the canonical server-side price is sent to fn_begin_checkout and the provider", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const admin = mockAdmin({ fn_begin_checkout: begun("CREATED") });
    const starter = PLAN_TIERS.find((t) => t.id === "STARTER")!;

    await startCheckout(admin, { ...base, plan: "STARTER", intentKey: "intent-abcdef12" });

    expect(admin.rpc).toHaveBeenCalledWith(
      "fn_begin_checkout",
      expect.objectContaining({ p_amount: starter.priceIDR, p_currency: "IDR", p_plan: "STARTER", p_intent_key: "intent-abcdef12" }),
    );
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ amountIDR: starter.priceIDR }));
  });

  it("rejects Agency (COMING_SOON), FREE and unknown plans before any database or provider call", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const admin = mockAdmin({});
    for (const plan of ["AGENCY", "FREE", "NOT_A_REAL_PLAN"]) {
      // @ts-expect-error deliberately includes an invalid plan
      const r = await startCheckout(admin, { ...base, plan });
      expect(r.ok).toBe(false);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails closed when the provider is not configured, or when no admin client exists — and creates nothing", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider({ isConfigured: false }));
    const admin = mockAdmin({});
    const r1 = await startCheckout(admin, { ...base, plan: "GROWTH" });
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/dipersiapkan/i);
    expect(admin.rpc).not.toHaveBeenCalled();

    getPaymentProviderMock.mockReturnValue(mockProvider());
    const r2 = await startCheckout(null, { ...base, plan: "GROWTH" });
    expect(r2.ok).toBe(false);
  });

  it("CREATED: creates ONE gateway invoice, links it to the transaction and returns the URL; carries the transaction id into the redirect URLs", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const admin = mockAdmin({ fn_begin_checkout: begun("CREATED"), fn_record_checkout_session: { data: "OK", error: null } });

    const r = await startCheckout(admin, { ...base, plan: "STARTER", intentKey: "intent-abcdef12" });

    expect(r).toEqual({ ok: true, checkoutUrl: "https://pay.example.com/session/abc" });
    expect(provider.createCheckoutSession).toHaveBeenCalledTimes(1);
    const arg = provider.createCheckoutSession.mock.calls[0][0];
    expect(arg.internalTransactionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(arg.successUrl).toContain("txn=11111111-1111-4111-8111-111111111111");
    expect(admin.rpc).toHaveBeenCalledWith(
      "fn_record_checkout_session",
      expect.objectContaining({ p_provider_payment_id: "abc", p_checkout_url: "https://pay.example.com/session/abc" }),
    );
  });

  it("REUSED: returns the still-valid invoice and does NOT call the gateway again", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const admin = mockAdmin({ fn_begin_checkout: begun("REUSED", { out_checkout_url: "https://pay.example.com/existing" }) });

    const r = await startCheckout(admin, { ...base, plan: "STARTER", intentKey: "intent-abcdef12" });

    expect(r).toEqual({ ok: true, checkoutUrl: "https://pay.example.com/existing" });
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("IN_PROGRESS / INTENT_STALE / INTENT_CLOSED / INVALID: no gateway call, honest error", async () => {
    for (const outcome of ["IN_PROGRESS", "INTENT_STALE", "INTENT_CLOSED", "INVALID", "NO_TENANT"]) {
      const provider = mockProvider();
      getPaymentProviderMock.mockReturnValue(provider);
      const r = await startCheckout(mockAdmin({ fn_begin_checkout: begun(outcome) }), { ...base, plan: "STARTER" });
      expect(r.ok).toBe(false);
      expect(provider.createCheckoutSession).not.toHaveBeenCalled();
    }
  });

  it("a malformed intent key is dropped (null), never forwarded", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({ fn_begin_checkout: begun("CREATED"), fn_record_checkout_session: { data: "OK", error: null } });
    await startCheckout(admin, { ...base, plan: "STARTER", intentKey: "bad key!" });
    expect(admin.rpc).toHaveBeenCalledWith("fn_begin_checkout", expect.objectContaining({ p_intent_key: null }));
  });

  it("gateway creation throws: the row is released through fn_mark_checkout_failed (which refuses once an invoice is linked) and the caller gets an error", async () => {
    const provider = mockProvider({ createCheckoutSession: vi.fn(async () => { throw new Error("timeout"); }) });
    getPaymentProviderMock.mockReturnValue(provider);
    const admin = mockAdmin({ fn_begin_checkout: begun("CREATED") });

    const r = await startCheckout(admin, { ...base, plan: "STARTER" });

    expect(r.ok).toBe(false);
    expect(admin.rpc).toHaveBeenCalledWith("fn_mark_checkout_failed", expect.objectContaining({ p_reason: "GATEWAY_CREATE_FAILED" }));
  });

  it("linking the invoice fails after the gateway created it: honest error, the row is NOT marked failed (reconciliation/webhook can still credit it)", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      fn_begin_checkout: begun("CREATED"),
      fn_record_checkout_session: { data: null, error: { message: "db down" } },
    });

    const r = await startCheckout(admin, { ...base, plan: "STARTER" });

    expect(r.ok).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalledWith("fn_mark_checkout_failed", expect.anything());
  });

  it("a database error from fn_begin_checkout is a clean failure and never reaches the gateway", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const r = await startCheckout(mockAdmin({ fn_begin_checkout: { data: null, error: { message: "x" } } }), { ...base, plan: "STARTER" });
    expect(r.ok).toBe(false);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("with the real NullPaymentProvider (no mocking), checkout always fails closed end-to-end", async () => {
    const { NullPaymentProvider } = await import("@/lib/billing/providers/null-payment-provider");
    getPaymentProviderMock.mockReturnValue(new NullPaymentProvider());
    const admin = mockAdmin({});
    const r = await startCheckout(admin, { ...base, plan: "STARTER" });
    expect(r.ok).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("findPlanTier sanity check used by startCheckout — every ACTIVE tier has a positive price except FREE", () => {
    for (const t of PLAN_TIERS) {
      if (t.availability === "ACTIVE" && t.id !== "FREE") expect(findPlanTier(t.id)!.priceIDR).toBeGreaterThan(0);
    }
  });
});
