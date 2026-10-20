import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findPlanTier } from "@/lib/billing/plans";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import {
  callPaymentRpc,
  INTENT_KEY_PATTERN,
  type BeginCheckoutRow,
} from "@/lib/billing/payment-rpc";
import type { Database, SubscriptionPlan } from "@/types/database";

export interface StartCheckoutInput {
  tenantId: string;
  userId: string;
  plan: SubscriptionPlan;
  successUrl: string;
  cancelUrl: string;
  /** Stable per-form-render key (see plan-select-confirm). Same key = same
   * purchase attempt: a double click, a retry or 20 parallel requests all
   * resolve to ONE transaction and ONE gateway invoice. Optional: without
   * it the database still reuses an open invoice for the same purchase. */
  intentKey?: string | null;
}

export interface StartCheckoutResult {
  ok: boolean;
  checkoutUrl?: string;
  error?: string;
}

/** How long an invoice created here is offered again to the same tenant
 * before a new one may be started. Deliberately shorter than any gateway
 * invoice lifetime: a shorter window can only cause a second invoice (which
 * the activation function turns into a reviewed DUPLICATE_PAYMENT, never a
 * double extension), never a lost payment. */
export const CHECKOUT_REUSE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Checkout core. The ONLY place a checkout can be started. Never accepts an
 * amount: the price is looked up server-side from lib/billing/plans.ts.
 *
 * Billing Financial Safety — the transaction row is now created through
 * fn_begin_checkout() (service_role only): it serialises per tenant+plan,
 * reuses a still-valid invoice for the same intent, and never creates a
 * second PENDING row for the same purchase. A gateway failure releases the
 * row (fn_mark_checkout_failed) only while no invoice exists at the gateway;
 * a timeout AFTER the gateway may have created the invoice leaves the row
 * PENDING so reconciliation can still find and credit it.
 *
 * `admin` must be the service-role client. Without it checkout fails closed.
 */
export async function startCheckout(
  admin: SupabaseClient<Database> | null,
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
  if (!provider.isConfigured() || !admin) {
    return { ok: false, error: "Pembayaran online sedang dipersiapkan. Silakan coba lagi nanti." };
  }

  const intentKey = input.intentKey && INTENT_KEY_PATTERN.test(input.intentKey) ? input.intentKey : null;

  const begun = await callPaymentRpc<BeginCheckoutRow>(admin, "fn_begin_checkout", {
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_plan: input.plan,
    p_amount: tier.priceIDR,
    p_currency: "IDR",
    p_provider: provider.name,
    p_intent_key: intentKey,
  });
  const row = begun.data?.[0];
  if (begun.error || !row) {
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }

  switch (row.out_outcome) {
    case "REUSED":
      return row.out_checkout_url
        ? { ok: true, checkoutUrl: row.out_checkout_url }
        : { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
    case "IN_PROGRESS":
      return {
        ok: false,
        error: "Pembayaran Anda sedang disiapkan. Tunggu beberapa detik lalu coba lagi.",
      };
    case "INTENT_STALE":
    case "INTENT_CLOSED":
      return { ok: false, error: "Sesi pembayaran ini sudah berakhir. Muat ulang halaman lalu coba lagi." };
    case "CREATED":
      break;
    default:
      return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }

  const transactionId = row.out_transaction_id;
  if (!transactionId) {
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }

  let session;
  try {
    session = await provider.createCheckoutSession({
      tenantId: input.tenantId,
      plan: input.plan,
      amountIDR: tier.priceIDR,
      internalTransactionId: transactionId,
      successUrl: appendTxnParam(input.successUrl, transactionId),
      cancelUrl: appendTxnParam(input.cancelUrl, transactionId),
    });
  } catch {
    // The gateway may or may not have created an invoice (a timeout is not
    // a failure). The release below only succeeds while nothing is linked;
    // the database never discards a row that could still be paid.
    await callPaymentRpc(admin, "fn_mark_checkout_failed", {
      p_transaction_id: transactionId,
      p_reason: "GATEWAY_CREATE_FAILED",
    });
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }

  const linked = await callPaymentRpc<string>(admin, "fn_record_checkout_session", {
    p_transaction_id: transactionId,
    p_provider_payment_id: session.externalSessionId,
    p_checkout_url: session.checkoutUrl,
    p_checkout_expires_at: new Date(Date.now() + CHECKOUT_REUSE_WINDOW_MS).toISOString(),
  });

  // Linking failed: the invoice exists at the gateway but our row does not
  // know its id yet. Do NOT hand out the URL as "all fine" and do NOT mark
  // the row failed — the webhook still carries our transaction id (external
  // id) and reconciliation/exception queue cover the rest. Fail honestly.
  if (linked.error) {
    return { ok: false, error: "Gagal memulai proses pembayaran. Silakan coba lagi." };
  }

  return { ok: true, checkoutUrl: session.checkoutUrl };
}

/** Appends `?txn=<id>` (or `&txn=<id>`) to a caller-supplied redirect URL. */
function appendTxnParam(url: string, transactionId: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}txn=${encodeURIComponent(transactionId)}`;
}
