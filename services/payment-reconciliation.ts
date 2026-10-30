import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { canVerifyServerSide, verifyAndSettle } from "@/services/payment-verification";
import type { Database } from "@/types/database";

export type ReconciledPaymentStatus = "PAID" | "PENDING" | "FAILED" | "EXPIRED" | "CANCELLED" | "REVIEW" | "NOT_FOUND";

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
 * Billing B3: for a server-verifiable provider (Midtrans) this function ALSO settles the payment, but only from the
 * gateway's own Get Status answer through verifyAndSettle() — the same guarded path as the webhook, never from the
 * redirect. For other providers the paragraph below still applies exactly.
 *
 * The webhook (services/payment-webhook.ts -> fn_apply_verified_payment())
 * is otherwise the ONLY path that ever activates a subscription. When the row
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

  const provider = getPaymentProvider();

  // Billing B3 — verified return trip. For a provider that can be asked server-to-server, the SERVER asks the gateway
  // (never the browser's redirect parameters) and settles through the same guarded path as the webhook, so a lost or
  // late webhook cannot strand a customer who really paid. Ownership was proven above: the row was read with the
  // caller's own tenant-scoped session. Throttled per transaction so the page cannot be used to hammer the gateway.
  if (provider.isConfigured() && canVerifyServerSide(provider)) {
    if (checkRateLimit(`payment-return:${transactionId}`, 6, 60_000).allowed) {
      const admin = createAdminClient();
      if (admin) {
        await verifyAndSettle(admin, provider, transactionId, { eventId: null });
        const { data: after } = await supabase
          .from("prompter_payment_transactions")
          .select("status, plan")
          .eq("id", transactionId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (after) {
          return { status: after.status as ReconciledPaymentStatus, plan: after.plan };
        }
      }
    }
    return { status: "PENDING", plan: txn.plan };
  }

  // Still PENDING locally — try one direct provider check for display
  // purposes only, so a slow webhook doesn't show as an outright failure.
  if (txn.provider_payment_id) {
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
