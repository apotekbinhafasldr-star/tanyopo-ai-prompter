/**
 * Vendor-neutral payment-processor contract — same shape/discipline as
 * lib/connectors/types.ts's PlatformConnector: every method that would
 * touch a real processor's API is only ever called after the caller has
 * confirmed isConfigured(); calling it unconfigured throws
 * PaymentProviderConfigError rather than simulating a checkout, a
 * payment status, or a webhook verification. No adapter for any real
 * processor (Stripe/Midtrans/Xendit/...) exists yet — only
 * NullPaymentProvider (lib/billing/providers/null-payment-provider.ts),
 * which is what getPaymentProvider() (lib/billing/get-payment-provider.ts)
 * resolves to until one is chosen and wired in. Nothing else in the app
 * — services/checkout.ts, the payment webhook route, the /billing page —
 * depends on which adapter is behind this interface.
 *
 * Batch B10 — extended with parseWebhookEvent()/getPaymentStatus() for
 * the webhook core (services/payment-webhook.ts). The contract is
 * deliberately still provider-agnostic: a real adapter's
 * parseWebhookEvent() is where that provider's specific payload shape
 * gets normalized into ParsedWebhookEvent, so nothing downstream (the
 * webhook route, fn_apply_verified_payment()) ever branches on which
 * provider is configured.
 */

import type { SubscriptionPlan } from "@/types/database";

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
  /** Server-computed canonical price (lib/billing/plans.ts) — the
   * provider adapter passes this to the processor's API as-is; it must
   * never originate from client input. */
  amountIDR: number;
  /** The internal prompter_payment_transactions.id this checkout is
   * for — passed through to the processor (as a client reference /
   * external ID / metadata field, whatever that provider calls it) so
   * the webhook can look the transaction back up without trusting the
   * webhook payload's own plan/amount fields alone. */
  internalTransactionId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  checkoutUrl: string;
  externalSessionId: string;
}

/** A single payment attempt's status as the processor currently reports
 * it (via direct API polling — getPaymentStatus() — not a webhook). */
export type RemotePaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";

/** Normalized shape every real adapter's parseWebhookEvent() must
 * produce, regardless of that provider's own payload format. The
 * webhook route (services/payment-webhook.ts) only ever reads this
 * shape — it never inspects a raw provider payload directly. */
export interface ParsedWebhookEvent {
  /** Provider's own unique event/notification id — the idempotency key
   * recorded in prompter_webhook_events (source_system = provider.name). */
  externalEventId: string;
  /** Provider's own unique payment/order id. */
  externalPaymentId: string;
  /** e.g. "payment.settlement", "charge.succeeded" — provider-specific,
   * stored as-is for observability, never branched on outside the adapter. */
  eventType: string;
  status: RemotePaymentStatus;
  amount: number;
  currency: string;
  /** The internalTransactionId this checkout session was created with,
   * when the provider echoes a client reference/metadata field back —
   * null if this provider doesn't support one or didn't include it. */
  internalTransactionId: string | null;
}

export interface PaymentProvider {
  /** e.g. "midtrans"/"xendit" — also the `provider` value stored on
   * prompter_subscriptions/prompter_invoices/prompter_payment_transactions
   * for whichever processor actually created them. "none" for the null
   * provider. */
  readonly name: string;

  isConfigured(): boolean;

  /** Starts a real hosted checkout for a plan purchase/upgrade. */
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;

  /** Polls the processor directly for one payment's current status —
   * for a return-URL "checking your payment..." screen or manual
   * reconciliation. Never the primary activation path; that's always
   * the webhook. */
  getPaymentStatus(externalPaymentId: string): Promise<RemotePaymentStatus>;

  cancelSubscription(externalSubscriptionId: string): Promise<void>;

  /** Constant-time signature check against the processor's webhook
   * secret, over the raw (unparsed) request body. Must be called, and
   * must return true, before parseWebhookEvent() or any webhook payload
   * field is trusted for anything. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;

  /** Normalizes a verified webhook's raw body into ParsedWebhookEvent.
   * Only ever called after verifyWebhookSignature() has returned true —
   * an adapter may assume the body it receives here is authentic. */
  parseWebhookEvent(rawBody: string): ParsedWebhookEvent;
}
