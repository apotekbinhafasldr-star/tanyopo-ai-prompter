/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles intentionally mimic a loosely typed query builder */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getPaymentProviderMock, createAdminClientMock } = vi.hoisted(() => ({
  getPaymentProviderMock: vi.fn(),
  createAdminClientMock: vi.fn(() => null as unknown),
}));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: getPaymentProviderMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { startCheckout } from "@/services/checkout";
import { createFakeDb, SANDBOX_REF, TENANT_A, TXN_A, type FakeDb } from "../support/payment-fakes";

let db: FakeDb;

/** Admin double on top of the in-memory database: fn_begin_checkout creates a PENDING row with the catalog price (99 000 for STARTER). */
function makeAdmin(tweak?: (table: string, builder: any) => any) {
  return {
    from: (table: string) => {
      const builder = db.from(table);
      return tweak ? tweak(table, builder) : builder;
    },
    rpc: async (name: string) => {
      db.rpcCalls.push({ name, args: {} });
      db.txns.push({ id: TXN_A, tenant_id: TENANT_A, provider: "midtrans", status: "PENDING", amount: 99_000, currency: "IDR", plan: "STARTER", provider_payment_id: null, metadata: {} });
      return { data: [{ out_transaction_id: TXN_A, out_amount: 99_000, out_currency: "IDR", out_outcome: "CREATED" }], error: null };
    },
  };
}

const request = { tenantId: TENANT_A, userId: "u1", plan: "STARTER" as const, successUrl: "https://app.example.com/billing?checkout=success", cancelUrl: "https://app.example.com/billing?checkout=cancelled" };

function provider(over: Record<string, unknown> = {}) {
  return {
    name: "midtrans",
    isConfigured: () => true,
    runtimeEnvironment: () => ({ env: "sandbox" as const, dbRef: SANDBOX_REF }),
    createCheckoutSession: vi.fn(async () => ({ checkoutUrl: "https://pay.example.com/session/abc", externalSessionId: "abc" })),
    getPaymentStatus: vi.fn(),
    cancelSubscription: vi.fn(),
    verifyWebhookSignature: () => false,
    parseWebhookEvent: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  db = createFakeDb();
  getPaymentProviderMock.mockReset();
  createAdminClientMock.mockReset();
});

describe("D3 — checkout stamps the transaction before any gateway session exists", () => {
  it("D1: the stamp is already stored when the gateway session is created, and the stored payment link is merged in (never overwrites the stamp: D3)", async () => {
    let metadataAtSessionTime: unknown = "not called";
    const p = provider({
      createCheckoutSession: vi.fn(async () => {
        metadataAtSessionTime = JSON.parse(JSON.stringify(db.txns[0].metadata));
        return { checkoutUrl: "https://pay.example.com/session/abc", externalSessionId: "abc" };
      }),
    });
    getPaymentProviderMock.mockReturnValue(p);
    createAdminClientMock.mockReturnValue(makeAdmin());

    const result = await startCheckout(request);

    expect(result).toEqual({ ok: true, checkoutUrl: "https://pay.example.com/session/abc" });
    expect(metadataAtSessionTime).toEqual({ pg_env: "sandbox", pg_db_ref: SANDBOX_REF });
    expect(db.txns[0].metadata).toEqual({ pg_env: "sandbox", pg_db_ref: SANDBOX_REF, checkout_url: "https://pay.example.com/session/abc" });
    expect(db.txns[0]).toMatchObject({ status: "PENDING", provider_payment_id: "abc" });
  });

  it("D1b: existing metadata is kept when the stamp is merged in", async () => {
    getPaymentProviderMock.mockReturnValue(provider());
    createAdminClientMock.mockReturnValue(
      (() => {
        const admin = makeAdmin();
        const origRpc = admin.rpc;
        admin.rpc = async (name: string) => {
          const r = await origRpc(name);
          db.txns[0].metadata = { note: "keep-me" };
          return r;
        };
        return admin;
      })(),
    );
    await startCheckout(request);
    expect(db.txns[0].metadata).toMatchObject({ note: "keep-me", pg_env: "sandbox", pg_db_ref: SANDBOX_REF });
  });

  it("D2: when the runtime cannot be proven, the transaction is closed as ENV_STAMP_FAILED and NO gateway session is created", async () => {
    const p = provider({ runtimeEnvironment: () => null });
    getPaymentProviderMock.mockReturnValue(p);
    createAdminClientMock.mockReturnValue(makeAdmin());

    const result = await startCheckout(request);

    expect(result.ok).toBe(false);
    expect(p.createCheckoutSession).not.toHaveBeenCalled();
    expect(db.txns[0]).toMatchObject({ status: "FAILED", failure_reason: "ENV_STAMP_FAILED" });
  });

  it("D2b: a stamp write that errors, or is silently lost (read-back differs), also closes the transaction without a session", async () => {
    const failing = (mode: "error" | "lost") => (table: string, builder: any) => {
      if (table !== "prompter_payment_transactions") return builder;
      const origUpdate = builder.update;
      builder.update = (payload: any) => {
        if (!payload || !payload.metadata) return origUpdate(payload);
        const dead: any = { eq: () => dead, then: (res: any) => Promise.resolve({ data: null, error: mode === "error" ? { message: "boom" } : null }).then(res) };
        return dead;
      };
      return builder;
    };
    for (const mode of ["error", "lost"] as const) {
      db = createFakeDb();
      const p = provider();
      getPaymentProviderMock.mockReturnValue(p);
      createAdminClientMock.mockReturnValue(makeAdmin(failing(mode)));
      const result = await startCheckout(request);
      expect(result.ok, mode).toBe(false);
      expect(p.createCheckoutSession, mode).not.toHaveBeenCalled();
      expect(db.txns[0], mode).toMatchObject({ status: "FAILED", failure_reason: "ENV_STAMP_FAILED" });
    }
  });

  it("an adapter that does not report an environment keeps the previous behaviour (link only, no stamp)", async () => {
    const p = provider();
    delete (p as any).runtimeEnvironment;
    getPaymentProviderMock.mockReturnValue(p);
    createAdminClientMock.mockReturnValue(makeAdmin());
    const result = await startCheckout(request);
    expect(result.ok).toBe(true);
    expect(db.txns[0].metadata).toEqual({ checkout_url: "https://pay.example.com/session/abc" });
  });
});
