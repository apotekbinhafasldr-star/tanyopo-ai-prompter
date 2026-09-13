import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findPlanTier } from "@/lib/billing/plans";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import type { Database, SubscriptionPlan } from "@/types/database";

export interface StartCheckoutInput {
  tenantId: string;
  userId: string;
  plan: SubscriptionPlan;
  successUrl: string;
  cancelUrl: string;
}

export interface StartCheckoutResult {
  ok: boolean;
  checkoutUrl?: string;
  error?: string;
}

/**
 * Batch B10 — checkout core (Bagian G of the brief). The one and only
 * place a checkout can be started. Deliberately does NOT accept an
 * `amount` parameter at all — the price is always looked up server-side
 * from lib/billing/plans.ts's PLAN_TIERS (the same canonical numbers B9's
 * prompter_plan_entitlements mirrors), so there is no client-supplied
 * number anywhere in this path to tamper with.
 *
 * Never activates anything itself — a prompter_payment_transactions row
 * is created PENDING, and only fn_apply_verified_payment() (called from
 * the webhook route after a verified payment) can ever move a
 * subscription to ACTIVE. If the configured PaymentProvider isn't ready
 * (NullPaymentProvider today, always), this fails closed with an honest
 * "not available yet" error and creates no transaction row at all.
 */
export async function startCheckout(
  supabase: SupabaseClient<Database>,
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  const tier = findPlanTier(input.plan);
  if (!tier || tier.availability !== "ACTIVE") {
    return { ok: false, error: "Paket ini belum dapat dibeli saat ini." };
  }

  if (tier.priceIDR <= 0) {
    return { ok: false, error: "Paket ini tidak memerlukan pembayaran." };
  }

  const provider = getPaymentProvider();
  if (!provider.isConfigured()) {
    return { ok: false, error: "Pembayaran online sedang dipersiapkan. Silakan coba lagi nanti." };
  }

  const { data: txn, error: insertError } = await supabase
    .from("prompter_payment_transactions")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      provider: provider.name,
      plan: input.plan,
      amount: tier.priceIDR,
      currency: "IDR",
    })
    .select("id")
    .single();

  if (insertError || !txn) {
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }

  try {
    const session = await provider.createCheckoutSession({
      tenantId: input.tenantId,
      plan: input.plan,
      amountIDR: tier.priceIDR,
      internalTransactionId: txn.id,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
    return { ok: true, checkoutUrl: session.checkoutUrl };
  } catch {
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }
}
