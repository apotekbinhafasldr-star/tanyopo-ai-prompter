import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import type { Database } from "@/types/database";

export type ReconciledPaymentStatus = "PAID" | "PENDING" | "FAILED" | "EXPIRED" | "CANCELLED" | "NOT_FOUND";

export interface ReconciliationResult {
  status: ReconciledPaymentStatus;
  plan: string | null;
}

/**
 * Payment Remediation — authoritative status check for a return trip from
 * checkout (`/billing?txn=<id>`). The browser's own "success"/"cancelled"
 * query param is never trusted for anything (see services/checkout.ts and
 * fn_apply_verified_payment()'s own comments) — this reads the real
 * prompter_payment_transactions row instead, tenant-scoped by RLS via the
 * caller's normal session client, so a tenant can only ever reconcile its
 * own transaction (never another tenant's, even by guessing an id).
 *
 * The webhook (services/payment-webhook.ts -> fn_apply_verified_payment())
 * remains the ONLY path that ever activates a subscription. When the row
 * is still PENDING (the common race: the browser returns before the
 * provider's webhook arrives — production evidence shows this usually
 * resolves within roughly a minute), this does one best-effort direct
 * poll of the provider (getPaymentStatus()) purely to give the UI an
 * honest "still processing" vs. "provider already confirmed, waiting for
 * our system" distinction. That poll's result is never written back to
 * the database and never activates anything by itself — only the webhook
 * does that.
 */
export async function reconcileCheckoutReturn(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  transactionId: string,
): Promise<ReconciliationResult> {
  const { data: txn } = await supabase
    .from("prompter_payment_transactions")
    .select("status, plan, provider_payment_id")
    .eq("id", transactionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!txn) {
    return { status: "NOT_FOUND", plan: null };
  }

  if (txn.status !== "PENDING") {
    return { status: txn.status as ReconciledPaymentStatus, plan: txn.plan };
  }

  // Still PENDING locally — try one direct provider check for display
  // purposes only, so a slow webhook doesn't show as an outright failure.
  if (txn.provider_payment_id) {
    const provider = getPaymentProvider();
    if (provider.isConfigured()) {
      try {
        const remoteStatus = await provider.getPaymentStatus(txn.provider_payment_id);
        if (remoteStatus === "PAID") {
          // Provider confirms paid, but our own webhook hasn't landed
          // yet — report PENDING (accurately: not yet activated here),
          // never PAID, since only fn_apply_verified_payment() may ever
          // grant that.
          return { status: "PENDING", plan: txn.plan };
        }
      } catch {
        // Provider unreachable/errored — fall through to the local
        // PENDING status; never treat a poll failure as a payment
        // failure.
      }
    }
  }

  return { status: "PENDING", plan: txn.plan };
}
