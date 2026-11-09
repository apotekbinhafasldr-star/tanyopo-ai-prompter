// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serverEnvMock, createAdminClientMock } = vi.hoisted(() => ({
  serverEnvMock: {
    payment: {
      providerName: "doku" as string | undefined,
      apiKey: "dokusecretkey-123456" as string | undefined,
      clientId: "MCH-0001-1234567890" as string | undefined,
      webhookSecret: undefined as string | undefined,
    },
  },
  createAdminClientMock: vi.fn(() => null as unknown),
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { startCheckout } from "@/services/checkout";
import { encodeDokuInvoiceNumber } from "@/lib/billing/providers/doku-payment-provider";

const TXN = "11111111-1111-4111-8111-111111111111";
const URL_OK = "https://sandbox.doku.com/checkout/link/abc";

type RpcRow = { out_transaction_id: string | null; out_amount: number | null; out_currency: string | null; out_outcome: string };
const outcome = (out_outcome: string, amount = 99_000): { data: RpcRow[]; error: null } => ({
  data: [{ out_transaction_id: TXN, out_amount: amount, out_currency: "IDR", out_outcome }],
  error: null,
});

/** Admin client double: rpc() for fn_begin_checkout; from().update()/select() for the follow-up writes and the EXISTING lookup. */
function mockAdmin(rpcResult: { data: RpcRow[] | null; error: { message: string } | null }, existing: { status: string; metadata: unknown } | null = null) {
  const updates: Array<Record<string, unknown>> = [];
  const eq = vi.fn(() => ({ eq }));
  const update = vi.fn((payload: Record<string, unknown>) => (updates.push(payload), { eq }));
  const selectEq: { eq: ReturnType<typeof vi.fn>; maybeSingle: () => Promise<{ data: unknown; error: null }> } = {
    eq: vi.fn(() => selectEq),
    maybeSingle: async () => ({ data: existing, error: null }),
  };
  const rpc = vi.fn(async () => rpcResult);
  return { rpc, from: vi.fn(() => ({ update, select: vi.fn(() => selectEq) })), updates };
}

const input = {
  tenantId: "t1",
  userId: "u1",
  plan: "STARTER" as const,
  successUrl: "https://app.example.com/billing?checkout=success",
  cancelUrl: "https://app.example.com/billing?checkout=cancelled",
};

const fetchMock = vi.fn();
beforeEach(() => {
  createAdminClientMock.mockReset();
  fetchMock.mockReset();
  vi.stubEnv("PAYMENT_PROVIDER_ENV", "sandbox");
  vi.stubEnv("PAYMENT_LIVE_ENABLED", "");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// startCheckout resolves the provider through the real getPaymentProvider() (only lib/env is mocked), so this
// exercises the real selection + the real DOKU adapter.
describe("startCheckout with the DOKU provider", () => {
  it("creates the transaction through fn_begin_checkout as provider 'doku', sends the catalog amount and a <=30 char invoice, stores the token", async () => {
    const admin = mockAdmin(outcome("CREATED"));
    createAdminClientMock.mockReturnValue(admin);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ response: { payment: { url: URL_OK, token_id: "tok-1" } } }), { status: 200 }));

    const result = await startCheckout(input);

    expect(result).toEqual({ ok: true, checkoutUrl: URL_OK });
    expect(admin.rpc).toHaveBeenCalledWith("fn_begin_checkout", { p_tenant_id: "t1", p_user_id: "u1", p_plan: "STARTER", p_provider: "doku" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api-sandbox.doku.com/checkout/v1/payment");
    const body = JSON.parse(init.body as string);
    expect(body.order.amount).toBe(99_000);
    expect(body.order.invoice_number).toBe(encodeDokuInvoiceNumber(TXN));
    expect(body.order.invoice_number.length).toBeLessThanOrEqual(30);
    expect(body.order.callback_url).toContain(`txn=${TXN}`);
    expect(admin.updates).toContainEqual({ provider_payment_id: "tok-1", metadata: { checkout_url: URL_OK } });
  });

  it("a duplicate request gets the SAME stored payment link: no second DOKU invoice is created", async () => {
    const admin = mockAdmin(outcome("EXISTING"), { status: "PENDING", metadata: { checkout_url: URL_OK } });
    createAdminClientMock.mockReturnValue(admin);
    const result = await startCheckout(input);
    expect(result).toEqual({ ok: true, checkoutUrl: URL_OK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an EXISTING invoice without a stored link is not re-created either (tell the user to wait)", async () => {
    const admin = mockAdmin(outcome("EXISTING"), { status: "PENDING", metadata: null });
    createAdminClientMock.mockReturnValue(admin);
    const result = await startCheckout(input);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("if DOKU refuses, the just-created invoice is closed (PROVIDER_SESSION_FAILED) so no link-less invoice stays open", async () => {
    const admin = mockAdmin(outcome("CREATED"));
    createAdminClientMock.mockReturnValue(admin);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    const result = await startCheckout(input);
    expect(result.ok).toBe(false);
    expect(admin.updates).toContainEqual({ status: "FAILED", failure_reason: "PROVIDER_SESSION_FAILED" });
  });

  it("a catalog/database price drift never reaches DOKU", async () => {
    const admin = mockAdmin(outcome("CREATED", 1));
    createAdminClientMock.mockReturnValue(admin);
    const result = await startCheckout(input);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.updates).toContainEqual({ status: "FAILED", failure_reason: "PRICE_CATALOG_MISMATCH" });
  });

  it("not configured for sandbox (production env / live flag) → no transaction is created and DOKU is never contacted", async () => {
    const admin = mockAdmin(outcome("CREATED"));
    createAdminClientMock.mockReturnValue(admin);
    for (const [env, flag] of [["production", ""], ["sandbox", "true"], ["", ""]] as const) {
      vi.stubEnv("PAYMENT_PROVIDER_ENV", env);
      vi.stubEnv("PAYMENT_LIVE_ENABLED", flag);
      const result = await startCheckout(input);
      expect(result.ok).toBe(false);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
