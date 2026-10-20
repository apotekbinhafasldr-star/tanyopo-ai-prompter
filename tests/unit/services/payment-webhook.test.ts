import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const { getPaymentProviderMock } = vi.hoisted(() => ({ getPaymentProviderMock: vi.fn() }));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: getPaymentProviderMock }));

import { processPaymentWebhook } from "@/services/payment-webhook";

/**
 * A minimal chainable query-builder mock covering exactly the calls
 * services/payment-webhook.ts makes:
 *   .from("prompter_webhook_events").insert({...}).select("id").single()
 *   .from("prompter_webhook_events").select("id").eq(...).eq(...).maybeSingle()  (redelivery lookup)
 *   .from("prompter_webhook_events").update({...}).eq("id", ...)                 (markEvent)
 *   .rpc("fn_apply_payment_event", {...})
 *
 * Every chain method returns the same thenable builder so `await` works
 * regardless of how many .eq()/.select() calls precede the terminal one —
 * same shape real @supabase/supabase-js query builders have.
 */
function mockAdmin(opts: {
  insertResult: { data: { id: string } | null; error: { code?: string; message: string } | null };
  redeliveryLookupResult?: { data: { id: string } | null };
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const updateCalls: Array<{ status: string; error: string | null }> = [];

  function makeBuilder(resolveValue: unknown) {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = vi.fn(self);
    builder.eq = vi.fn(self);
    builder.single = vi.fn(async () => resolveValue);
    builder.maybeSingle = vi.fn(async () => resolveValue);
    builder.then = (resolve: (v: unknown) => void) => Promise.resolve(resolveValue).then(resolve);
    return builder;
  }

  const insert = vi.fn(() => makeBuilder(opts.insertResult));
  const update = vi.fn((payload: { status: string; error: string | null }) => {
    updateCalls.push({ status: payload.status, error: payload.error });
    return makeBuilder({ data: null, error: null });
  });
  const select = vi.fn(() => makeBuilder(opts.redeliveryLookupResult ?? { data: null }));
  const from = vi.fn(() => ({ insert, update, select }));
  const rpc = vi.fn(async () => opts.rpcResult ?? { data: null, error: null });

  return { from, insert, update, select, rpc, updateCalls } as unknown as SupabaseClient<Database> & {
    from: typeof from;
    insert: typeof insert;
    update: typeof update;
    rpc: typeof rpc;
    updateCalls: typeof updateCalls;
  };
}

const TXN = "22222222-2222-4222-8222-222222222222";

function mockProvider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "midtrans",
    isConfigured: vi.fn(() => true),
    createCheckoutSession: vi.fn(),
    getPaymentStatus: vi.fn(),
    cancelSubscription: vi.fn(),
    verifyWebhookSignature: vi.fn(() => true),
    parseWebhookEvent: vi.fn(() => ({
      externalEventId: "evt_1",
      externalPaymentId: "pay_1",
      eventType: "payment.settlement",
      status: "PAID",
      amount: 99_000,
      currency: "IDR",
      internalTransactionId: TXN,
    })),
    ...overrides,
  };
}

beforeEach(() => {
  getPaymentProviderMock.mockReset();
});

describe("processPaymentWebhook — Batch B10 webhook core", () => {
  it("fails closed when the provider isn't configured", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider({ isConfigured: vi.fn(() => false) }));
    const admin = mockAdmin({ insertResult: { data: { id: "row_1" }, error: null } });

    const result = await processPaymentWebhook(admin, "{}", "sig");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("Bagian I — rejects an invalid webhook signature and never calls the activation RPC", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider({ verifyWebhookSignature: vi.fn(() => false) }));
    const admin = mockAdmin({ insertResult: { data: { id: "row_1" }, error: null } });

    const result = await processPaymentWebhook(admin, "{}", "bad-sig");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a body that fails to parse as a valid event", async () => {
    getPaymentProviderMock.mockReturnValue(
      mockProvider({
        parseWebhookEvent: vi.fn(() => {
          throw new Error("bad payload");
        }),
      }),
    );
    const admin = mockAdmin({ insertResult: { data: { id: "row_1" }, error: null } });

    const result = await processPaymentWebhook(admin, "not json", "sig");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  const rpcRow = (outcome: string, reason: string | null = null) => ({
    data: [{ result_outcome: outcome, result_reason: reason }],
    error: null,
  });

  it("a PAID event calls fn_apply_payment_event exactly once with the parsed values and source WEBHOOK", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({ insertResult: { data: { id: "row_1" }, error: null }, rpcResult: rpcRow("APPLIED") });

    const result = await processPaymentWebhook(admin, "{}", "sig");

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("fn_apply_payment_event", {
      p_provider: "midtrans",
      p_transaction_id: TXN,
      p_provider_payment_id: "pay_1",
      p_provider_event_id: "evt_1",
      p_status: "PAID",
      p_amount: 99_000,
      p_currency: "IDR",
      p_source: "WEBHOOK",
    });
    expect(admin.updateCalls).toEqual([expect.objectContaining({ status: "PROCESSED", error: null })]);
  });

  it("ALREADY_APPLIED (a replay) is a 200 and PROCESSED — the gateway stops retrying", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({ insertResult: { data: { id: "row_1" }, error: null }, rpcResult: rpcRow("ALREADY_APPLIED") });
    const result = await processPaymentWebhook(admin, "{}", "sig");
    expect(result).toMatchObject({ ok: true, status: 200, message: "Already processed." });
    expect(admin.updateCalls[0]).toMatchObject({ status: "PROCESSED" });
  });

  it("F2 — an EXCEPTION (e.g. amount mismatch) answers 200 so the gateway stops retrying, records the reason on the delivery row, and activates nothing", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: rpcRow("EXCEPTION", "AMOUNT_OR_CURRENCY_MISMATCH"),
    });
    const result = await processPaymentWebhook(admin, "{}", "sig");
    expect(result.status).toBe(200);
    expect(result.message).toContain("AMOUNT_OR_CURRENCY_MISMATCH");
    expect(admin.updateCalls[0]).toMatchObject({ status: "FAILED", error: "AMOUNT_OR_CURRENCY_MISMATCH" });
  });

  it("an unknown transaction id is queued as an exception by the database (200), not lost and not retried forever", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: rpcRow("EXCEPTION", "TRANSACTION_NOT_FOUND"),
    });
    const result = await processPaymentWebhook(admin, "{}", "sig");
    expect(result.status).toBe(200);
    expect(result.message).toContain("TRANSACTION_NOT_FOUND");
  });

  it("F1 — a non-PAID event (EXPIRED/FAILED/CANCELLED) is also sent to the ledger function (observed only), marked IGNORED, and never activates", async () => {
    getPaymentProviderMock.mockReturnValue(
      mockProvider({
        parseWebhookEvent: vi.fn(() => ({
          externalEventId: "evt_2",
          externalPaymentId: "pay_1",
          eventType: "invoice.expired",
          status: "EXPIRED",
          amount: 99_000,
          currency: "IDR",
          internalTransactionId: TXN,
        })),
      }),
    );
    const admin = mockAdmin({ insertResult: { data: { id: "row_1" }, error: null }, rpcResult: rpcRow("RECORDED", "OBSERVED_EXPIRED") });
    const result = await processPaymentWebhook(admin, "{}", "sig");
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(admin.rpc).toHaveBeenCalledWith("fn_apply_payment_event", expect.objectContaining({ p_status: "EXPIRED" }));
    expect(admin.updateCalls[0]).toMatchObject({ status: "IGNORED" });
  });

  it("a transient RPC error asks the gateway to retry (500) and marks the delivery FAILED — the database transaction rolled back, so a retry is safe", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: { data: null, error: { message: "connection reset" } },
    });
    const result = await processPaymentWebhook(admin, "{}", "sig");
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(admin.updateCalls[0]).toMatchObject({ status: "FAILED", error: "connection reset" });
  });

  it("an RPC that returns nothing is treated as a transient failure (500), never as success", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({ insertResult: { data: { id: "row_1" }, error: null }, rpcResult: { data: [], error: null } });
    const result = await processPaymentWebhook(admin, "{}", "sig");
    expect(result.status).toBe(500);
    expect(admin.updateCalls[0]).toMatchObject({ status: "FAILED", error: "RPC_NO_RESULT" });
  });

  it("duplicate delivery of the same event id (unique violation on the log insert) still re-runs the idempotent function", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      redeliveryLookupResult: { data: { id: "row_existing" } },
      rpcResult: rpcRow("ALREADY_APPLIED"),
    });
    const result = await processPaymentWebhook(admin, "{}", "sig");
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.updateCalls[0]).toMatchObject({ status: "PROCESSED" });
  });

  it("a missing or non-UUID internal transaction reference is a 400 and never reaches the database function", async () => {
    for (const ref of [null, "txn_1", "not-a-uuid"]) {
      getPaymentProviderMock.mockReturnValue(
        mockProvider({
          parseWebhookEvent: vi.fn(() => ({
            externalEventId: "evt_9",
            externalPaymentId: "pay_9",
            eventType: "payment.settlement",
            status: "PAID",
            amount: 99_000,
            currency: "IDR",
            internalTransactionId: ref,
          })),
        }),
      );
      const admin = mockAdmin({ insertResult: { data: { id: "row_1" }, error: null } });
      const result = await processPaymentWebhook(admin, "{}", "sig");
      expect(result).toMatchObject({ ok: false, status: 400 });
      expect(admin.rpc).not.toHaveBeenCalled();
    }
  });

  it("failing to write the delivery log for a reason other than a duplicate asks for a retry (500) before any activation", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({ insertResult: { data: null, error: { code: "XX000", message: "boom" } } });
    const result = await processPaymentWebhook(admin, "{}", "sig");
    expect(result.status).toBe(500);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
