import { describe, expect, it, vi, beforeEach } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    payment: {
      providerName: "xendit" as string | undefined,
      apiKey: "xnd_development_abc123" as string | undefined,
      webhookSecret: "sandbox-callback-token" as string | undefined,
    },
  },
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock }));

import { XenditPaymentProvider } from "@/lib/billing/providers/xendit-payment-provider";
import { PaymentProviderConfigError } from "@/lib/billing/payment-provider";

describe("XenditPaymentProvider — Batch B11 adapter", () => {
  beforeEach(() => {
    serverEnvMock.payment.providerName = "xendit";
    serverEnvMock.payment.apiKey = "xnd_development_abc123";
    serverEnvMock.payment.webhookSecret = "sandbox-callback-token";
    vi.unstubAllGlobals();
  });

  describe("isConfigured — recognizes any valid Xendit key shape (Payment Remediation Phase 3)", () => {
    it("Poin E — reports configured with a sandbox-prefixed key ('xnd_development_...') and a webhook secret", () => {
      expect(new XenditPaymentProvider().isConfigured()).toBe(true);
    });

    it("Poin F — reports configured with a production-shaped key ('xnd_production_...') and a webhook secret, without making any real/live call — isConfigured() is a pure string check, no network access", () => {
      serverEnvMock.payment.apiKey = "xnd_production_realkey";
      expect(new XenditPaymentProvider().isConfigured()).toBe(true);
    });

    it("still refuses a key that doesn't match either recognized Xendit shape at all", () => {
      serverEnvMock.payment.apiKey = "totally-not-a-xendit-key";
      expect(new XenditPaymentProvider().isConfigured()).toBe(false);
    });

    it("refuses when no api key is set", () => {
      serverEnvMock.payment.apiKey = undefined;
      expect(new XenditPaymentProvider().isConfigured()).toBe(false);
    });

    it("refuses when no webhook secret is set, even with a well-shaped key", () => {
      serverEnvMock.payment.webhookSecret = undefined;
      expect(new XenditPaymentProvider().isConfigured()).toBe(false);
    });
  });

  describe("createCheckoutSession", () => {
    it("POSTs to Xendit's Invoice API with the server-computed amount and internal transaction id as external_id", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ id: "inv_123", invoice_url: "https://checkout.xendit.co/web/inv_123" }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await new XenditPaymentProvider().createCheckoutSession({
        tenantId: "t1",
        plan: "PRO",
        amountIDR: 399_000,
        internalTransactionId: "txn_1",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      });

      expect(result).toEqual({ checkoutUrl: "https://checkout.xendit.co/web/inv_123", externalSessionId: "inv_123" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.xendit.co/v2/invoices");
      const body = JSON.parse(init.body as string);
      expect(body.external_id).toBe("txn_1");
      expect(body.amount).toBe(399_000);
      expect(body.currency).toBe("IDR");
    });

    it("sends Basic Auth built from the sandbox key with a blank password", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ id: "inv_1", invoice_url: "https://checkout.xendit.co/web/inv_1" }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      await new XenditPaymentProvider().createCheckoutSession({
        tenantId: "t1",
        plan: "PRO",
        amountIDR: 399_000,
        internalTransactionId: "txn_1",
        successUrl: "https://a",
        cancelUrl: "https://b",
      });

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const expected = `Basic ${Buffer.from("xnd_development_abc123:").toString("base64")}`;
      expect(headers.Authorization).toBe(expected);
    });

    it("throws PaymentProviderConfigError rather than a fake checkout when unconfigured", async () => {
      serverEnvMock.payment.apiKey = undefined;

      await expect(
        new XenditPaymentProvider().createCheckoutSession({
          tenantId: "t1",
          plan: "PRO",
          amountIDR: 399_000,
          internalTransactionId: "txn_1",
          successUrl: "https://a",
          cancelUrl: "https://b",
        }),
      ).rejects.toBeInstanceOf(PaymentProviderConfigError);
    });

    it("throws when Xendit itself returns a non-2xx response, rather than returning a fake URL", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })),
      );

      await expect(
        new XenditPaymentProvider().createCheckoutSession({
          tenantId: "t1",
          plan: "PRO",
          amountIDR: 399_000,
          internalTransactionId: "txn_1",
          successUrl: "https://a",
          cancelUrl: "https://b",
        }),
      ).rejects.toBeInstanceOf(PaymentProviderConfigError);
    });
  });

  describe("getPaymentStatus", () => {
    it("maps Xendit's PAID status to the normalized RemotePaymentStatus", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({ status: "PAID" }) })),
      );

      const status = await new XenditPaymentProvider().getPaymentStatus("inv_123");
      expect(status).toBe("PAID");
    });

    it("maps an unrecognized status to FAILED rather than guessing PAID", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({ status: "SOMETHING_NEW" }) })),
      );

      const status = await new XenditPaymentProvider().getPaymentStatus("inv_123");
      expect(status).toBe("FAILED");
    });
  });

  describe("cancelSubscription", () => {
    it("throws — Invoice-mode has no provider-side subscription object to cancel", async () => {
      await expect(new XenditPaymentProvider().cancelSubscription("sub_1")).rejects.toBeInstanceOf(
        PaymentProviderConfigError,
      );
    });
  });

  describe("verifyWebhookSignature", () => {
    it("accepts the exact configured callback token", () => {
      expect(new XenditPaymentProvider().verifyWebhookSignature("{}", "sandbox-callback-token")).toBe(true);
    });

    it("rejects a wrong token", () => {
      expect(new XenditPaymentProvider().verifyWebhookSignature("{}", "wrong-token")).toBe(false);
    });

    it("rejects a missing token header", () => {
      expect(new XenditPaymentProvider().verifyWebhookSignature("{}", null)).toBe(false);
    });

    it("rejects any token when unconfigured (no webhook secret set)", () => {
      serverEnvMock.payment.webhookSecret = undefined;
      expect(new XenditPaymentProvider().verifyWebhookSignature("{}", "anything")).toBe(false);
    });

    it("does not throw on a token of a different length than the secret", () => {
      expect(() => new XenditPaymentProvider().verifyWebhookSignature("{}", "short")).not.toThrow();
      expect(new XenditPaymentProvider().verifyWebhookSignature("{}", "short")).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("normalizes a PAID invoice callback, using the invoice id as both payment id and event id", () => {
      const event = new XenditPaymentProvider().parseWebhookEvent(
        JSON.stringify({ id: "inv_123", external_id: "txn_1", status: "PAID", amount: 399_000, currency: "IDR" }),
      );

      expect(event).toEqual({
        externalEventId: "inv_123",
        externalPaymentId: "inv_123",
        eventType: "invoice.paid",
        status: "PAID",
        amount: 399_000,
        currency: "IDR",
        internalTransactionId: "txn_1",
      });
    });

    it("prefers paid_amount over amount when both are present", () => {
      const event = new XenditPaymentProvider().parseWebhookEvent(
        JSON.stringify({ id: "inv_1", external_id: "txn_1", status: "PAID", amount: 100, paid_amount: 399_000 }),
      );
      expect(event.amount).toBe(399_000);
    });

    it("returns internalTransactionId: null when external_id is absent, rather than throwing", () => {
      const event = new XenditPaymentProvider().parseWebhookEvent(
        JSON.stringify({ id: "inv_1", status: "EXPIRED" }),
      );
      expect(event.internalTransactionId).toBeNull();
      expect(event.status).toBe("EXPIRED");
    });

    it("throws PaymentProviderConfigError on invalid JSON rather than crashing the route", () => {
      expect(() => new XenditPaymentProvider().parseWebhookEvent("not json")).toThrow(PaymentProviderConfigError);
    });

    it("throws when required fields (id/status) are missing", () => {
      expect(() => new XenditPaymentProvider().parseWebhookEvent(JSON.stringify({}))).toThrow(
        PaymentProviderConfigError,
      );
    });
  });
});
