import "server-only";

import { findPlanTier } from "@/lib/billing/plans";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/types/database";

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

const RPC_ERRORS: Record<string, string> = {
  NOT_OWNER: "Hanya Owner yang dapat memulai pembayaran.",
  NOT_MEMBER: "Hanya Owner yang dapat memulai pembayaran.",
  PLAN_NOT_PURCHASABLE: "Paket ini belum dapat dibeli saat ini.",
  PLAN_NOT_AVAILABLE: "Paket ini belum dapat dibeli saat ini.",
  NO_SUBSCRIPTION: "Langganan belum siap. Silakan muat ulang halaman lalu coba lagi.",
  TOO_MANY_PENDING: "Terlalu banyak percobaan pembayaran yang belum selesai. Silakan coba lagi nanti.",
  PLAN_CHANGE_NOT_ALLOWED:
    "Paket Anda masih aktif. Pergantian paket dapat dilakukan setelah periode berbayar berakhir. Anda tetap dapat memperpanjang paket yang sama.",
};

/** Billing B2: only an https URL previously stored by this module on the transaction may be reused. */
function readStoredCheckoutUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const url = (metadata as Record<string, unknown>).checkout_url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

/**
 * Billing B1 — checkout core. The one and only place a checkout can be started, and it can no longer be
 * influenced from the browser at all:
 *
 *  - The PENDING transaction is created by the database function `fn_begin_checkout`, called with the
 *    service-role client. That function has NO amount / currency parameter: price and currency come from
 *    `prompter_plan_prices`, it re-verifies in SQL that the user is an Owner of the tenant, and the plan must
 *    be ACTIVE. A signed-in Owner can no longer INSERT a transaction directly (the client INSERT policy and
 *    privilege were removed; a trigger rejects wrong amounts for every role).
 *  - `lib/billing/plans.ts` is only a UX pre-check and a drift alarm: if the database price differs from the
 *    catalog the checkout fails closed instead of charging a number nobody agreed on.
 *  - Nothing is activated here. Only fn_apply_verified_payment() (webhook path, service_role) can move a
 *    subscription to ACTIVE. If the configured PaymentProvider isn't ready this fails closed and creates no
 *    transaction at all.
 *
 * `tenantId` / `userId` MUST come from the verified session (requireSessionContext), never from request input.
 */
export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
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

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Pembayaran online sedang dipersiapkan. Silakan coba lagi nanti." };
  }

  const { data: rows, error: rpcError } = await admin.rpc("fn_begin_checkout", {
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_plan: input.plan,
    p_provider: provider.name,
  });
  const row = Array.isArray(rows) ? rows[0] : rows;

  if (rpcError || !row) {
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }
  if (row.out_outcome === "EXISTING" && row.out_transaction_id) {
    // Billing B2: one open invoice per tenant. An identical request within 30 minutes gets the SAME invoice back; reuse
    // its stored payment link instead of opening a second invoice (a double click can no longer create two charges).
    const { data: existing } = await admin
      .from("prompter_payment_transactions")
      .select("status, metadata")
      .eq("id", row.out_transaction_id)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    const storedUrl = existing?.status === "PENDING" ? readStoredCheckoutUrl(existing.metadata) : null;
    if (storedUrl) return { ok: true, checkoutUrl: storedUrl };
    return { ok: false, error: "Pembayaran sebelumnya masih disiapkan. Tunggu sebentar lalu coba lagi." };
  }
  if (row.out_outcome !== "CREATED" || !row.out_transaction_id) {
    return { ok: false, error: RPC_ERRORS[row.out_outcome] ?? "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }

  const txnId = row.out_transaction_id;
  const amountIDR = Number(row.out_amount);

  // Drift alarm: the database catalog is authoritative, the code catalog must agree. Never charge on a mismatch.
  if (row.out_currency !== "IDR" || !Number.isFinite(amountIDR) || amountIDR !== tier.priceIDR) {
    await admin
      .from("prompter_payment_transactions")
      .update({ status: "FAILED", failure_reason: "PRICE_CATALOG_MISMATCH" })
      .eq("id", txnId)
      .eq("status", "PENDING");
    return { ok: false, error: "Harga paket sedang diperbarui. Silakan coba lagi nanti." };
  }

  try {
    const session = await provider.createCheckoutSession({
      tenantId: input.tenantId,
      plan: input.plan,
      amountIDR,
      internalTransactionId: txnId,
      // Carries txn.id through so the return trip can reconcile against the real, authoritative transaction row
      // instead of a bare "success"/"cancelled" query param.
      successUrl: appendTxnParam(input.successUrl, txnId),
      cancelUrl: appendTxnParam(input.cancelUrl, txnId),
    });

    // Record the provider's own checkout/session id on the transaction immediately (lets a return-trip
    // reconciliation poll the provider while a webhook is in flight). Service role only: no client role may
    // write this table. Best-effort — the webhook remains the sole path that ever activates anything.
    await admin
      .from("prompter_payment_transactions")
      .update({ provider_payment_id: session.externalSessionId, metadata: { checkout_url: session.checkoutUrl } })
      .eq("id", txnId)
      .eq("status", "PENDING");

    return { ok: true, checkoutUrl: session.checkoutUrl };
  } catch {
    // Billing B2: close the invoice that never got a payment link, so the next attempt creates a fresh one instead of
    // being handed a link-less "existing" invoice. If the gateway did create something and is paid later, the webhook
    // records it as REVIEW (never lost, never auto-activated).
    await admin
      .from("prompter_payment_transactions")
      .update({ status: "FAILED", failure_reason: "PROVIDER_SESSION_FAILED" })
      .eq("id", txnId)
      .eq("status", "PENDING");
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }
}

/** Appends `?txn=<id>` (or `&txn=<id>`) to a caller-supplied redirect URL. */
function appendTxnParam(url: string, transactionId: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}txn=${encodeURIComponent(transactionId)}`;
}
