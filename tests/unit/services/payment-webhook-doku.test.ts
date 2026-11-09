// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { serverEnvMock, publicEnvMock, holder } = vi.hoisted(() => ({
  publicEnvMock: { supabaseUrl: "https://abcdefghij0123456789.supabase.co", supabasePublishableKey: "k", appUrl: "http://localhost:3000" },
  serverEnvMock: {
    supabaseSecretKey: undefined as string | undefined,
    payment: {
      sandboxDbRefs: "abcdefghij0123456789" as string | undefined,
      providerName: "doku" as string | undefined,
      apiKey: "dokusecretkey-123456" as string | undefined,
      clientId: "MCH-0001-1234567890" as string | undefined,
      webhookSecret: undefined as string | undefined,
    },
  },
  holder: { provider: null as unknown },
}));
vi.mock("@/lib/env", () => ({
  serverEnv: serverEnvMock,
  publicEnv: publicEnvMock,
}));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: () => holder.provider }));

import { DokuPaymentProvider, computeDokuSignature, encodeDokuInvoiceNumber } from "@/lib/billing/providers/doku-payment-provider";
import { MidtransPaymentProvider } from "@/lib/billing/providers/midtrans-payment-provider";
import { processPaymentWebhook } from "@/services/payment-webhook";
import { SERVER_KEY, TENANT_A, TENANT_B, TXN_A, TXN_B, addTxn, createFakeDb, signedNotification, type FakeDb } from "../support/payment-fakes";

const SECRET = "dokusecretkey-123456";
const CLIENT = "MCH-0001-1234567890";
const PATH = "/api/webhooks/payment";
type Row = Record<string, unknown>;

let db: FakeDb;
const admin = () => db as unknown as SupabaseClient<Database>;

/** Fakes DOKU Check Status: answers per transaction (decoded from the invoice in the URL), records every call. */
type Answer = Row | "TIMEOUT" | "HTTP_500" | "HTTP_404" | "GARBAGE" | "HUGE";
function installDoku() {
  const answers = new Map<string, Answer>();
  const fetchMock = vi.fn(async (url: string) => {
    const m = /\/orders\/v1\/status\/(LN[0-9A-Z]{25})$/.exec(String(url));
    const invoice = m?.[1] ?? "";
    const txn = [TXN_A, TXN_B].find((id) => encodeDokuInvoiceNumber(id) === invoice) ?? "";
    const a = answers.get(txn);
    if (a === "TIMEOUT") throw new DOMException("timed out", "TimeoutError");
    if (a === "HTTP_500") return new Response("{}", { status: 500 });
    if (a === "HTTP_404") return new Response("{}", { status: 404 });
    if (a === "GARBAGE") return new Response("<html>", { status: 200 });
    if (a === "HUGE") return new Response(JSON.stringify({ pad: "x".repeat(70_000) }), { status: 200 });
    if (a === undefined) return new Response("{}", { status: 404 });
    const order: Row = { invoice_number: invoice, amount: 99000, currency: "IDR", ...(a.order as Row | undefined) };
    const transaction: Row = { status: "SUCCESS", original_request_id: "orig-req-1", date: "2026-11-09T10:01:00Z", ...(a.transaction as Row | undefined) };
    const extraRoot = Object.fromEntries(Object.entries(a).filter(([key]) => key !== "order" && key !== "transaction")); // e.g. a top-level `refund` or `card_payment` block
    return new Response(JSON.stringify({ order, transaction, ...extraRoot }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, answer: (txn: string, a: Answer) => void answers.set(txn, a) };
}
let gateway: ReturnType<typeof installDoku>;

/** A DOKU notification signed like DOKU does. */
function notification(over: { txn?: string; status?: string; type?: string; amount?: number; requestId?: string; secret?: string; path?: string; invoice?: string } = {}) {
  const invoice = over.invoice ?? encodeDokuInvoiceNumber(over.txn ?? TXN_A);
  const body = JSON.stringify({
    order: { invoice_number: invoice, amount: over.amount ?? 99000 },
    transaction: { status: over.status ?? "SUCCESS", ...(over.type ? { type: over.type } : {}), original_request_id: "orig-req-1" },
    acquirer: { id: "BCA" },
  });
  const requestId = over.requestId ?? "notif-1";
  const timestamp = "2026-11-09T10:00:00Z";
  const headers: Record<string, string> = {
    "client-id": CLIENT,
    "request-id": requestId,
    "request-timestamp": timestamp,
    signature: computeDokuSignature({ clientId: CLIENT, requestId, timestamp, requestTarget: PATH, rawBody: body, secretKey: over.secret ?? SECRET }),
  };
  return { body, request: { headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, path: over.path ?? PATH }, headers };
}
const deliver = (n: ReturnType<typeof notification>) => processPaymentWebhook(admin(), n.body, null, n.request);
const dokuTxn = (over: Row = {}) => addTxn(db, { provider: "doku", ...over });

beforeEach(() => {
  serverEnvMock.payment.apiKey = SECRET;
  serverEnvMock.payment.clientId = CLIENT;
  serverEnvMock.payment.sandboxDbRefs = "abcdefghij0123456789";
  publicEnvMock.supabaseUrl = "https://abcdefghij0123456789.supabase.co";
  vi.stubEnv("PAYMENT_PROVIDER_ENV", "sandbox");
  vi.stubEnv("PAYMENT_LIVE_ENABLED", "");
  holder.provider = new DokuPaymentProvider();
  db = createFakeDb();
  gateway = installDoku();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("DOKU webhook — happy path and idempotency", () => {
  it("a valid notification + Check Status SUCCESS activates exactly one period, from the GATEWAY's numbers", async () => {
    dokuTxn();
    gateway.answer(TXN_A, {});
    const r = await deliver(notification());
    expect(r).toMatchObject({ ok: true, status: 200, message: "Payment applied." });
    expect(db.txns[0].status).toBe("PAID");
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].args).toMatchObject({
      p_transaction_id: TXN_A, p_provider_payment_id: "orig-req-1", p_provider_event_id: "notif-1", p_verified_amount: 99000, p_verified_currency: "IDR",
    });
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({ source_system: "doku", external_event_id: "notif-1", status: "PROCESSED" });
    // Check Status is a signed GET on the sandbox host
    const [url, init] = gateway.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api-sandbox.doku.com/orders/v1/status/${encodeDokuInvoiceNumber(TXN_A)}`);
    expect((init.headers as Record<string, string>).Signature).toMatch(/^HMACSHA256=/);
  });
  it("replaying the identical delivery (and a parallel burst) never grants a second period or a second event row", async () => {
    dokuTxn();
    gateway.answer(TXN_A, {});
    const n = notification();
    await deliver(n);
    const again = await deliver(n);
    await Promise.all([1, 2, 3].map(() => deliver(n)));
    expect(again.message).toBe("Already processed.");
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.events).toHaveLength(1);
  });
  it("the same payment re-sent with a NEW Request-Id (a different delivery) still activates only once", async () => {
    dokuTxn();
    gateway.answer(TXN_A, {});
    await deliver(notification({ requestId: "notif-1" }));
    const r = await deliver(notification({ requestId: "notif-2" }));
    expect(r.message).toBe("Already processed.");
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.events).toHaveLength(2);
  });
});

describe("DOKU webhook — authentication (nothing is read or written for an unauthentic request)", () => {
  const untouched = () => {
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
    expect(db.events).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
  };
  it("a wrong secret → 401", async () => {
    dokuTxn();
    const r = await deliver(notification({ secret: "attacker-secret-key" }));
    expect(r.status).toBe(401);
    untouched();
  });
  it("a tampered body, a different path, a missing header, a foreign Client-Id → 401", async () => {
    dokuTxn();
    const n = notification();
    expect((await processPaymentWebhook(admin(), n.body.replace("99000", "1"), null, n.request)).status).toBe(401);
    expect((await deliver(notification({ path: "/api/webhooks/other" }))).status).toBe(401);
    const noSig = notification();
    delete noSig.headers.signature;
    expect((await deliver(noSig)).status).toBe(401);
    const foreign = notification();
    foreign.headers["client-id"] = "MCH-9999-0000000000";
    expect((await deliver(foreign)).status).toBe(401);
    untouched();
  });
  it("no request context at all (a caller that cannot supply headers) → 401, never the legacy token path", async () => {
    dokuTxn();
    const n = notification();
    expect((await processPaymentWebhook(admin(), n.body, null)).status).toBe(401);
    expect((await processPaymentWebhook(admin(), n.body, SECRET)).status).toBe(401);
    untouched();
  });
  it("garbage / empty bodies → 401", async () => {
    dokuTxn();
    for (const body of ["", "not json", "{}"]) {
      const r = await processPaymentWebhook(admin(), body, null, notification().request);
      expect(r.status).toBe(401);
    }
    untouched();
  });
  it("unconfigured (live switch on, production env, or no sandbox statement) → 503 and the gateway is never contacted", async () => {
    dokuTxn();
    for (const [env, flag] of [["production", ""], ["sandbox", "true"], ["", ""]] as const) {
      vi.stubEnv("PAYMENT_PROVIDER_ENV", env);
      vi.stubEnv("PAYMENT_LIVE_ENABLED", flag);
      expect((await deliver(notification())).status).toBe(503);
    }
    untouched();
  });
});

describe("DOKU webhook — a signed notification is only a claim; the Check Status answer decides", () => {
  it("claims SUCCESS but DOKU says PENDING → 503 (DOKU retries), nothing activates", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { transaction: { status: "PENDING" } });
    const r = await deliver(notification());
    expect(r.status).toBe(503);
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.events[0]).toMatchObject({ status: "FAILED", error: "VERIFIED_STATUS_NOT_PAID" });
  });
  it("claims SUCCESS but DOKU says FAILED (customer may retry another method) → 503, the invoice stays OPEN", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { transaction: { status: "FAILED" } });
    expect((await deliver(notification())).status).toBe(503);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
  });
  it("claims SUCCESS but DOKU says EXPIRED → ignored, the invoice is closed, nothing activates", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { transaction: { status: "EXPIRED" } });
    const r = await deliver(notification());
    expect(r.status).toBe(200);
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0]).toMatchObject({ status: "EXPIRED", failure_reason: "GATEWAY_EXPIRED" });
    expect(db.events[0]).toMatchObject({ status: "FAILED", error: "STATUS_MISMATCH_CLAIMED_PAID" });
  });
  it("claims FAILED while DOKU says SUCCESS: the truth wins (activates once)", async () => {
    dokuTxn();
    gateway.answer(TXN_A, {});
    expect((await deliver(notification({ status: "FAILED" }))).status).toBe(200);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
  });
  it("a notification that merely claims FAILED while DOKU says PENDING records nothing harmful and keeps the invoice open", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { transaction: { status: "PENDING" } });
    const r = await deliver(notification({ status: "FAILED" }));
    expect(r.status).toBe(200);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.events[0].status).toBe("IGNORED");
  });
  it("an expired notification closes a still-PENDING invoice only", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { transaction: { status: "EXPIRED" } });
    await deliver(notification({ status: "EXPIRED" }));
    expect(db.txns[0].status).toBe("EXPIRED");
    expect(db.periods).toEqual({});
  });
});

describe("DOKU webhook — amount / currency mismatch and missing verification data", () => {
  it("DOKU reports a different amount → REVIEW, never activated", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { order: { amount: 1000 } });
    const r = await deliver(notification({ amount: 99000 }));
    expect(r.message).toMatch(/manual review/i);
    expect(db.rpcCalls[0].args.p_verified_amount).toBe(1000); // the gateway's number, not the notification's
    expect(db.txns[0].status).toBe("REVIEW");
    expect(db.periods).toEqual({});
  });
  it("DOKU reports a foreign currency → nothing activates, retry (503)", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { order: { currency: "USD" } });
    expect((await deliver(notification())).status).toBe(503);
    expect(db.rpcCalls).toEqual([]);
    expect(db.periods).toEqual({});
  });
  it.each([
    ["no amount", { order: { amount: undefined } }],
    ["no gateway reference", { transaction: { original_request_id: undefined } }],
    ["amount zero", { order: { amount: 0 } }],
    ["no transaction status", { transaction: { status: undefined } }],
    ["an answer about another invoice", { order: { invoice_number: encodeDokuInvoiceNumber(TXN_B) } }],
  ])("SUCCESS-looking answer with %s never activates and is retried safely (503)", async (_name, partial) => {
    dokuTxn();
    gateway.answer(TXN_A, partial as Row);
    const r = await deliver(notification());
    expect(r.status).toBe(503);
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
    expect(db.events[0]).toMatchObject({ status: "FAILED" });
  });
  it("SUCCESS on an order DOKU also calls expired is ambiguous: no activation, no closing, retry", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { order: { status: "ORDER_EXPIRED" } });
    expect((await deliver(notification())).status).toBe(503);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
  });
  it("an unrecognised DOKU status never activates and never closes the invoice", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { transaction: { status: "SOMETHING_NEW" } });
    expect((await deliver(notification({ status: "SOMETHING_NEW" }))).status).toBe(200);
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");
  });
  it.each(["TIMEOUT", "HTTP_500", "HTTP_404", "GARBAGE", "HUGE"] as const)("Check Status %s → fail closed (503), nothing activates", async (failure) => {
    dokuTxn();
    gateway.answer(TXN_A, failure);
    const r = await deliver(notification());
    expect(r.status).toBe(503);
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
  });
});

describe("DOKU webhook — replay: a final delivery never asks DOKU again, an unfinished one still retries", () => {
  it("20 deliveries of the same PROCESSED notification cause exactly ONE Check Status call and one period", async () => {
    dokuTxn();
    gateway.answer(TXN_A, {});
    const n = notification();
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await deliver(n));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results[0].message).toBe("Payment applied.");
    expect(results[19].message).toBe("Already processed.");
    expect(gateway.fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.events).toHaveLength(1);
    expect(db.events[0].status).toBe("PROCESSED");
  });
  it("20 parallel deliveries of a brand-new notification still grant exactly one period", async () => {
    dokuTxn();
    gateway.answer(TXN_A, {});
    const n = notification();
    const results = await Promise.all(Array.from({ length: 20 }, () => deliver(n)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.events).toHaveLength(1);
  });
  it("a PENDING answer keeps the retry path open: the SAME delivery, re-sent after DOKU says SUCCESS, completes the activation", async () => {
    dokuTxn();
    const n = notification();
    gateway.answer(TXN_A, { transaction: { status: "PENDING" } });
    expect((await deliver(n)).status).toBe(503);
    expect(db.events[0]).toMatchObject({ status: "FAILED", error: "VERIFIED_STATUS_NOT_PAID" });
    expect((await deliver(n)).status).toBe(503); // still pending: asked again (not a final event)
    expect(gateway.fetchMock).toHaveBeenCalledTimes(2);
    gateway.answer(TXN_A, {});
    const done = await deliver(n);
    expect(done).toMatchObject({ status: 200, message: "Payment applied." });
    expect(gateway.fetchMock).toHaveBeenCalledTimes(3);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.events).toHaveLength(1);
    expect(db.events[0].status).toBe("PROCESSED");
    await deliver(n); // now final
    expect(gateway.fetchMock).toHaveBeenCalledTimes(3);
  });
  it("an unreachable DOKU (503) is retried on the same delivery, not short-circuited", async () => {
    dokuTxn();
    const n = notification();
    gateway.answer(TXN_A, "TIMEOUT");
    expect((await deliver(n)).status).toBe(503);
    expect((await deliver(n)).status).toBe(503);
    gateway.answer(TXN_A, {});
    expect((await deliver(n)).status).toBe(200);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
  });
  it("a recorded refund alarm is final for that delivery: 20 replays, one Check Status, one alarm", async () => {
    dokuTxn({ status: "PAID" });
    gateway.answer(TXN_A, { transaction: { status: "REFUNDED", type: "FULL_REFUND" } });
    const n = notification({ status: "REFUNDED", type: "FULL_REFUND" });
    for (let i = 0; i < 20; i++) expect((await deliver(n)).status).toBe(200);
    expect(gateway.fetchMock).toHaveBeenCalledTimes(1);
    expect(db.alerts).toHaveLength(1);
  });
  it("a replay with an invalid signature is rejected BEFORE any lookup, even for a PROCESSED event id", async () => {
    dokuTxn();
    gateway.answer(TXN_A, {});
    await deliver(notification());
    const calls = gateway.fetchMock.mock.calls.length;
    expect((await deliver(notification({ secret: "attacker-secret-key" }))).status).toBe(401);
    expect(gateway.fetchMock.mock.calls.length).toBe(calls);
  });
});

describe("DOKU webhook — P1-A / P1-B / P1-C through the full flow", () => {
  it.each(["AUTHORIZE", "MOTO", "RECURRING", "INSTALLMENT", "SOMETHING_NEW"])("SUCCESS + type %s never activates (retry 503, marker VERIFIED_STATUS_UNKNOWN)", async (type) => {
    dokuTxn();
    gateway.answer(TXN_A, { transaction: { type } });
    const r = await deliver(notification());
    expect(r.status).toBe(503);
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
    expect(db.events[0]).toMatchObject({ status: "FAILED", error: "VERIFIED_STATUS_UNKNOWN" });
  });
  it("SUCCESS + a refund object is a refund alarm, not a payment", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { refund: { amount: "500" } });
    await deliver(notification());
    expect(db.periods).toEqual({});
    expect(db.txns[0].status).not.toBe("PAID");
    expect(db.alerts.map((a) => a.kind)).toEqual(["REFUND"]);
  });
  it("a PAID answer without currency never activates (503), is recorded as a failed delivery and retried", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { order: { currency: undefined } });
    const r = await deliver(notification());
    expect(r.status).toBe(503);
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
    expect(db.events[0]).toMatchObject({ status: "FAILED", error: "GATEWAY_VERIFICATION_FAILED" });
  });
  it("repeated unclassifiable answers stay queryable (VERIFIED_STATUS_UNKNOWN) and never close or activate", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { order: { status: ["ORDER_EXPIRED"] } });
    for (let i = 0; i < 3; i++) expect((await deliver(notification({ requestId: `notif-${i}` }))).status).toBe(503);
    expect(db.events.map((e) => e.error)).toEqual(Array(3).fill("VERIFIED_STATUS_UNKNOWN"));
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
  });
  it("pointed at the shared PRODUCTION database (or an unprovable one): 503 before anything is read, written or sent", async () => {
    dokuTxn();
    gateway.answer(TXN_A, {});
    for (const [url, refs] of [
      ["https://wjjyqovhmwenbcvbnkgx.supabase.co", "abcdefghij0123456789"],
      ["https://wjjyqovhmwenbcvbnkgx.supabase.co", "wjjyqovhmwenbcvbnkgx"],
      ["https://db.example.com", "abcdefghij0123456789"],
    ] as const) {
      publicEnvMock.supabaseUrl = url;
      serverEnvMock.payment.sandboxDbRefs = refs;
      expect((await deliver(notification())).status).toBe(503);
    }
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.events).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    expect(db.periods).toEqual({});
  });
});

describe("DOKU webhook — refund and expiry after payment", () => {
  it("a refund after PAID creates ONE alarm, leaves the paid transaction untouched and calls no activation", async () => {
    dokuTxn({ status: "PAID", provider_payment_id: "orig-req-1" });
    gateway.answer(TXN_A, { transaction: { status: "REFUNDED", type: "FULL_REFUND" } });
    const r = await deliver(notification({ status: "REFUNDED", type: "FULL_REFUND" }));
    expect(r.message).toMatch(/Refund\/chargeback recorded/);
    expect(db.txns[0].status).toBe("PAID");
    expect(db.alerts).toHaveLength(1);
    expect(db.alerts[0]).toMatchObject({ kind: "REFUND", transaction_id: TXN_A });
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["fn_record_payment_alarm"]);
    expect(db.periods).toEqual({});
  });
  it("replaying the refund notification does not duplicate the alarm", async () => {
    dokuTxn({ status: "PAID" });
    gateway.answer(TXN_A, { transaction: { status: "REFUNDED", type: "FULL_REFUND" } });
    const n = notification({ status: "REFUNDED", type: "FULL_REFUND" });
    await deliver(n);
    await deliver(n);
    await deliver(notification({ status: "REFUNDED", type: "FULL_REFUND", requestId: "notif-9" }));
    expect(db.alerts).toHaveLength(1);
  });
  it("a partial refund still marked SUCCESS is an alarm, NOT a payment", async () => {
    dokuTxn({ status: "PAID" });
    gateway.answer(TXN_A, { transaction: { status: "SUCCESS", type: "PARTIAL_REFUND", amount: 10000 } });
    await deliver(notification({ status: "SUCCESS", type: "PARTIAL_REFUND" }));
    expect(db.alerts.map((a) => a.kind)).toEqual(["REFUND"]);
    expect(db.periods).toEqual({});
  });
  it("a refund on a transaction that was never paid never activates it", async () => {
    dokuTxn();
    gateway.answer(TXN_A, { transaction: { status: "VOIDED", type: "VOID" } });
    await deliver(notification({ status: "VOIDED", type: "VOID" }));
    expect(db.periods).toEqual({});
    expect(db.txns[0].status).not.toBe("PAID");
  });
  it("EXPIRED after PAID is a REVERSAL alarm, the subscription is not revoked", async () => {
    dokuTxn({ status: "PAID" });
    gateway.answer(TXN_A, { transaction: { status: "EXPIRED" } });
    await deliver(notification({ status: "EXPIRED" }));
    expect(db.alerts.map((a) => a.kind)).toEqual(["REVERSAL"]);
    expect(db.txns[0].status).toBe("PAID");
  });
});

describe("DOKU webhook — tenant and provider isolation", () => {
  it("a notification activates only the transaction (and tenant) its signed invoice names", async () => {
    dokuTxn();
    dokuTxn({ id: TXN_B, tenant_id: TENANT_B });
    gateway.answer(TXN_A, {});
    gateway.answer(TXN_B, { transaction: { status: "PENDING" } });
    await deliver(notification({ txn: TXN_A }));
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.txns.find((t) => t.id === TXN_B)?.status).toBe("PENDING");
    expect(gateway.fetchMock).toHaveBeenCalledTimes(1);
  });
  it("another tenant's notification cannot be redirected onto a different transaction by editing the body (signature breaks)", async () => {
    dokuTxn();
    dokuTxn({ id: TXN_B, tenant_id: TENANT_B });
    gateway.answer(TXN_A, {});
    gateway.answer(TXN_B, {});
    const n = notification({ txn: TXN_A });
    const forged = n.body.replace(encodeDokuInvoiceNumber(TXN_A), encodeDokuInvoiceNumber(TXN_B));
    expect((await processPaymentWebhook(admin(), forged, null, n.request)).status).toBe(401);
    expect(db.periods).toEqual({});
  });
  it("a transaction created for another provider is refused (WRONG_PROVIDER, 400) and the gateway is not asked", async () => {
    addTxn(db, { provider: "midtrans" });
    gateway.answer(TXN_A, {});
    const r = await deliver(notification());
    expect(r.status).toBe(400);
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.periods).toEqual({});
  });
  it("an unknown transaction, or an invoice that is not one of ours, is a loud 400 with no gateway call", async () => {
    expect((await deliver(notification())).status).toBe(400); // valid code, no such row
    expect((await deliver(notification({ invoice: "INV-123123-12313", requestId: "notif-2" }))).status).toBe(400);
    expect(gateway.fetchMock).not.toHaveBeenCalled();
    expect(db.periods).toEqual({});
  });
});

describe("existing adapters are unaffected by the extended webhook contract", () => {
  it("Midtrans still verifies and activates when the new request context is supplied (the context is ignored)", async () => {
    serverEnvMock.payment.apiKey = SERVER_KEY;
    holder.provider = new MidtransPaymentProvider();
    addTxn(db);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const id = decodeURIComponent(/\/v2\/([^/]+)\/status$/.exec(String(url))?.[1] ?? "");
        const { computeMidtransSignature } = await import("@/lib/billing/providers/midtrans-payment-provider");
        const body = { status_code: "200", transaction_id: "mid-tx-1", order_id: id, gross_amount: "99000.00", currency: "IDR", transaction_status: "settlement" } as Record<string, string>;
        body.signature_key = computeMidtransSignature(id, "200", "99000.00", SERVER_KEY);
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const request = { headers: { get: () => null }, path: PATH };
    const r = await processPaymentWebhook(admin(), signedNotification(), null, request);
    expect(r.status).toBe(200);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    // and a forged Midtrans body is still rejected
    const bad = await processPaymentWebhook(admin(), signedNotification({}, "SB-Mid-server-ATTACKER"), null, request);
    expect(bad.status).toBe(401);
  });
  it("a DOKU-style header set sent to Midtrans does nothing (Midtrans signs inside the body)", async () => {
    serverEnvMock.payment.apiKey = SERVER_KEY;
    holder.provider = new MidtransPaymentProvider();
    addTxn(db);
    const n = notification();
    expect((await processPaymentWebhook(admin(), n.body, null, n.request)).status).toBe(401);
    expect(db.rpcCalls).toEqual([]);
  });
});
