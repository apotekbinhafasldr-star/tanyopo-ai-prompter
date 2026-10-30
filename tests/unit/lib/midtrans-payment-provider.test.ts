// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    payment: {
      providerName: "midtrans" as string | undefined,
      apiKey: "SB-Mid-server-TESTKEY123" as string | undefined,
      webhookSecret: undefined as string | undefined,
    },
  },
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock }));

import {
  MidtransPaymentProvider,
  computeMidtransSignature,
  mapMidtransStatus,
} from "@/lib/billing/providers/midtrans-payment-provider";
import { PaymentProviderConfigError } from "@/lib/billing/payment-provider";

const KEY = "SB-Mid-server-TESTKEY123";
const ORDER = "11111111-1111-4111-8111-111111111111";

function signedNotification(overrides: Record<string, unknown> = {}, key = KEY) {
  const base = {
    order_id: ORDER,
    status_code: "200",
    gross_amount: "99000.00",
    transaction_id: "mid-tx-1",
    transaction_status: "settlement",
    currency: "IDR",
    ...overrides,
  } as Record<string, unknown>;
  base.signature_key = computeMidtransSignature(
    String(base.order_id),
    String(base.status_code),
    String(base.gross_amount),
    key,
  );
  if (overrides.signature_key !== undefined) base.signature_key = overrides.signature_key;
  return JSON.stringify(base);
}

let provider: MidtransPaymentProvider;
const fetchMock = vi.fn();

beforeEach(() => {
  serverEnvMock.payment.apiKey = KEY;
  provider = new MidtransPaymentProvider();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), init);
}

describe("MidtransPaymentProvider — Billing B3, sandbox only", () => {
  describe("isConfigured — the production-payment guard", () => {
    it("accepts a sandbox server key", () => {
      expect(provider.isConfigured()).toBe(true);
    });
    it("REFUSES a production server key", () => {
      serverEnvMock.payment.apiKey = "Mid-server-PRODUCTIONKEY";
      expect(provider.isConfigured()).toBe(false);
    });
    it("refuses a client key, a Xendit key, an empty key and no key", () => {
      for (const bad of ["SB-Mid-client-abc", "xnd_development_abc", "", undefined]) {
        serverEnvMock.payment.apiKey = bad;
        expect(provider.isConfigured()).toBe(false);
      }
    });
    it("a production key also disables checkout, signature verification and status checks (fail closed everywhere)", async () => {
      const body = signedNotification();
      serverEnvMock.payment.apiKey = "Mid-server-PRODUCTIONKEY";
      expect(provider.verifyWebhookSignature(body, null)).toBe(false);
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      await expect(
        provider.createCheckoutSession({
          tenantId: "t",
          plan: "PRO",
          amountIDR: 99000,
          internalTransactionId: ORDER,
          successUrl: "https://x/ok",
          cancelUrl: "https://x/no",
        }),
      ).rejects.toBeInstanceOf(PaymentProviderConfigError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("verifyWebhookSignature — SHA512(order_id + status_code + gross_amount + ServerKey)", () => {
    it("accepts a correctly signed notification", () => {
      expect(provider.verifyWebhookSignature(signedNotification(), null)).toBe(true);
    });
    it("accepts the signature in upper-case hex", () => {
      const parsed = JSON.parse(signedNotification());
      parsed.signature_key = String(parsed.signature_key).toUpperCase();
      expect(provider.verifyWebhookSignature(JSON.stringify(parsed), null)).toBe(true);
    });
    it("rejects a signature made with a different key", () => {
      expect(provider.verifyWebhookSignature(signedNotification({}, "SB-Mid-server-OTHER"), null)).toBe(false);
    });
    it("rejects tampering with any SIGNED field (order_id, status_code, gross_amount)", () => {
      for (const field of [
        { order_id: "22222222-2222-4222-8222-222222222222" },
        { status_code: "201" },
        { gross_amount: "1.00" },
      ]) {
        const parsed = JSON.parse(signedNotification());
        Object.assign(parsed, field);
        expect(provider.verifyWebhookSignature(JSON.stringify(parsed), null)).toBe(false);
      }
    });
    it("DOES verify when only transaction_status is changed — the signature does not cover it (this is why Get Status is mandatory)", () => {
      const parsed = JSON.parse(signedNotification({ status_code: "200", transaction_status: "cancel" }));
      parsed.transaction_status = "settlement";
      expect(provider.verifyWebhookSignature(JSON.stringify(parsed), null)).toBe(true);
    });
    it("rejects malformed signatures without throwing (wrong length, non-hex, empty, non-string)", () => {
      for (const bad of ["", "abc", "z".repeat(128), "a".repeat(127), "a".repeat(129), 123, null]) {
        expect(provider.verifyWebhookSignature(signedNotification({ signature_key: bad }), null)).toBe(false);
      }
    });
    it("rejects non-JSON, non-objects and missing/typed-wrong fields without throwing", () => {
      expect(provider.verifyWebhookSignature("not json", null)).toBe(false);
      expect(provider.verifyWebhookSignature("[]", null)).toBe(false);
      expect(provider.verifyWebhookSignature("null", null)).toBe(false);
      expect(provider.verifyWebhookSignature("{}", null)).toBe(false);
      // gross_amount as a JSON number can never match the exact string Midtrans signed
      expect(provider.verifyWebhookSignature(signedNotification({ gross_amount: 99000 }), null)).toBe(false);
    });
    it("ignores the x-callback-token header entirely (a forged header cannot stand in for the signature)", () => {
      const unsigned = JSON.stringify({ order_id: ORDER, status_code: "200", gross_amount: "99000.00" });
      expect(provider.verifyWebhookSignature(unsigned, serverEnvMock.payment.apiKey ?? "")).toBe(false);
    });
  });

  describe("parseWebhookEvent — everything returned is an untrusted claim", () => {
    it("normalizes a settlement notification; the event id is payment + state, so a redelivery maps to the same row", () => {
      const event = provider.parseWebhookEvent(signedNotification());
      expect(event).toMatchObject({
        externalEventId: "mid-tx-1:settlement:200:-",
        externalPaymentId: "mid-tx-1",
        eventType: "midtrans.settlement",
        status: "PAID",
        amount: 99000,
        currency: "IDR",
        internalTransactionId: ORDER,
      });
      expect(provider.parseWebhookEvent(signedNotification()).externalEventId).toBe(event.externalEventId);
    });
    it("different states of the same payment get different event ids", () => {
      const a = provider.parseWebhookEvent(signedNotification({ transaction_status: "settlement" }));
      const b = provider.parseWebhookEvent(signedNotification({ transaction_status: "refund" }));
      expect(a.externalEventId).not.toBe(b.externalEventId);
    });
    it("a refund / chargeback notification is never reported as PAID", () => {
      for (const s of ["refund", "partial_refund", "chargeback", "partial_chargeback"]) {
        expect(provider.parseWebhookEvent(signedNotification({ transaction_status: s })).status).not.toBe("PAID");
      }
    });
    it("throws (never crashes the route) on bad JSON, missing fields, or an invalid amount", () => {
      expect(() => provider.parseWebhookEvent("nope")).toThrow(PaymentProviderConfigError);
      expect(() => provider.parseWebhookEvent("[]")).toThrow(PaymentProviderConfigError);
      expect(() => provider.parseWebhookEvent(JSON.stringify({ order_id: ORDER }))).toThrow(PaymentProviderConfigError);
      for (const amount of ["1e5", "-5", "abc", "", "1.234", "Infinity"]) {
        expect(() => provider.parseWebhookEvent(signedNotification({ gross_amount: amount }))).toThrow(
          PaymentProviderConfigError,
        );
      }
    });
  });

  describe("mapMidtransStatus — only settlement, or capture with fraud accept, is PAID", () => {
    it.each([
      ["settlement", undefined, "200", "PAID"],
      ["settlement", "accept", "200", "PAID"],
      ["capture", "accept", "200", "PAID"],
      ["capture", "challenge", "201", "PENDING"],
      ["capture", "deny", "202", "FAILED"],
      ["capture", undefined, "200", "UNKNOWN"],
      ["settlement", "challenge", "200", "UNKNOWN"],
      ["settlement", "deny", "200", "UNKNOWN"],
      ["settlement", "accept", "201", "UNKNOWN"],
      ["settlement", undefined, "407", "UNKNOWN"],
      ["pending", undefined, "201", "PENDING"],
      ["authorize", undefined, "200", "PENDING"],
      ["deny", undefined, "202", "FAILED"],
      ["failure", undefined, "202", "FAILED"],
      ["cancel", undefined, "200", "CANCELLED"],
      ["expire", undefined, "407", "EXPIRED"],
      ["refund", undefined, "200", "REFUNDED"],
      ["partial_refund", undefined, "200", "REFUNDED"],
      ["chargeback", undefined, "200", "CHARGEBACK"],
      ["partial_chargeback", undefined, "200", "CHARGEBACK"],
      ["something_new", undefined, "200", "UNKNOWN"],
      [undefined, undefined, undefined, "UNKNOWN"],
    ])("%s / fraud=%s / code=%s → %s", (status, fraud, code, expected) => {
      expect(mapMidtransStatus(status, fraud, code)).toBe(expected);
    });
  });

  describe("createCheckoutSession", () => {
    const input = {
      tenantId: "tenant-1",
      plan: "PRO" as const,
      amountIDR: 99000,
      internalTransactionId: ORDER,
      successUrl: "https://app.example/billing?checkout=success&txn=x",
      cancelUrl: "https://app.example/billing?checkout=cancelled&txn=x",
    };

    it("POSTs to the SANDBOX Snap host with the server amount, the internal id as order_id, and Basic auth", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ token: "snap-token", redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/abc" }));
      const result = await provider.createCheckoutSession(input);

      expect(result).toEqual({
        checkoutUrl: "https://app.sandbox.midtrans.com/snap/v4/redirection/abc",
        externalSessionId: "snap-token",
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://app.sandbox.midtrans.com/snap/v1/transactions");
      expect(String(url)).not.toMatch(/^https:\/\/app\.midtrans\.com/);
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);
      const body = JSON.parse(init.body);
      expect(body.transaction_details).toEqual({ order_id: ORDER, gross_amount: 99000 });
      expect(body.callbacks.finish).toBe(input.successUrl);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.body).not.toContain(KEY);
    });
    it("rejects a non-https payment link, an incomplete answer and a non-2xx answer (no fake checkout)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ token: "t", redirect_url: "http://insecure.example/pay" }));
      await expect(provider.createCheckoutSession(input)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse({ token: "t" }));
      await expect(provider.createCheckoutSession(input)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse({ error_messages: ["no"] }, { status: 401 }));
      await expect(provider.createCheckoutSession(input)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    });
    it("rejects an order id that is not our UUID and a non-positive / fractional amount without calling Midtrans", async () => {
      await expect(provider.createCheckoutSession({ ...input, internalTransactionId: "../etc" })).rejects.toBeInstanceOf(PaymentProviderConfigError);
      await expect(provider.createCheckoutSession({ ...input, amountIDR: 0 })).rejects.toBeInstanceOf(PaymentProviderConfigError);
      await expect(provider.createCheckoutSession({ ...input, amountIDR: 10.5 })).rejects.toBeInstanceOf(PaymentProviderConfigError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("turns a network failure / timeout into a PaymentProviderConfigError", async () => {
      fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
      await expect(provider.createCheckoutSession(input)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    });
  });

  describe("getVerifiedPayment — the server asks Midtrans (Get Status)", () => {
    const answer = (over: Record<string, unknown> = {}, signKey = KEY) => {
      const base: Record<string, unknown> = {
        status_code: "200",
        transaction_id: "mid-tx-1",
        order_id: ORDER,
        gross_amount: "99000.00",
        currency: "IDR",
        transaction_status: "settlement",
        ...over,
      };
      base.signature_key = computeMidtransSignature(String(base.order_id), String(base.status_code), String(base.gross_amount), signKey);
      return base;
    };

    it("reads the SANDBOX status host with Basic auth, a timeout, and returns the gateway's own values", async () => {
      fetchMock.mockResolvedValue(jsonResponse(answer()));
      const verified = await provider.getVerifiedPayment(ORDER);

      expect(verified).toMatchObject({
        orderId: ORDER,
        gatewayTransactionId: "mid-tx-1",
        status: "PAID",
        amount: 99000,
        currency: "IDR",
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://api.sandbox.midtrans.com/v2/${ORDER}/status`);
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
    it("capture + accept is PAID; capture + challenge and pending are NOT", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(answer({ transaction_status: "capture", fraud_status: "accept" })));
      expect((await provider.getVerifiedPayment(ORDER)).status).toBe("PAID");
      fetchMock.mockResolvedValueOnce(jsonResponse(answer({ transaction_status: "capture", fraud_status: "challenge", status_code: "201" })));
      expect((await provider.getVerifiedPayment(ORDER)).status).toBe("PENDING");
      fetchMock.mockResolvedValueOnce(jsonResponse(answer({ transaction_status: "pending", status_code: "201" })));
      expect((await provider.getVerifiedPayment(ORDER)).status).toBe("PENDING");
    });
    it("refund, chargeback, cancel, expire, deny are reported as such (never PAID)", async () => {
      const cases: Array<[string, string]> = [
        ["refund", "REFUNDED"], ["chargeback", "CHARGEBACK"], ["cancel", "CANCELLED"], ["expire", "EXPIRED"], ["deny", "FAILED"],
      ];
      for (const [raw, expected] of cases) {
        fetchMock.mockResolvedValueOnce(jsonResponse(answer({ transaction_status: raw })));
        expect((await provider.getVerifiedPayment(ORDER)).status).toBe(expected);
      }
    });
    it("fails closed on timeout, network error, non-2xx, non-JSON, non-object and oversized answers", async () => {
      fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 500 }));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse("<html>oops</html>"));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse("[]"));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse(JSON.stringify({ pad: "x".repeat(70_000) })));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    });
    it("fails closed on an unknown-order answer (HTTP 200 with body status_code 404), missing currency or missing fields", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status_code: "404", status_message: "Transaction doesn't exist." }));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse(answer({ currency: undefined })));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse(answer({ gross_amount: undefined })));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    });
    it("fails closed when the answer is about a DIFFERENT order, has an invalid amount, or a bad signature", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(answer({ order_id: "22222222-2222-4222-8222-222222222222" })));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse(answer({ gross_amount: "abc" })));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      fetchMock.mockResolvedValueOnce(jsonResponse(answer({}, "SB-Mid-server-OTHER")));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    });
    it("never lets a hostile order id reach the URL path", async () => {
      for (const bad of ["../../v1/payouts", ORDER + "/../x", "", "abc", `${ORDER}?x=1`]) {
        await expect(provider.getVerifiedPayment(bad)).rejects.toBeInstanceOf(PaymentProviderConfigError);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("the secret key never appears in an error message", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { status: 401 }));
      const err = await provider.getVerifiedPayment(ORDER).catch((e: Error) => e);
      expect((err as Error).message).not.toContain(KEY);
    });
  });

  describe("getPaymentStatus (coarse view, never used to activate)", () => {
    it("maps refund / chargeback / unknown to FAILED, never PAID", async () => {
      for (const raw of ["refund", "chargeback", "weird"]) {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ status_code: "200", order_id: ORDER, gross_amount: "99000.00", currency: "IDR", transaction_status: raw, transaction_id: "x" }),
        );
        expect(await provider.getPaymentStatus(ORDER)).toBe("FAILED");
      }
    });
  });

  it("cancelSubscription throws — Snap one-off payments have no provider-side subscription", async () => {
    await expect(provider.cancelSubscription("x")).rejects.toBeInstanceOf(PaymentProviderConfigError);
  });
});
