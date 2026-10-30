import { describe, expect, it, vi, beforeEach } from "vitest";
import { PLAN_TIERS, findPlanTier } from "@/lib/billing/plans";

const { getPaymentProviderMock, createAdminClientMock } = vi.hoisted(() => ({
  getPaymentProviderMock: vi.fn(),
  createAdminClientMock: vi.fn(() => null as unknown),
}));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: getPaymentProviderMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { startCheckout } from "@/services/checkout";

type RpcRow = { out_transaction_id: string | null; out_amount: number | null; out_currency: string | null; out_outcome: string };

/** Admin client double: rpc() for fn_begin_checkout, from().update().eq().eq() for the follow-up writes. */
function mockAdmin(rpcResult: { data: RpcRow[] | null; error: { message: string } | null }) {
  const eq = vi.fn(() => ({ eq }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const rpc = vi.fn(async () => rpcResult);
  return { rpc, from, update, eq };
}

const created = (amount: number, id = "txn_1", currency = "IDR"): { data: RpcRow[]; error: null } => ({
  data: [{ out_transaction_id: id, out_amount: amount, out_currency: currency, out_outcome: "CREATED" }],
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

const input = (plan: string, extra: Record<string, unknown> = {}) =>
  ({
    tenantId: "t1",
    userId: "u1",
    plan,
    successUrl: "https://app.example.com/billing?checkout=success",
    cancelUrl: "https://app.example.com/billing?checkout=cancelled",
    ...extra,
  }) as Parameters<typeof startCheckout>[0];

beforeEach(() => {
  getPaymentProviderMock.mockReset();
  createAdminClientMock.mockReset();
  createAdminClientMock.mockReturnValue(null);
});

describe("startCheckout — Billing B1 (server-only, catalog-priced)", () => {
  it("creates the transaction ONLY through fn_begin_checkout with the service-role client, and sends no amount or currency", async () => {
    const admin = mockAdmin(created(99_000));
    createAdminClientMock.mockReturnValue(admin);
    getPaymentProviderMock.mockReturnValue(mockProvider());

    const result = await startCheckout(input("STARTER"));

    expect(result.ok).toBe(true);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("fn_begin_checkout", {
      p_tenant_id: "t1",
      p_user_id: "u1",
      p_plan: "STARTER",
      p_provider: "midtrans",
    });
    const args = (admin.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(Object.keys(args).join(",")).not.toMatch(/amount|price|currency/i);
    // the table is never inserted into from the application any more
    expect(admin.from).not.toHaveBeenCalledWith("prompter_subscriptions");
  });

  it("charges the amount the DATABASE returned (equal to the code catalog) and passes it to the provider", async () => {
    const admin = mockAdmin(created(399_000, "txn_pro"));
    createAdminClientMock.mockReturnValue(admin);
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);

    await startCheckout(input("PRO"));

    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ amountIDR: 399_000, internalTransactionId: "txn_pro", plan: "PRO" }),
    );
  });

  it("fails closed on catalog drift: DB price != code price marks the transaction FAILED and never calls the provider", async () => {
    const admin = mockAdmin(created(1, "txn_bad"));
    createAdminClientMock.mockReturnValue(admin);
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);

    const result = await startCheckout(input("BUSINESS"));

    expect(result.ok).toBe(false);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
    expect(admin.update).toHaveBeenCalledWith({ status: "FAILED", failure_reason: "PRICE_CATALOG_MISMATCH" });
    expect(admin.eq).toHaveBeenCalledWith("id", "txn_bad");
  });

  it("fails closed when the DB reports a non-IDR currency", async () => {
    const admin = mockAdmin(created(99_000, "txn_usd", "USD"));
    createAdminClientMock.mockReturnValue(admin);
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);

    expect((await startCheckout(input("STARTER"))).ok).toBe(false);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects Agency (COMING_SOON), FREE and unknown plans BEFORE any database call", async () => {
    const admin = mockAdmin(created(1));
    createAdminClientMock.mockReturnValue(admin);
    getPaymentProviderMock.mockReturnValue(mockProvider());

    for (const plan of ["AGENCY", "FREE", "NOT_A_REAL_PLAN", "UMKMPRO_BUNDLE"]) {
      expect((await startCheckout(input(plan))).ok).toBe(false);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the provider isn't configured: no RPC, no transaction row", async () => {
    const admin = mockAdmin(created(199_000));
    createAdminClientMock.mockReturnValue(admin);
    getPaymentProviderMock.mockReturnValue(mockProvider({ isConfigured: false }));

    const result = await startCheckout(input("GROWTH"));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/dipersiapkan/i);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the service-role client isn't configured (no silent fallback to the tenant client)", async () => {
    createAdminClientMock.mockReturnValue(null);
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);

    const result = await startCheckout(input("PRO"));

    expect(result.ok).toBe(false);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_OWNER", /Owner/],
    ["NOT_MEMBER", /Owner/],
    ["PLAN_NOT_PURCHASABLE", /belum dapat dibeli/],
    ["PLAN_NOT_AVAILABLE", /belum dapat dibeli/],
    ["NO_SUBSCRIPTION", /Langganan/],
    ["TOO_MANY_PENDING", /Terlalu banyak/],
    ["INVALID", /Gagal memulai/],
  ])("maps database outcome %s to a safe message and never calls the provider", async (outcome, message) => {
    const admin = mockAdmin({
      data: [{ out_transaction_id: null, out_amount: null, out_currency: null, out_outcome: outcome }],
      error: null,
    });
    createAdminClientMock.mockReturnValue(admin);
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);

    const result = await startCheckout(input("STARTER"));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(message);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("an RPC error (e.g. migration not applied yet) fails closed", async () => {
    const admin = mockAdmin({ data: null, error: { message: "function fn_begin_checkout does not exist" } });
    createAdminClientMock.mockReturnValue(admin);
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);

    const result = await startCheckout(input("STARTER"));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Gagal memulai/);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("with the real NullPaymentProvider (no mocking), checkout always fails closed end-to-end", async () => {
    vi.doUnmock("@/lib/billing/get-payment-provider");
    const { getPaymentProvider } = await import("@/lib/billing/get-payment-provider");
    getPaymentProviderMock.mockImplementation(getPaymentProvider);
    const admin = mockAdmin(created(99_000));
    createAdminClientMock.mockReturnValue(admin);

    const result = await startCheckout(input("STARTER"));

    expect(result.ok).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("returns a checkout URL and carries the transaction id into the success/cancel URLs", async () => {
    const admin = mockAdmin(created(399_000, "txn_42"));
    createAdminClientMock.mockReturnValue(admin);
    const provider = mockProvider();
    getPaymentProviderMock.mockReturnValue(provider);

    const result = await startCheckout(input("PRO"));

    expect(result.checkoutUrl).toBe("https://pay.example.com/session/abc");
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: "https://app.example.com/billing?checkout=success&txn=txn_42",
        cancelUrl: "https://app.example.com/billing?checkout=cancelled&txn=txn_42",
      }),
    );
  });

  it("records the provider's session id on the transaction via the admin client, scoped to that PENDING row only", async () => {
    const admin = mockAdmin(created(399_000, "txn_99"));
    createAdminClientMock.mockReturnValue(admin);
    getPaymentProviderMock.mockReturnValue(
      mockProvider({ createCheckoutSession: vi.fn(async () => ({ checkoutUrl: "https://pay.example.com/x", externalSessionId: "xyz" })) }),
    );

    await startCheckout(input("PRO"));

    expect(admin.from).toHaveBeenCalledWith("prompter_payment_transactions");
    expect(admin.update).toHaveBeenCalledWith({ provider_payment_id: "xyz" });
    expect(admin.eq).toHaveBeenCalledWith("id", "txn_99");
    expect(admin.eq).toHaveBeenCalledWith("status", "PENDING");
  });

  it("a provider failure after the transaction exists returns an error (the PENDING row stays recoverable, nothing is activated)", async () => {
    const admin = mockAdmin(created(99_000));
    createAdminClientMock.mockReturnValue(admin);
    getPaymentProviderMock.mockReturnValue(mockProvider({ createCheckoutSession: vi.fn(async () => { throw new Error("gateway down"); }) }));

    const result = await startCheckout(input("STARTER"));

    expect(result.ok).toBe(false);
    expect(admin.from).not.toHaveBeenCalledWith("prompter_subscriptions");
  });

  it("every ACTIVE paid tier has a positive price and FREE is 0 (catalog sanity)", () => {
    for (const tier of PLAN_TIERS) {
      if (tier.id === "FREE") expect(tier.priceIDR).toBe(0);
      else if (tier.availability === "ACTIVE") expect(tier.priceIDR).toBeGreaterThan(0);
    }
    expect(findPlanTier("STARTER")?.availability).toBe("ACTIVE");
  });
});
