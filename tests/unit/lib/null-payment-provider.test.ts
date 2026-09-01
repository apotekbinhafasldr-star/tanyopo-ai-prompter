import { describe, expect, it } from "vitest";
import { NullPaymentProvider } from "@/lib/billing/providers/null-payment-provider";
import { PaymentProviderConfigError } from "@/lib/billing/payment-provider";

describe("NullPaymentProvider", () => {
  const provider = new NullPaymentProvider();

  it("reports itself as not configured", () => {
    expect(provider.isConfigured()).toBe(false);
    expect(provider.name).toBe("none");
  });

  it("throws PaymentProviderConfigError rather than simulating a checkout session", async () => {
    await expect(
      provider.createCheckoutSession({
        tenantId: "t1",
        plan: "PRO",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    ).rejects.toBeInstanceOf(PaymentProviderConfigError);
  });

  it("throws PaymentProviderConfigError rather than faking an active subscription status", async () => {
    await expect(provider.getSubscriptionStatus("sub_123")).rejects.toBeInstanceOf(PaymentProviderConfigError);
  });

  it("throws PaymentProviderConfigError rather than pretending to cancel something real", async () => {
    await expect(provider.cancelSubscription("sub_123")).rejects.toBeInstanceOf(PaymentProviderConfigError);
  });

  it("fails closed (false) on webhook signature verification rather than throwing or accepting", () => {
    expect(provider.verifyWebhookSignature("{}", "sig")).toBe(false);
    expect(provider.verifyWebhookSignature("{}", null)).toBe(false);
  });
});
