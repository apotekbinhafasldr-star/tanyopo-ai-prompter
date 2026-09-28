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
 *   .rpc("fn_apply_verified_payment", {...})
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
      internalTransactionId: "txn_1",
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

  it("Bagian K.6/K.9/K.10 — a PAID event with the right amount/currency calls fn_apply_verified_payment exactly once with the parsed values", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: { data: [{ allowed: true, reason: null }], error: null },
    });

    const result = await processPaymentWebhook(admin, "{}", "sig");

    expect(result.ok).toBe(true);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("fn_apply_verified_payment", {
      p_transaction_id: "txn_1",
      p_provider_payment_id: "pay_1",
      p_provider_event_id: "evt_1",
      p_verified_amount: 99_000,
      p_verified_currency: "IDR",
    });
  });

  it("Payment Remediation J — a successful activation marks the webhook event row PROCESSED, not just recorded from the provider's claimed status", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: { data: [{ allowed: true, reason: null }], error: null },
    });

    await processPaymentWebhook(admin, "{}", "sig");

    expect(admin.updateCalls).toContainEqual({ status: "PROCESSED", error: null });
  });

  it("Payment Remediation K — a failed activation (RPC returns allowed=false) marks the webhook event row FAILED, never PROCESSED", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: { data: [{ allowed: false, reason: "AMOUNT_OR_CURRENCY_MISMATCH" }], error: null },
    });

    await processPaymentWebhook(admin, "{}", "sig");

    expect(admin.updateCalls).toContainEqual({ status: "FAILED", error: "AMOUNT_OR_CURRENCY_MISMATCH" });
    expect(admin.updateCalls.some((c) => c.status === "PROCESSED")).toBe(false);
  });

  it("Payment Remediation K — a transient RPC error (no result at all) marks the webhook event row FAILED, never PROCESSED", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: { data: null, error: { message: "connection reset" } },
    });

    await processPaymentWebhook(admin, "{}", "sig");

    expect(admin.updateCalls.some((c) => c.status === "FAILED")).toBe(true);
    expect(admin.updateCalls.some((c) => c.status === "PROCESSED")).toBe(false);
  });

  it("Bagian K.7 / Payment Remediation L — duplicate webhook delivery (unique-violation on the log insert) looks up the original row and still safely re-attempts activation without double-counting", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      redeliveryLookupResult: { data: { id: "row_original" } },
      rpcResult: { data: [{ allowed: true, reason: "ALREADY_PROCESSED" }], error: null },
    });

    const result = await processPaymentWebhook(admin, "{}", "sig");

    expect(result.ok).toBe(true);
    // The RPC is still called — its own idempotency (transaction already
    // PAID) is what actually prevents double-activation/double period
    // extension, not the log.
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    // The redelivery's outcome is still recorded on the original row, not
    // silently dropped.
    expect(admin.updateCalls).toContainEqual({ status: "PROCESSED", error: null });
  });

  it("Bagian K.9/K.10 — wrong amount/currency is rejected by the RPC and never treated as a hard error", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: { data: [{ allowed: false, reason: "AMOUNT_OR_CURRENCY_MISMATCH" }], error: null },
    });

    const result = await processPaymentWebhook(admin, "{}", "sig");

    expect(result.status).toBe(200);
    expect(result.message).toMatch(/MISMATCH/);
  });

  it("an unknown transaction id is a loud 400, not a silent 200", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: { data: [{ allowed: false, reason: "TRANSACTION_NOT_FOUND" }], error: null },
    });

    const result = await processPaymentWebhook(admin, "{}", "sig");

    expect(result.status).toBe(400);
  });

  it("Bagian K.13 — a transient RPC failure asks for a retry (non-2xx) rather than silently dropping the payment", async () => {
    getPaymentProviderMock.mockReturnValue(mockProvider());
    const admin = mockAdmin({
      insertResult: { data: { id: "row_1" }, error: null },
      rpcResult: { data: null, error: { message: "connection reset" } },
    });

    const result = await processPaymentWebhook(admin, "{}", "sig");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("a non-PAID event (FAILED/EXPIRED/CANCELLED) is recorded as IGNORED and never triggers activation", async () => {
    getPaymentProviderMock.mockReturnValue(
      mockProvider({
        parseWebhookEvent: vi.fn(() => ({
          externalEventId: "evt_2",
          externalPaymentId: "pay_2",
          eventType: "payment.expire",
          status: "EXPIRED",
          amount: 99_000,
          currency: "IDR",
          internalTransactionId: "txn_2",
        })),
      }),
    );
    const admin = mockAdmin({ insertResult: { data: { id: "row_2" }, error: null } });

    const result = await processPaymentWebhook(admin, "{}", "sig");

    expect(result.ok).toBe(true);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.updateCalls).toContainEqual({ status: "IGNORED", error: null });
  });
});
