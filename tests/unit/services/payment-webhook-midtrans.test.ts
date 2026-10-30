// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { serverEnvMock, holder } = vi.hoisted(() => ({
  serverEnvMock: {
    payment: { providerName: "midtrans" as string | undefined, apiKey: "SB-Mid-server-TESTKEY123" as string | undefined, webhookSecret: undefined as string | undefined },
  },
  holder: { provider: null as unknown },
}));
vi.mock("@/lib/env", () => ({
  serverEnv: serverEnvMock,
  publicEnv: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", appUrl: "http://localhost:3000" },
}));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: () => holder.provider }));

import { MidtransPaymentProvider } from "@/lib/billing/providers/midtrans-payment-provider";
import { processPaymentWebhook } from "@/services/payment-webhook";
import {
  SERVER_KEY, TENANT_A, TENANT_B, TXN_A, TXN_B,
  addTxn, createFakeDb, installGateway, signedNotification, type FakeDb,
} from "../support/payment-fakes";

let db: FakeDb;
let gateway: ReturnType<typeof installGateway>;
const admin = () => db as unknown as SupabaseClient<Database>;
const deliver = (body: string) => processPaymentWebhook(admin(), body, null);

beforeEach(() => {
  serverEnvMock.payment.apiKey = SERVER_KEY;
  holder.provider = new MidtransPaymentProvider();
  db = createFakeDb();
  gateway = installGateway();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Billing B3 — attack scenarios against the Midtrans webhook", () => {
  describe("forged and malformed webhooks", () => {
    it("a webhook with a wrong signature is rejected: no gateway call, no database write, no activation", async () => {
      addTxn(db);
      const result = await deliver(signedNotification({}, "SB-Mid-server-ATTACKER"));
      expect(result.status).toBe(401);
      expect(gateway.fetchMock).not.toHaveBeenCalled();
      expect(db.rpcCalls).toEqual([]);
      expect(db.events).toEqual([]);
      expect(db.txns[0].status).toBe("PENDING");
    });
    it("garbage, an empty body, an unsigned body and the old Xendit-style token header all get 401", async () => {
      addTxn(db);
      for (const body of ["", "not json", "{}", JSON.stringify({ order_id: TXN_A, transaction_status: "settlement" })]) {
        const r = await processPaymentWebhook(admin(), body, SERVER_KEY);
        expect(r.status).toBe(401);
      }
      expect(db.rpcCalls).toEqual([]);
    });
    it("a production key disables the whole path (503) and never reaches Midtrans", async () => {
      addTxn(db);
      serverEnvMock.payment.apiKey = "Mid-server-PRODUCTIONKEY";
      const result = await deliver(signedNotification({}, "Mid-server-PRODUCTIONKEY"));
      expect(result.status).toBe(503);
      expect(gateway.fetchMock).not.toHaveBeenCalled();
      expect(db.rpcCalls).toEqual([]);
    });
  });

  describe("signature valid but the claim is manipulated — the gateway's own answer wins", () => {
    it("notification says settlement, Midtrans says cancel: nothing activates, the invoice is closed, the event is FAILED", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { transaction_status: "cancel" });
      const result = await deliver(signedNotification({ transaction_status: "settlement" }));
      expect(result.status).toBe(200);
      expect(db.rpcCalls).toEqual([]);
      expect(db.periods).toEqual({});
      expect(db.txns[0]).toMatchObject({ status: "CANCELLED", failure_reason: "GATEWAY_CANCELLED" });
      expect(db.events[0]).toMatchObject({ status: "FAILED", error: "STATUS_MISMATCH_CLAIMED_PAID" });
    });
    it("notification says settlement, Midtrans says still pending: 503 so Midtrans retries, nothing activates", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { transaction_status: "pending", status_code: "201" });
      const result = await deliver(signedNotification());
      expect(result.status).toBe(503);
      expect(db.rpcCalls).toEqual([]);
      expect(db.txns[0].status).toBe("PENDING");
      expect(db.events[0]).toMatchObject({ status: "FAILED", error: "VERIFIED_STATUS_NOT_PAID" });
    });
    it("notification says only 'pending' (out of order) but Midtrans says settlement: the truth wins and activates once", async () => {
      addTxn(db);
      gateway.answer(TXN_A, {});
      const result = await deliver(signedNotification({ transaction_status: "pending", status_code: "201" }));
      expect(result.status).toBe(200);
      expect(db.periods).toEqual({ [TENANT_A]: 1 });
      expect(db.txns[0].status).toBe("PAID");
    });
    it("the activation uses the GATEWAY's amount and currency, never the notification's", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { gross_amount: "1000.00" });
      const result = await deliver(signedNotification({ gross_amount: "99000.00" }));
      expect(db.rpcCalls).toHaveLength(1);
      expect(db.rpcCalls[0].args.p_verified_amount).toBe(1000);
      expect(db.rpcCalls[0].args.p_provider_payment_id).toBe("mid-tx-1");
      expect(result.message).toMatch(/manual review/i);
      expect(db.txns[0].status).toBe("REVIEW");
      expect(db.periods).toEqual({});
    });
    it("a currency that differs from the invoice is never activated (goes to REVIEW)", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { currency: "USD" });
      const result = await deliver(signedNotification());
      expect(result.status).toBe(200);
      expect(db.txns[0].status).toBe("REVIEW");
      expect(db.periods).toEqual({});
    });
    it("an unrecognised gateway status is never PAID and never closes the invoice", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { transaction_status: "weird" });
      const result = await deliver(signedNotification({ transaction_status: "weird" }));
      expect(result.status).toBe(200);
      expect(db.rpcCalls).toEqual([]);
      expect(db.txns[0].status).toBe("PENDING");
      expect(db.events[0].status).toBe("IGNORED");
    });
  });

  describe("fraud and non-paid states never activate", () => {
    it("capture + challenge: nothing activates, the invoice stays open", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { transaction_status: "capture", fraud_status: "challenge", status_code: "201" });
      const result = await deliver(signedNotification({ transaction_status: "capture", fraud_status: "challenge", status_code: "201" }));
      expect(result.status).toBe(200);
      expect(db.rpcCalls).toEqual([]);
      expect(db.txns[0].status).toBe("PENDING");
    });
    it("capture + deny: nothing activates, the invoice is closed FAILED", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { transaction_status: "capture", fraud_status: "deny", status_code: "202" });
      await deliver(signedNotification({ transaction_status: "capture", fraud_status: "deny", status_code: "202" }));
      expect(db.rpcCalls).toEqual([]);
      expect(db.txns[0]).toMatchObject({ status: "FAILED", failure_reason: "GATEWAY_FAILED" });
    });
    it("capture + accept IS paid", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { transaction_status: "capture", fraud_status: "accept" });
      const result = await deliver(signedNotification({ transaction_status: "capture", fraud_status: "accept" }));
      expect(result.status).toBe(200);
      expect(db.periods).toEqual({ [TENANT_A]: 1 });
    });
    it.each([
      ["cancel", "200", "CANCELLED"],
      ["expire", "407", "EXPIRED"],
      ["deny", "202", "FAILED"],
      ["failure", "202", "FAILED"],
    ])("a verified %s closes a pending invoice as %s and never activates", async (raw, code, closed) => {
      addTxn(db);
      gateway.answer(TXN_A, { transaction_status: raw, status_code: code });
      const result = await deliver(signedNotification({ transaction_status: raw, status_code: code }));
      expect(result.status).toBe(200);
      expect(db.rpcCalls).toEqual([]);
      expect(db.txns[0].status).toBe(closed);
      expect(db.events[0].status).toBe("IGNORED");
    });
  });

  describe("idempotency, replay, parallel and out-of-order delivery", () => {
    it("the same settlement delivered 10 times grants exactly ONE period", async () => {
      addTxn(db);
      gateway.answer(TXN_A, {});
      const results = [];
      for (let i = 0; i < 10; i++) results.push(await deliver(signedNotification()));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results[0].message).toBe("Payment applied.");
      expect(results[9].message).toBe("Already processed.");
      expect(db.periods).toEqual({ [TENANT_A]: 1 });
      expect(db.events).toHaveLength(1);
      expect(db.events[0].status).toBe("PROCESSED");
    });
    it("5 parallel deliveries of the same settlement grant exactly ONE period", async () => {
      addTxn(db);
      gateway.answer(TXN_A, {});
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => deliver(signedNotification())));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(db.periods).toEqual({ [TENANT_A]: 1 });
      expect(db.txns[0].status).toBe("PAID");
    });
    it("parallel deliveries of DIFFERENT states of one payment (pending + settlement) still grant one period", async () => {
      addTxn(db);
      gateway.answer(TXN_A, {});
      await Promise.all([
        deliver(signedNotification({ transaction_status: "pending", status_code: "201" })),
        deliver(signedNotification()),
        deliver(signedNotification({ transaction_status: "pending", status_code: "201" })),
      ]);
      expect(db.periods).toEqual({ [TENANT_A]: 1 });
    });
    it("an old 'pending' notification arriving after settlement changes nothing", async () => {
      addTxn(db);
      gateway.answer(TXN_A, {});
      await deliver(signedNotification());
      const late = await deliver(signedNotification({ transaction_status: "pending", status_code: "201" }));
      expect(late.status).toBe(200);
      expect(db.txns[0].status).toBe("PAID");
      expect(db.periods).toEqual({ [TENANT_A]: 1 });
    });
  });

  describe("late and mismatched payments are never lost", () => {
    it("a settlement for an EXPIRED invoice is recorded as REVIEW, not dropped and not activated", async () => {
      addTxn(db, { status: "EXPIRED" });
      gateway.answer(TXN_A, {});
      const result = await deliver(signedNotification());
      expect(result.status).toBe(200);
      expect(result.message).toMatch(/manual review/i);
      expect(db.txns[0].status).toBe("REVIEW");
      expect(db.periods).toEqual({});
      expect(db.events[0]).toMatchObject({ status: "FAILED", error: "NEEDS_REVIEW" });
    });
  });

  describe("refund and chargeback: evidence + alarm signal, never an automatic revocation", () => {
    it("a refund after PAID writes ONE audit row marked for B4, leaves the paid transaction untouched, and calls no activation", async () => {
      addTxn(db, { status: "PAID" });
      gateway.answer(TXN_A, { transaction_status: "refund" });
      const result = await deliver(signedNotification({ transaction_status: "refund" }));
      expect(result.status).toBe(200);
      expect(result.message).toMatch(/subscription unchanged/i);
      expect(db.rpcCalls).toEqual([]);
      expect(db.txns[0].status).toBe("PAID");
      expect(db.audit).toHaveLength(1);
      expect(db.audit[0]).toMatchObject({
        action: "payment.refund_reported",
        tenant_id: TENANT_A,
        resource_id: TXN_A,
        context: expect.objectContaining({ alarm: "PENDING_B4", subscription_changed: false }),
      });
      expect(db.events[0]).toMatchObject({ status: "FAILED", error: "ALARM_REFUND" });
    });
    it("replaying the refund notification does not duplicate the audit row", async () => {
      addTxn(db, { status: "PAID" });
      gateway.answer(TXN_A, { transaction_status: "refund" });
      await deliver(signedNotification({ transaction_status: "refund" }));
      await deliver(signedNotification({ transaction_status: "refund" }));
      await Promise.all([1, 2, 3].map(() => deliver(signedNotification({ transaction_status: "refund" }))));
      expect(db.audit).toHaveLength(1);
    });
    it("partial_refund, chargeback and partial_chargeback are recorded with their own action", async () => {
      for (const [raw, action] of [
        ["partial_refund", "payment.refund_reported"],
        ["chargeback", "payment.chargeback_reported"],
        ["partial_chargeback", "payment.chargeback_reported"],
      ] as const) {
        db = createFakeDb();
        addTxn(db, { status: "PAID" });
        gateway.answer(TXN_A, { transaction_status: raw });
        await deliver(signedNotification({ transaction_status: raw }));
        expect(db.audit.map((a) => a.action)).toEqual([action]);
        expect(db.txns[0].status).toBe("PAID");
        expect(db.rpcCalls).toEqual([]);
      }
    });
    it("a cancel/void arriving for an already PAID invoice is a reversal alarm, not a silent close", async () => {
      addTxn(db, { status: "PAID" });
      gateway.answer(TXN_A, { transaction_status: "cancel" });
      await deliver(signedNotification({ transaction_status: "cancel" }));
      expect(db.audit.map((a) => a.action)).toEqual(["payment.reversal_reported"]);
      expect(db.txns[0].status).toBe("PAID");
    });
    it("a refund on a REVIEW row is also recorded (the operator must know the money went back)", async () => {
      addTxn(db, { status: "REVIEW" });
      gateway.answer(TXN_A, { transaction_status: "refund" });
      await deliver(signedNotification({ transaction_status: "refund" }));
      expect(db.audit).toHaveLength(1);
      expect(db.txns[0].status).toBe("REVIEW");
    });
    it("if the alarm evidence cannot be written the webhook asks for a retry (500) instead of losing it", async () => {
      addTxn(db, { status: "PAID" });
      db.failAuditInsert = true;
      gateway.answer(TXN_A, { transaction_status: "refund" });
      const result = await deliver(signedNotification({ transaction_status: "refund" }));
      expect(result.status).toBe(500);
      expect(db.audit).toEqual([]);
    });
    it("a replayed OLD settlement after a refund does not rewrite the PROCESSED event or revoke anything", async () => {
      addTxn(db);
      gateway.answer(TXN_A, {});
      await deliver(signedNotification());
      expect(db.events[0].status).toBe("PROCESSED");

      gateway.answer(TXN_A, { transaction_status: "refund" });
      await deliver(signedNotification());
      expect(db.events[0].status).toBe("PROCESSED");
      expect(db.txns[0].status).toBe("PAID");
      expect(db.audit.map((a) => a.action)).toEqual(["payment.refund_reported"]);
    });
  });

  describe("cross-provider and cross-tenant", () => {
    it("a Midtrans notification for an invoice created by ANOTHER provider is refused (400) and never verified", async () => {
      addTxn(db, { provider: "xendit" });
      const result = await deliver(signedNotification());
      expect(result.status).toBe(400);
      expect(gateway.fetchMock).not.toHaveBeenCalled();
      expect(db.rpcCalls).toEqual([]);
      expect(db.txns[0].status).toBe("PENDING");
    });
    it("an unknown order and a non-UUID order id are 400 and never reach Midtrans", async () => {
      expect((await deliver(signedNotification({ order_id: TXN_B }))).status).toBe(400);
      expect((await deliver(signedNotification({ order_id: "ORDER-123", transaction_id: "x2" }))).status).toBe(400);
      expect((await deliver(signedNotification({ order_id: "../../v1/payouts", transaction_id: "x3" }))).status).toBe(400);
      expect(gateway.fetchMock).not.toHaveBeenCalled();
      expect(db.rpcCalls).toEqual([]);
    });
    it("a payment settles ONLY the invoice it belongs to — another tenant's pending invoice is untouched", async () => {
      addTxn(db, { id: TXN_A, tenant_id: TENANT_A });
      addTxn(db, { id: TXN_B, tenant_id: TENANT_B });
      gateway.answer(TXN_B, {});
      await deliver(signedNotification({ order_id: TXN_B }));
      expect(db.rpcCalls.map((c) => c.args.p_transaction_id)).toEqual([TXN_B]);
      expect(db.periods).toEqual({ [TENANT_B]: 1 });
      expect(db.txns.find((t) => t.id === TXN_A)?.status).toBe("PENDING");
    });
    it("if Midtrans answers for a different order than the one we asked about, nothing activates (503)", async () => {
      addTxn(db, { id: TXN_A, tenant_id: TENANT_A });
      addTxn(db, { id: TXN_B, tenant_id: TENANT_B });
      gateway.answer(TXN_A, { order_id: TXN_B });
      const result = await deliver(signedNotification({ order_id: TXN_A }));
      expect(result.status).toBe(503);
      expect(db.rpcCalls).toEqual([]);
      expect(db.periods).toEqual({});
    });
  });

  describe("Midtrans API failures are fail-closed", () => {
    it.each(["TIMEOUT", "HTTP_500", "GARBAGE", "NOT_FOUND_BODY"] as const)("%s → 503, nothing activates, the event is FAILED and retryable", async (failure) => {
      addTxn(db);
      gateway.answer(TXN_A, failure);
      const result = await deliver(signedNotification());
      expect(result.status).toBe(503);
      expect(db.rpcCalls).toEqual([]);
      expect(db.periods).toEqual({});
      expect(db.txns[0].status).toBe("PENDING");
      expect(db.events[0]).toMatchObject({ status: "FAILED", error: "GATEWAY_VERIFICATION_FAILED" });
    });
    it("after the outage ends, the redelivery completes the activation exactly once", async () => {
      addTxn(db);
      gateway.answer(TXN_A, "TIMEOUT");
      expect((await deliver(signedNotification())).status).toBe(503);
      gateway.answer(TXN_A, {});
      expect((await deliver(signedNotification())).status).toBe(200);
      expect((await deliver(signedNotification())).status).toBe(200);
      expect(db.periods).toEqual({ [TENANT_A]: 1 });
      expect(db.events[0].status).toBe("PROCESSED");
    });
    it("a 'paid' answer without Midtrans' own payment reference is not activated", async () => {
      addTxn(db);
      gateway.answer(TXN_A, { transaction_id: undefined });
      const result = await deliver(signedNotification());
      expect(result.status).toBe(503);
      expect(db.rpcCalls).toEqual([]);
    });
    it("a database error while applying a verified payment asks for a retry (500) and is recorded as FAILED", async () => {
      addTxn(db);
      gateway.answer(TXN_A, {});
      db.rpcError = true;
      const result = await deliver(signedNotification());
      expect(result.status).toBe(500);
      expect(db.events[0].status).toBe("FAILED");
      expect(db.periods).toEqual({});
    });
  });

  it("the server key never appears in any response message, event row or audit row", async () => {
    addTxn(db, { status: "PAID" });
    gateway.answer(TXN_A, { transaction_status: "refund" });
    const results = [
      await deliver(signedNotification({ transaction_status: "refund" })),
      await deliver(signedNotification({}, "SB-Mid-server-ATTACKER")),
    ];
    const everything = JSON.stringify({ results, events: db.events, audit: db.audit, txns: db.txns });
    expect(everything).not.toContain(SERVER_KEY);
  });
});
