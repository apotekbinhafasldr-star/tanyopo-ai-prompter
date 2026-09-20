import "server-only";

import { serverEnv } from "@/lib/env";
import type { PaymentProvider } from "@/lib/billing/payment-provider";
import { NullPaymentProvider } from "@/lib/billing/providers/null-payment-provider";
import { XenditPaymentProvider } from "@/lib/billing/providers/xendit-payment-provider";

const nullPaymentProvider = new NullPaymentProvider();
const xenditPaymentProvider = new XenditPaymentProvider();

/**
 * Resolves the payment provider the same way lib/connectors/get-connector.ts
 * resolves an ad-platform connector: one place, so nothing else in the app
 * ever picks a provider itself. Selection is keyed off
 * serverEnv.payment.providerName; every caller (services/checkout.ts,
 * services/payment-webhook.ts) only ever asks the resolved provider
 * isConfigured() — it never knows or cares which adapter that is.
 *
 * Batch B11 — added the Xendit adapter (SANDBOX ONLY: see
 * XenditPaymentProvider's own isConfigured(), which refuses a
 * production-shaped key). Selecting "xendit" here does not by itself
 * enable anything real; XenditPaymentProvider.isConfigured() is the
 * actual gate, same as NullPaymentProvider always being unconfigured.
 */
export function getPaymentProvider(): PaymentProvider {
  if (serverEnv.payment.providerName === "xendit") {
    return xenditPaymentProvider;
  }
  return nullPaymentProvider;
}
