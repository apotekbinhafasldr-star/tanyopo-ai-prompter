import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findPlanTier } from "@/lib/billing/plans";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { createAdminClient } from "@/lib/supabase/admin";
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
      // Payment Remediation — carries txn.id through so the return trip
      // can reconcile against the real, authoritative transaction row
      // instead of a bare "success"/"cancelled" query param.
      successUrl: appendTxnParam(input.successUrl, txn.id),
      cancelUrl: appendTxnParam(input.cancelUrl, txn.id),
    });

    // Payment Remediation — record the provider's own checkout/session id
    // on the transaction immediately, not only once the webhook arrives.
    // This is what lets a return-trip reconciliation poll the provider
    // directly (getPaymentStatus()) while a webhook is still in flight,
    // without waiting on it. Uses the admin client because the
    // tenant-scoped client has no UPDATE policy on this table by design
    // (see the B10 migration) — only service_role may ever mutate a
    // payment_transactions row. Best-effort: if the admin client isn't
    // configured, or this update fails, the checkout itself still
    // succeeds — the only thing lost is the early polling hint, and the
    // webhook remains the sole path that ever activates anything.
    const admin = createAdminClient();
    if (admin) {
      await admin
        .from("prompter_payment_transactions")
        .update({ provider_payment_id: session.externalSessionId })
        .eq("id", txn.id)
        .eq("status", "PENDING");
    }

    return { ok: true, checkoutUrl: session.checkoutUrl };
  } catch {
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }
}

/** Appends `?txn=<id>` (or `&txn=<id>`) to a caller-supplied redirect URL. */
function appendTxnParam(url: string, transactionId: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}txn=${encodeURIComponent(transactionId)}`;
}
