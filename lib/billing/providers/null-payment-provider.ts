import {
  PaymentProviderConfigError,
  type CheckoutSessionInput,
  type CheckoutSessionResult,
  type PaymentProvider,
  type RemoteSubscriptionStatus,
} from "@/lib/billing/payment-provider";

/**
 * The default PaymentProvider when no real processor is configured
 * (today: always, since PAYMENT_PROVIDER_NAME is unset in every
 * environment this app has run in). Every method throws
 * PaymentProviderConfigError — never a simulated checkout URL, a faked
 * "active" subscription, or a webhook signature that verifies against
 * nothing. verifyWebhookSignature() returns false rather than throwing,
 * matching how a route handler checks it (a boolean gate, not a
 * try/catch), so an unconfigured payment webhook route fails closed
 * instead of 500ing.
 */
export class NullPaymentProvider implements PaymentProvider {
  readonly name = "none";

  isConfigured(): boolean {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept typed/named so callers (and tests) get real arity checking against the PaymentProvider interface; this implementation just never reaches for any of it.
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    throw new PaymentProviderConfigError(this.name, "Belum ada payment provider yang dikonfigurasi.");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getSubscriptionStatus(externalSubscriptionId: string): Promise<RemoteSubscriptionStatus> {
    throw new PaymentProviderConfigError(this.name, "Belum ada payment provider yang dikonfigurasi.");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    throw new PaymentProviderConfigError(this.name, "Belum ada payment provider yang dikonfigurasi.");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
    return false;
  }
}
