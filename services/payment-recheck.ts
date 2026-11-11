import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/billing/payment-alerts";
import type { PaymentProvider } from "@/lib/billing/payment-provider";
import { SWEEP_MIN_AGE_MS } from "@/services/payment-sweeper";
import { canVerifyServerSide, verifyAndSettle } from "@/services/payment-verification";
import type { Database } from "@/types/database";

export type RecheckCode =
  | "applied"
  | "closed"
  | "still_pending"
  | "unknown"
  | "review"
  | "alarm"
  | "unverifiable"
  | "not_eligible"
  | "not_configured"
  | "invalid"
  | "failed";

export interface RecheckResult {
  ok: boolean;
  code: RecheckCode;
}

/**
 * P0-C — operator "Verifikasi ulang" for a DOKU transaction stuck PENDING. It decides NOTHING: it only asks the existing
 * verifyAndSettle() (gateway Check Status = the only source of activation, idempotent in fn_apply_verified_payment).
 * Eligibility: provider doku, status PENDING, older than the sweep age. Fail-closed: an unconfigured / non-verifying
 * provider returns not_configured without touching the database. Caller is responsible for the operator gate and rate limit.
 * Audit: one row before and one after the call (best effort; the audit table is not a decision input).
 */
export async function recheckPendingPayment(
  admin: SupabaseClient<Database>,
  provider: PaymentProvider,
  transactionId: unknown,
  operatorId: string,
  now: number = Date.now(),
): Promise<RecheckResult> {
  if (!isUuid(transactionId) || !isUuid(operatorId)) return { ok: false, code: "invalid" };
  if (provider.name !== "doku" || !provider.isConfigured() || !canVerifyServerSide(provider)) {
    return { ok: false, code: "not_configured" };
  }

  const { data: txn } = await admin
    .from("prompter_payment_transactions")
    .select("id, tenant_id, provider, status, created_at")
    .eq("id", transactionId)
    .maybeSingle();
  const createdAt = txn ? Date.parse(String(txn.created_at)) : NaN;
  if (!txn || txn.provider !== "doku" || txn.status !== "PENDING" || !Number.isFinite(createdAt) || now - createdAt < SWEEP_MIN_AGE_MS) {
    return { ok: false, code: "not_eligible" };
  }

  const audit = async (action: string, context: Record<string, string>) => {
    try {
      await admin.from("prompter_audit_logs").insert({
        tenant_id: txn.tenant_id,
        actor_user_id: operatorId,
        action,
        resource_type: "prompter_payment_transactions",
        resource_id: txn.id,
        context,
      });
    } catch {
      // best effort: the settlement itself is idempotent and does not depend on this row
    }
  };

  await audit("payment.operator_recheck_requested", { provider: "doku" });
  let outcome;
  try {
    outcome = await verifyAndSettle(admin, provider, txn.id, { eventId: null });
  } catch {
    await audit("payment.operator_recheck_result", { result: "failed" });
    return { ok: false, code: "failed" };
  }

  let result: RecheckResult;
  switch (outcome.kind) {
    case "APPLIED":
      result = { ok: true, code: "applied" };
      break;
    case "NOT_PAID":
      result = outcome.closed
        ? { ok: true, code: "closed" }
        : { ok: true, code: outcome.status === "UNKNOWN" ? "unknown" : "still_pending" };
      break;
    case "NEEDS_REVIEW":
      result = { ok: true, code: "review" };
      break;
    case "ALARM":
      result = { ok: true, code: "alarm" };
      break;
    case "UNVERIFIABLE":
      result = { ok: false, code: "unverifiable" };
      break;
    default:
      result = { ok: false, code: "failed" };
  }
  await audit("payment.operator_recheck_result", { result: result.code });
  return result;
}
