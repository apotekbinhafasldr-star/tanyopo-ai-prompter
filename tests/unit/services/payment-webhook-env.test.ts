// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { serverEnvMock, publicEnvMock, holder } = vi.hoisted(() => ({
  serverEnvMock: {
    supabaseSecretKey: undefined as string | undefined,
    payment: {
      providerName: "midtrans" as string | undefined,
      apiKey: "SB-Mid-server-TESTKEY123" as string | undefined,
      webhookSecret: undefined as string | undefined,
      sandboxDbRefs: "abcdefghij0123456789" as string | undefined,
    },
  },
  publicEnvMock: { supabaseUrl: "https://abcdefghij0123456789.supabase.co", supabasePublishableKey: "k", appUrl: "http://localhost:3000" },
  holder: { provider: null as unknown },
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock, publicEnv: publicEnvMock }));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: () => holder.provider }));

import { PRODUCTION_SUPABASE_REFS } from "@/lib/billing/providers/doku-sandbox-db-guard";
import { MidtransPaymentProvider } from "@/lib/billing/providers/midtrans-payment-provider";
import { verifyAndSettle, type VerifyingPaymentProvider } from "@/services/payment-verification";
import { processPaymentWebhook } from "@/services/payment-webhook";
import {
  OTHER_REF, SANDBOX_REF, SERVER_KEY, TENANT_A, TXN_A,
  addTxn, createFakeDb, installGateway, signedNotification, type FakeDb,
} from "../support/payment-fakes";

const PROD = PRODUCTION_SUPABASE_REFS[0];
const LIVE_KEY = "Mid-server-LIVEKEY789";

let db: FakeDb;
let gateway: ReturnType<typeof installGateway>;
const admin = () => db as unknown as SupabaseClient<Database>;
const deliver = (body: string) => processPaymentWebhook(admin(), body, null);

/** Switches the mocked server to the live runtime (both switches, live key, production database). */
function goLive() {
  vi.stubEnv("PAYMENT_LIVE_ENABLED", "true");
  vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
  serverEnvMock.payment.apiKey = LIVE_KEY;
  publicEnvMock.supabaseUrl = `https://${PROD}.supabase.co`;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("PAYMENT_LIVE_ENABLED", "");
  vi.stubEnv("PAYMENT_PROVIDER_ENV", "");
  serverEnvMock.payment.apiKey = SERVER_KEY;
  serverEnvMock.payment.sandboxDbRefs = SANDBOX_REF;
  serverEnvMock.supabaseSecretKey = undefined;
  publicEnvMock.supabaseUrl = `https://${SANDBOX_REF}.supabase.co`;
  holder.provider = new MidtransPaymentProvider();
  db = createFakeDb();
  gateway = installGateway();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectUntouched(reasonMarker: string) {
  expect(gateway.fetchMock).not.toHaveBeenCalled();
  expect(db.rpcCalls).toEqual([]);
  expect(db.periods).toEqual({});
  expect(db.txns[0].status).toBe("PENDING");
  expect(db.events).toHaveLength(1);
  expect(db.events[0]).toMatchObject({ status: "FAILED", error: reasonMarker });
}

describe("D3 — a transaction is settled only in the environment and database it was created in", () => {
  it("D4: a SANDBOX-stamped transaction meeting a LIVE runtime is refused: 200, no gateway call, no activation, transaction unchanged", async () => {
    addTxn(db); // default stamp = sandbox + sandbox ref
    goLive();
    const result = await deliver(signedNotification({}, LIVE_KEY));
    expect(result).toMatchObject({ ok: true, status: 200 });
    expectUntouched("ENV_MISMATCH:SANDBOX_TXN_IN_LIVE");
  });

  it("D5: a LIVE-stamped transaction meeting a SANDBOX runtime is refused", async () => {
    addTxn(db, { metadata: { pg_env: "live", pg_db_ref: SANDBOX_REF } });
    const result = await deliver(signedNotification());
    expect(result).toMatchObject({ ok: true, status: 200 });
    expectUntouched("ENV_MISMATCH:LIVE_TXN_IN_SANDBOX");
  });

  it("D6: a transaction stamped for another database project (e.g. a restored copy) is refused", async () => {
    addTxn(db, { metadata: { pg_env: "sandbox", pg_db_ref: OTHER_REF } });
    const result = await deliver(signedNotification());
    expect(result).toMatchObject({ ok: true, status: 200 });
    expectUntouched("ENV_MISMATCH:DB_REF_CHANGED");
  });

  it("D7: a transaction without a stamp (created before this guard, or stripped) is refused, never activated", async () => {
    for (const metadata of [{}, null, { checkout_url: "https://pay.example/x" }, { pg_env: "sandbox" }]) {
      db = createFakeDb();
      gateway = installGateway();
      addTxn(db, { metadata });
      const result = await deliver(signedNotification());
      expect(result).toMatchObject({ ok: true, status: 200 });
      expectUntouched("ENV_MISMATCH:STAMP_MISSING");
    }
  });

  it("D8: a matching stamp changes nothing about the verified flow: PAID activates exactly one period", async () => {
    addTxn(db);
    gateway.answer(TXN_A, { transaction_status: "settlement" });
    const result = await deliver(signedNotification());
    expect(result).toMatchObject({ ok: true, status: 200, message: "Payment applied." });
    expect(db.txns[0].status).toBe("PAID");
    expect(db.periods[TENANT_A]).toBe(1);
  });

  it("D8b: a matching stamp keeps refund handling intact (alarm, subscription untouched)", async () => {
    addTxn(db, { status: "PAID" });
    gateway.answer(TXN_A, { transaction_status: "refund", status_code: "200" });
    const result = await deliver(signedNotification({ transaction_status: "refund" }));
    expect(result.ok).toBe(true);
    expect(db.alerts).toHaveLength(1);
    expect(db.periods).toEqual({});
  });

  it("E3: redelivering a refused notification keeps ONE event row and never reaches the gateway or the database function", async () => {
    addTxn(db, { metadata: {} });
    const body = signedNotification();
    const results = [await deliver(body), await deliver(body), await deliver(body)];
    for (const r of results) expect(r).toMatchObject({ ok: true, status: 200 });
    expectUntouched("ENV_MISMATCH:STAMP_MISSING");
    expect(db.alerts).toEqual([]);
  });

  it("E3b: a refused delivery never downgrades an event already recorded as PROCESSED", async () => {
    addTxn(db);
    gateway.answer(TXN_A, { transaction_status: "settlement" });
    await deliver(signedNotification());
    expect(db.events[0].status).toBe("PROCESSED");
    // The stamp is later stripped (tampering / restore): a replay is refused but history is kept.
    db.txns[0].metadata = {};
    const replay = await deliver(signedNotification());
    expect(replay).toMatchObject({ ok: true, status: 200 });
    expect(db.events).toHaveLength(1);
    expect(db.events[0].status).toBe("PROCESSED");
    expect(db.periods[TENANT_A]).toBe(1);
  });
});

describe("D3 — webhook order of defences (signature and configuration come before everything)", () => {
  it("E1: a sandbox-signed notification sent to a LIVE instance fails the signature: 401, no event, no gateway call", async () => {
    addTxn(db);
    goLive();
    const result = await deliver(signedNotification({}, SERVER_KEY));
    expect(result.status).toBe(401);
    expect(db.events).toEqual([]);
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
  });

  it("E1b: a live-signed notification sent to a SANDBOX instance fails the signature too", async () => {
    addTxn(db);
    const result = await deliver(signedNotification({}, LIVE_KEY));
    expect(result.status).toBe(401);
    expect(db.events).toEqual([]);
  });

  it("E2: when the database guard switches the adapter OFF the webhook answers 503 before any event is logged", async () => {
    addTxn(db);
    publicEnvMock.supabaseUrl = `https://${PROD}.supabase.co`; // sandbox key + production database
    const result = await deliver(signedNotification());
    expect(result.status).toBe(503);
    expect(db.events).toEqual([]);
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
  });
});

describe("D3 — verifyAndSettle contract (used by webhook, sweeper, recheck and the return page)", () => {
  it("returns ENV_MISMATCH before asking the gateway and writes nothing; a provider without runtimeEnvironment is unaffected", async () => {
    addTxn(db, { metadata: {} });
    const provider = holder.provider as MidtransPaymentProvider;
    const spy = vi.spyOn(provider, "getVerifiedPayment");
    const outcome = await verifyAndSettle(admin(), provider as VerifyingPaymentProvider, TXN_A, { eventId: null });
    expect(outcome).toEqual({ kind: "ENV_MISMATCH", reason: "STAMP_MISSING" });
    expect(spy).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");

    // Same transaction, adapter that does not report an environment (e.g. DOKU, which has its own guard): old behaviour.
    const plain: VerifyingPaymentProvider = {
      name: "midtrans",
      isConfigured: () => true,
      createCheckoutSession: vi.fn(),
      getPaymentStatus: vi.fn(),
      cancelSubscription: vi.fn(),
      verifyWebhookSignature: () => true,
      parseWebhookEvent: vi.fn(),
      getVerifiedPayment: vi.fn(async () => ({ orderId: TXN_A, gatewayTransactionId: "mid-tx-1", status: "PENDING" as const, amount: 99000, currency: "IDR", rawStatus: "pending/201" })),
    };
    const old = await verifyAndSettle(admin(), plain, TXN_A, { eventId: null });
    expect(old.kind).toBe("NOT_PAID");
    expect(plain.getVerifiedPayment).toHaveBeenCalledTimes(1);
  });

  it("an unprovable runtime (adapter reports null) is a mismatch, not a pass", async () => {
    addTxn(db);
    const provider = { ...(holder.provider as MidtransPaymentProvider), name: "midtrans", runtimeEnvironment: () => null, getVerifiedPayment: vi.fn() } as unknown as VerifyingPaymentProvider;
    const outcome = await verifyAndSettle(admin(), provider, TXN_A, { eventId: null });
    expect(outcome).toEqual({ kind: "ENV_MISMATCH", reason: "RUNTIME_UNPROVABLE" });
    expect(provider.getVerifiedPayment).not.toHaveBeenCalled();
  });
});
