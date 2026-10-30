// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { serverEnvMock, holder, rateBuckets } = vi.hoisted(() => ({
  rateBuckets: new Map<string, number>(),
  serverEnvMock: {
    payment: { providerName: "midtrans" as string | undefined, apiKey: "SB-Mid-server-TESTKEY123" as string | undefined, webhookSecret: undefined as string | undefined },
  },
  holder: { provider: null as unknown, admin: null as unknown },
}));
vi.mock("@/lib/env", () => ({
  serverEnv: serverEnvMock,
  publicEnv: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", appUrl: "http://localhost:3000" },
}));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: () => holder.provider }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => holder.admin }));
// Per-test, resettable stand-in with the same contract as lib/rate-limit (the real limiter is covered by its own tests).
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string, limit: number) => {
    const n = (rateBuckets.get(key) ?? 0) + 1;
    rateBuckets.set(key, n);
    return { allowed: n <= limit, limit, remaining: Math.max(0, limit - n), resetAt: 0 };
  },
}));

import { MidtransPaymentProvider } from "@/lib/billing/providers/midtrans-payment-provider";
import { reconcileCheckoutReturn } from "@/services/payment-reconciliation";
import { SERVER_KEY, TENANT_A, TENANT_B, TXN_A, TXN_B, addTxn, createFakeDb, installGateway, type FakeDb } from "../support/payment-fakes";

let db: FakeDb;
let gateway: ReturnType<typeof installGateway>;
const client = () => db as unknown as SupabaseClient<Database>;

beforeEach(() => {
  rateBuckets.clear();
  serverEnvMock.payment.apiKey = SERVER_KEY;
  holder.provider = new MidtransPaymentProvider();
  db = createFakeDb();
  holder.admin = db;
  gateway = installGateway();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reconcileCheckoutReturn — Billing B3 verified return from checkout", () => {
  it("a 'success' redirect proves nothing: while Midtrans still says pending the invoice stays PENDING and nothing activates", async () => {
    addTxn(db);
    gateway.answer(TXN_A, { transaction_status: "pending", status_code: "201" });
    const result = await reconcileCheckoutReturn(client(), TENANT_A, TXN_A);
    expect(result.status).toBe("PENDING");
    expect(db.rpcCalls).toEqual([]);
    expect(db.periods).toEqual({});
    expect(gateway.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("when Midtrans itself confirms settlement the SERVER settles it (a lost webhook cannot strand a paying customer)", async () => {
    addTxn(db);
    gateway.answer(TXN_A, {});
    const result = await reconcileCheckoutReturn(client(), TENANT_A, TXN_A);
    expect(result.status).toBe("PAID");
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.rpcCalls[0].args).toMatchObject({
      p_transaction_id: TXN_A,
      p_provider_payment_id: "mid-tx-1",
      p_provider_event_id: "status-api:mid-tx-1",
      p_verified_amount: 99000,
      p_verified_currency: "IDR",
    });
  });

  it("webhook + return trip together still grant exactly one period", async () => {
    addTxn(db);
    gateway.answer(TXN_A, {});
    await Promise.all([
      reconcileCheckoutReturn(client(), TENANT_A, TXN_A),
      reconcileCheckoutReturn(client(), TENANT_A, TXN_A),
    ]);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
  });

  it("a verified cancel / expiry closes the invoice and the page reports it", async () => {
    addTxn(db);
    gateway.answer(TXN_A, { transaction_status: "expire", status_code: "407" });
    const result = await reconcileCheckoutReturn(client(), TENANT_A, TXN_A);
    expect(result.status).toBe("EXPIRED");
    expect(db.rpcCalls).toEqual([]);
  });

  it("another tenant's transaction id is NOT_FOUND and Midtrans is never asked", async () => {
    addTxn(db, { id: TXN_B, tenant_id: TENANT_B });
    const result = await reconcileCheckoutReturn(client(), TENANT_A, TXN_B);
    expect(result).toEqual({ status: "NOT_FOUND", plan: null });
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
  });

  it("an already-decided transaction is reported from the database without calling Midtrans", async () => {
    addTxn(db, { status: "PAID" });
    const result = await reconcileCheckoutReturn(client(), TENANT_A, TXN_A);
    expect(result.status).toBe("PAID");
    expect(gateway.fetchMock).not.toHaveBeenCalled();
  });

  it("Midtrans being down leaves the invoice PENDING and activates nothing", async () => {
    addTxn(db);
    gateway.answer(TXN_A, "TIMEOUT");
    const result = await reconcileCheckoutReturn(client(), TENANT_A, TXN_A);
    expect(result.status).toBe("PENDING");
    expect(db.rpcCalls).toEqual([]);
  });

  it("an invoice created by a different provider is never verified through Midtrans", async () => {
    addTxn(db, { provider: "xendit" });
    const result = await reconcileCheckoutReturn(client(), TENANT_A, TXN_A);
    expect(result.status).toBe("PENDING");
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
  });

  it("the page cannot be used to hammer Midtrans: at most 6 gateway checks per transaction per minute", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    addTxn(db, { id });
    gateway.answer(id, { transaction_status: "pending", status_code: "201" });
    for (let i = 0; i < 10; i++) await reconcileCheckoutReturn(client(), TENANT_A, id);
    expect(gateway.fetchMock).toHaveBeenCalledTimes(6);
  });

  it("with a production key the return trip never calls Midtrans and never activates", async () => {
    addTxn(db);
    serverEnvMock.payment.apiKey = "Mid-server-PRODUCTIONKEY";
    const result = await reconcileCheckoutReturn(client(), TENANT_A, TXN_A);
    expect(result.status).toBe("PENDING");
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
  });
});
