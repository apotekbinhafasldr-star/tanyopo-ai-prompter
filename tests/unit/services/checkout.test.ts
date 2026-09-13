import { describe, expect, it, vi, beforeEach } from "vitest";
import { PLAN_TIERS, findPlanTier } from "@/lib/billing/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { getPaymentProviderMock } = vi.hoisted(() => ({ getPaymentProviderMock: vi.fn() }));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: getPaymentProviderMock }));

import { startCheckout } from "@/services/checkout";

function mockSupabase(insertResult: { data: { id: string } | null; error: { message: string } | null }) {
  const single = vi.fn(async () => insertResult);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { from, insert, select, single } as unknown as SupabaseClient<Database> & {
    from: typeof from;
    insert: typeof insert;
  };
}

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

beforeEach(() => {
  getPaymentProviderMock.mockReset();
});

describe("startCheckout — Batch B10 checkout core", () => {
  it("Bagian G.2/G.3 — never accepts an amount from the caller; always uses the server-side canonical price from PLAN_TIERS", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const supabase = mockSupabase({ data: { id: "txn_1" }, error: null });

    const starterTier = PLAN_TIERS.find((t) => t.id === "STARTER")!;
    await startCheckout(supabase, {
      tenantId: "t1",
      userId: "u1",
      plan: "STARTER",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: starterTier.priceIDR, currency: "IDR", plan: "STARTER" }),
    );
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ amountIDR: starterTier.priceIDR }),
    );
  });

  it("Bagian G.5 — rejects Agency (COMING_SOON) before creating any transaction or calling the provider", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const supabase = mockSupabase({ data: { id: "txn_1" }, error: null });

    const result = await startCheckout(supabase, {
      tenantId: "t1",
      userId: "u1",
      plan: "AGENCY",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    expect(result.ok).toBe(false);
    expect(supabase.insert).not.toHaveBeenCalled();
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects an invalid/unknown plan string before touching the database", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const supabase = mockSupabase({ data: { id: "txn_1" }, error: null });

    const result = await startCheckout(supabase, {
      // @ts-expect-error deliberately invalid for the test
      plan: "NOT_A_REAL_PLAN",
      tenantId: "t1",
      userId: "u1",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    expect(result.ok).toBe(false);
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it("rejects FREE (no payment needed) without creating a transaction", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const supabase = mockSupabase({ data: { id: "txn_1" }, error: null });

    const result = await startCheckout(supabase, {
      tenantId: "t1",
      userId: "u1",
      plan: "FREE",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    expect(result.ok).toBe(false);
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it("Bagian G.8 / H — fails closed when the provider isn't configured, and never creates a transaction row", async () => {
    const provider = mockProvider({ isConfigured: false });
    getPaymentProviderMock.mockReturnValue(provider);
    const supabase = mockSupabase({ data: { id: "txn_1" }, error: null });

    const result = await startCheckout(supabase, {
      tenantId: "t1",
      userId: "u1",
      plan: "GROWTH",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/dipersiapkan/i);
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it("with the real NullPaymentProvider (no mocking), checkout always fails closed end-to-end", async () => {
    vi.doUnmock("@/lib/billing/get-payment-provider");
    const { getPaymentProvider } = await import("@/lib/billing/get-payment-provider");
    getPaymentProviderMock.mockImplementation(getPaymentProvider);

    const supabase = mockSupabase({ data: { id: "txn_1" }, error: null });
    const result = await startCheckout(supabase, {
      tenantId: "t1",
      userId: "u1",
      plan: "STARTER",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    expect(result.ok).toBe(false);
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it("returns a checkout URL and does not itself grant any entitlement", async () => {
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);
    const supabase = mockSupabase({ data: { id: "txn_1" }, error: null });

    const result = await startCheckout(supabase, {
      tenantId: "t1",
      userId: "u1",
      plan: "PRO",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    expect(result.ok).toBe(true);
    expect(result.checkoutUrl).toBe("https://pay.example.com/session/abc");
    // startCheckout never touches prompter_subscriptions at all.
    expect(supabase.from).toHaveBeenCalledWith("prompter_payment_transactions");
    expect(supabase.from).not.toHaveBeenCalledWith("prompter_subscriptions");
  });

  it("findPlanTier sanity check used by startCheckout — every ACTIVE tier has a positive price except FREE", () => {
    for (const tier of PLAN_TIERS) {
      if (tier.id === "FREE") {
        expect(tier.priceIDR).toBe(0);
      } else if (tier.availability === "ACTIVE") {
        expect(tier.priceIDR).toBeGreaterThan(0);
      }
    }
    expect(findPlanTier("STARTER")?.availability).toBe("ACTIVE");
  });
});
