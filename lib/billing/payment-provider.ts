/**
 * Vendor-neutral payment-processor contract — same shape/discipline as
 * lib/connectors/types.ts's PlatformConnector: every method that would
 * touch a real processor's API is only ever called after the caller has
 * confirmed isConfigured(); calling it unconfigured throws
 * PaymentProviderConfigError rather than simulating a checkout, a
 * subscription status, or a webhook verification. No adapter for any
 * real processor (Stripe/Midtrans/Xendit/...) exists yet — only
 * NullPaymentProvider (lib/billing/providers/null-payment-provider.ts),
 * which is what getPaymentProvider() (lib/billing/get-payment-provider.ts)
 * resolves to until one is chosen and wired in. Nothing else in the app
 * — services/billing.ts, the /billing page — depends on which adapter is
 * behind this interface.
 */

import type { SubscriptionPlan, SubscriptionStatus } from "@/types/database";

export class PaymentProviderConfigError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentProviderConfigError";
  }
}

export interface CheckoutSessionInput {
  tenantId: string;
  plan: SubscriptionPlan;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  checkoutUrl: string;
  externalSessionId: string;
}

export interface RemoteSubscriptionStatus {
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface PaymentProvider {
  /** e.g. "stripe" — also the `provider` value stored on
   * prompter_subscriptions/prompter_invoices for whichever processor
   * actually created them. "none" for the null provider. */
  readonly name: string;

  isConfigured(): boolean;

  /** Starts a real hosted checkout for a plan upgrade/downgrade. */
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;

  getSubscriptionStatus(externalSubscriptionId: string): Promise<RemoteSubscriptionStatus>;

  cancelSubscription(externalSubscriptionId: string): Promise<void>;

  /** Constant-time signature check against the processor's webhook secret. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
}
