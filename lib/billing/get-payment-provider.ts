import "server-only";

import { serverEnv } from "@/lib/env";
import type { PaymentProvider } from "@/lib/billing/payment-provider";
import { NullPaymentProvider } from "@/lib/billing/providers/null-payment-provider";
import { MidtransPaymentProvider } from "@/lib/billing/providers/midtrans-payment-provider";
import { XenditPaymentProvider } from "@/lib/billing/providers/xendit-payment-provider";

const nullPaymentProvider = new NullPaymentProvider();
const xenditPaymentProvider = new XenditPaymentProvider();
const midtransPaymentProvider = new MidtransPaymentProvider();

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
  // Billing B3: Midtrans, SANDBOX ONLY (see MidtransPaymentProvider.isConfigured(): a production-shaped key makes it
  // report itself unconfigured, so every caller fails closed exactly as with no provider at all).
  if (serverEnv.payment.providerName === "midtrans") {
    return midtransPaymentProvider;
  }
  if (serverEnv.payment.providerName === "xendit") {
    return xenditPaymentProvider;
  }
  return nullPaymentProvider;
}
