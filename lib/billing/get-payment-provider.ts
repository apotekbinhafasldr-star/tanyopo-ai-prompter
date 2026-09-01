import "server-only";

import type { PaymentProvider } from "@/lib/billing/payment-provider";
import { NullPaymentProvider } from "@/lib/billing/providers/null-payment-provider";

const nullPaymentProvider = new NullPaymentProvider();

/**
 * Resolves the payment provider the same way lib/connectors/get-connector.ts
 * resolves an ad-platform connector: one place, so nothing else in the app
 * ever picks a provider itself. Only NullPaymentProvider exists today —
 * a real adapter (keyed off serverEnv.payment.providerName once a
 * processor is chosen) plugs in here later without any caller changing.
 */
export function getPaymentProvider(): PaymentProvider {
  return nullPaymentProvider;
}
