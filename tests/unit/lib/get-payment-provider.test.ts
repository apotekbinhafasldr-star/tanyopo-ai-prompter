import { describe, expect, it, vi, beforeEach } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    payment: { providerName: undefined as string | undefined, apiKey: undefined as string | undefined, webhookSecret: undefined },
  },
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock }));

import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { NullPaymentProvider } from "@/lib/billing/providers/null-payment-provider";
import { MidtransPaymentProvider } from "@/lib/billing/providers/midtrans-payment-provider";
import { XenditPaymentProvider } from "@/lib/billing/providers/xendit-payment-provider";

describe("getPaymentProvider — Batch B11 provider selection", () => {
  beforeEach(() => {
    serverEnvMock.payment.providerName = undefined;
    serverEnvMock.payment.apiKey = undefined;
  });

  it("resolves NullPaymentProvider when no provider is configured (unchanged B10 default)", () => {
    expect(getPaymentProvider()).toBeInstanceOf(NullPaymentProvider);
  });

  it("resolves NullPaymentProvider for an unrecognized provider name, never throwing", () => {
    serverEnvMock.payment.providerName = "some-future-provider";
    expect(getPaymentProvider()).toBeInstanceOf(NullPaymentProvider);
  });

  it("resolves XenditPaymentProvider when PAYMENT_PROVIDER_NAME=xendit", () => {
    serverEnvMock.payment.providerName = "xendit";
    expect(getPaymentProvider()).toBeInstanceOf(XenditPaymentProvider);
  });

  it("selecting xendit alone does not make it configured — that still depends on a real sandbox key", () => {
    serverEnvMock.payment.providerName = "xendit";
    const provider = getPaymentProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it("Billing B3 — resolves MidtransPaymentProvider when PAYMENT_PROVIDER_NAME=midtrans, configured only with a SANDBOX server key", () => {
    serverEnvMock.payment.providerName = "midtrans";
    const provider = getPaymentProvider();
    expect(provider).toBeInstanceOf(MidtransPaymentProvider);
    expect(provider.isConfigured()).toBe(false);
    serverEnvMock.payment.apiKey = "SB-Mid-server-abc";
    expect(provider.isConfigured()).toBe(true);
    serverEnvMock.payment.apiKey = "Mid-server-abc";
    expect(provider.isConfigured()).toBe(false);
  });
});
