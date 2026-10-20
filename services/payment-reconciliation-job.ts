import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { callPaymentRpc, type ApplyPaymentRow } from "@/lib/billing/payment-rpc";
import type { Database } from "@/types/database";

interface ClaimedRow {
  out_transaction_id: string;
  out_provider: string;
  out_provider_payment_id: string;
  out_amount: number;
  out_currency: string;
  out_plan: string;
  out_attempts: number;
}

export interface ReconciliationRunSummary {
  claimed: number;
  applied: number;
  notPaid: number;
  needsReview: number;
  errors: number;
}

/**
 * Billing Financial Safety — lost-webhook recovery. Claims PENDING
 * transactions that already have a gateway invoice (skip-locked, with
 * exponential backoff, max 12 attempts), asks the gateway for the real
 * status, and hands PAID to the same fn_apply_payment_event() the webhook
 * uses (source RECONCILIATION), so webhook + reconciliation can race and
 * still activate at most once.
 *
 * A timeout / error is NEVER a failure: it is recorded as ERROR, the row
 * stays PENDING and is retried later. Only a gateway-confirmed NOT-PAID
 * answer lets the expiry sweep close the transaction. If the adapter cannot
 * report the amount (no getPaymentDetails), a PAID found here is sent with a
 * null amount, which the database turns into an OPEN INVALID_PAYLOAD
 * exception — visible to a human, never silently credited, never lost.
 */
export async function runPaymentReconciliation(
  admin: SupabaseClient<Database>,
  options: { limit?: number } = {},
): Promise<ReconciliationRunSummary> {
  const summary: ReconciliationRunSummary = { claimed: 0, applied: 0, notPaid: 0, needsReview: 0, errors: 0 };
  const provider = getPaymentProvider();
  if (!provider.isConfigured()) return summary;

  const claimed = await callPaymentRpc<ClaimedRow>(admin, "fn_claim_reconciliation_batch", {
    p_limit: options.limit ?? 20,
  });
  const rows = claimed.data ?? [];
  summary.claimed = rows.length;

  for (const row of rows) {
    const record = (result: "NOT_PAID" | "ERROR", gatewayStatus: string) =>
      callPaymentRpc(admin, "fn_record_reconciliation_attempt", {
        p_transaction_id: row.out_transaction_id,
        p_result: result,
        p_gateway_status: gatewayStatus,
        p_detail: {},
      });

    if (row.out_provider !== provider.name) {
      // Row belongs to a provider that is not the active adapter: cannot ask
      // the right gateway. Keep PENDING and retry later; never expire.
      summary.errors += 1;
      await record("ERROR", "PROVIDER_NOT_ACTIVE");
      continue;
    }

    let status: string;
    let amount: number | null = null;
    let currency: string | null = null;
    try {
      if (provider.getPaymentDetails) {
        const details = await provider.getPaymentDetails(row.out_provider_payment_id);
        status = details.status;
        amount = details.amount;
        currency = details.currency;
      } else {
        status = await provider.getPaymentStatus(row.out_provider_payment_id);
      }
    } catch {
      summary.errors += 1;
      await record("ERROR", "GATEWAY_UNREACHABLE");
      continue;
    }

    if (status === "PAID") {
      const applied = await callPaymentRpc<ApplyPaymentRow>(admin, "fn_apply_payment_event", {
        p_provider: provider.name,
        p_transaction_id: row.out_transaction_id,
        p_provider_payment_id: row.out_provider_payment_id,
        p_provider_event_id: null,
        p_status: "PAID",
        p_amount: amount,
        p_currency: currency,
        p_source: "RECONCILIATION",
      });
      const outcome = applied.data?.[0]?.result_outcome;
      if (applied.error || !outcome) {
        summary.errors += 1;
      } else if (outcome === "APPLIED" || outcome === "ALREADY_APPLIED") {
        summary.applied += 1;
      } else {
        summary.needsReview += 1;
      }
      continue;
    }

    if (status === "PENDING") {
      summary.notPaid += 1;
      await record("NOT_PAID", status);
      continue;
    }

    // FAILED / EXPIRED / CANCELLED according to the gateway: observed and
    // ledgered through the same function; the row only closes through the
    // normal sweep after this gateway-confirmed answer.
    await callPaymentRpc(admin, "fn_apply_payment_event", {
      p_provider: provider.name,
      p_transaction_id: row.out_transaction_id,
      p_provider_payment_id: row.out_provider_payment_id,
      p_provider_event_id: null,
      p_status: status,
      p_amount: amount,
      p_currency: currency,
      p_source: "RECONCILIATION",
    });
    summary.notPaid += 1;
    await record("NOT_PAID", status);
  }

  return summary;
}
