import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProvider, VerifiedPayment, VerifiedPaymentStatus } from "@/lib/billing/payment-provider";
import { recordPaymentAlarm } from "@/services/payment-alerts";
import type { Database, Json } from "@/types/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A provider that can answer "what does the gateway itself say about this order?". */
export type VerifyingPaymentProvider = PaymentProvider & {
  getVerifiedPayment: (orderId: string) => Promise<VerifiedPayment>;
};

export function canVerifyServerSide(provider: PaymentProvider): provider is VerifyingPaymentProvider {
  return typeof provider.getVerifiedPayment === "function";
}

export type PaymentAlarmKind = "REFUND" | "CHARGEBACK" | "REVERSAL";

export type SettleOutcome =
  | { kind: "APPLIED"; reason: "APPLIED" | "ALREADY_PROCESSED" }
  | { kind: "NEEDS_REVIEW" }
  | { kind: "NOT_APPLIED"; reason: string }
  | { kind: "NOT_PAID"; status: VerifiedPaymentStatus; closed: boolean }
  | { kind: "ALARM"; alarm: PaymentAlarmKind; evidenceRef: string }
  | { kind: "NOT_FOUND" }
  | { kind: "WRONG_PROVIDER" }
  | { kind: "UNVERIFIABLE"; message: string }
  | { kind: "RPC_ERROR"; message: string };

type TxnRow = Pick<
  Database["public"]["Tables"]["prompter_payment_transactions"]["Row"],
  "id" | "tenant_id" | "provider" | "status" | "amount" | "currency" | "plan"
>;

/**
 * Billing B3 — the one server-side path that may turn a gateway payment into a subscription change. Both callers
 * (the webhook and the return-from-checkout page) pass only a transaction id; EVERYTHING that decides the outcome —
 * status, amount, currency, the gateway payment reference — comes from the gateway's own answer
 * (provider.getVerifiedPayment), never from a webhook body or a browser redirect.
 *
 * Safety properties:
 *  - Fail closed: any gateway timeout / error / inconsistent answer returns UNVERIFIABLE and changes nothing.
 *  - Only a VERIFIED PAID reaches fn_apply_verified_payment() (B2: idempotent per transaction, stacks one period,
 *    late / mismatched / conflicting payments become REVIEW, never lost and never auto-trusted).
 *  - The transaction must exist and must have been created for THIS provider (no cross-provider confusion).
 *  - Refund / chargeback (and a payment reversed after it was paid) never change the subscription: they create one
 *    alert in the B4.1 queue (service_role-only table, deduplicated by the database). No notification is sent by this code.
 *  - A verified cancel / expire / deny closes a still-PENDING invoice only (guarded `status = 'PENDING'` update);
 *    PAID / REVIEW rows are never touched here.
 */
export async function verifyAndSettle(
  admin: SupabaseClient<Database>,
  provider: VerifyingPaymentProvider,
  transactionId: string,
  context: { eventId: string | null },
): Promise<SettleOutcome> {
  if (!UUID_PATTERN.test(transactionId)) {
    return { kind: "NOT_FOUND" };
  }

  const { data: txn } = await admin
    .from("prompter_payment_transactions")
    .select("id, tenant_id, provider, status, amount, currency, plan")
    .eq("id", transactionId)
    .maybeSingle();

  if (!txn) return { kind: "NOT_FOUND" };
  if (txn.provider !== provider.name) return { kind: "WRONG_PROVIDER" };

  let verified: VerifiedPayment;
  try {
    verified = await provider.getVerifiedPayment(transactionId);
  } catch {
    return { kind: "UNVERIFIABLE", message: "GATEWAY_VERIFICATION_FAILED" };
  }

  // The gateway must be talking about the very order we asked about.
  if (verified.orderId !== transactionId) {
    return { kind: "UNVERIFIABLE", message: "GATEWAY_ORDER_MISMATCH" };
  }

  switch (verified.status) {
    case "PAID":
      return applyVerifiedPaid(admin, txn, verified, context.eventId);

    case "REFUNDED":
      return recordAlarm(admin, txn, "REFUND", verified);

    case "CHARGEBACK":
      return recordAlarm(admin, txn, "CHARGEBACK", verified);

    case "CANCELLED":
    case "EXPIRED":
    case "FAILED": {
      if (txn.status === "PAID") {
        // The money was reported back / voided after we activated: never silent, never auto-revoked.
        return recordAlarm(admin, txn, "REVERSAL", verified);
      }
      if (txn.status !== "PENDING") {
        return { kind: "NOT_PAID", status: verified.status, closed: false };
      }
      const { error } = await admin
        .from("prompter_payment_transactions")
        .update({ status: verified.status, failure_reason: `GATEWAY_${verified.status}` })
        .eq("id", txn.id)
        .eq("status", "PENDING");
      if (error) return { kind: "RPC_ERROR", message: "CLOSE_INVOICE_FAILED" };
      return { kind: "NOT_PAID", status: verified.status, closed: true };
    }

    default:
      // PENDING, and anything unrecognised: not paid, nothing closed, nothing activated.
      return { kind: "NOT_PAID", status: verified.status, closed: false };
  }
}

async function applyVerifiedPaid(
  admin: SupabaseClient<Database>,
  txn: TxnRow,
  verified: VerifiedPayment,
  eventId: string | null,
): Promise<SettleOutcome> {
  if (!verified.gatewayTransactionId) {
    // A paid answer without the gateway's own payment reference cannot be reconciled later: do not activate on it.
    return { kind: "UNVERIFIABLE", message: "GATEWAY_REFERENCE_MISSING" };
  }

  const { data: rpcRows, error: rpcError } = await admin.rpc("fn_apply_verified_payment", {
    p_transaction_id: txn.id,
    p_provider_payment_id: verified.gatewayTransactionId,
    p_provider_event_id: eventId ?? `status-api:${verified.gatewayTransactionId}`,
    p_verified_amount: verified.amount,
    p_verified_currency: verified.currency,
  });

  const activation = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as
    | { allowed: boolean; reason: string | null }
    | undefined;

  if (rpcError || !activation) {
    return { kind: "RPC_ERROR", message: rpcError?.message ?? "RPC_NO_RESULT" };
  }
  if (!activation.allowed && activation.reason === "NEEDS_REVIEW") {
    return { kind: "NEEDS_REVIEW" };
  }
  if (!activation.allowed) {
    return { kind: "NOT_APPLIED", reason: activation.reason ?? "PAYMENT_NOT_APPLIED" };
  }
  return { kind: "APPLIED", reason: activation.reason === "ALREADY_PROCESSED" ? "ALREADY_PROCESSED" : "APPLIED" };
}

/**
 * Billing B4.1 — refund / chargeback / reversal go to the payment alert queue (prompter_payment_alerts, service_role
 * only) via fn_record_payment_alarm: one alert per (transaction, kind), enforced by the database. The tenant-writable
 * prompter_audit_logs table is NOT consulted or trusted any more (a tenant member could forge a row there to suppress
 * a real alarm). The subscription is never changed. If the alert cannot be written the caller gets RPC_ERROR (so the
 * gateway retries) rather than a silent loss; the periodic sync also re-derives the alert from the webhook event.
 */
async function recordAlarm(
  admin: SupabaseClient<Database>,
  txn: TxnRow,
  alarm: PaymentAlarmKind,
  verified: VerifiedPayment,
): Promise<SettleOutcome> {
  // Identity of the verified gateway state. The adapter derives it from the gateway's own answer; if an adapter does
  // not, fall back to a hash of the verified fields so the ref is still never taken from a webhook body.
  const evidenceRef =
    verified.eventRef ??
    `gw:${createHash("sha256")
      .update([alarm, verified.rawStatus, verified.gatewayTransactionId ?? "-", verified.amount, verified.currency].join("|"))
      .digest("hex")
      .slice(0, 40)}`;

  const result = await recordPaymentAlarm(
    admin,
    txn.id,
    alarm,
    {
      gateway_status: verified.rawStatus,
      gateway_transaction_id: verified.gatewayTransactionId,
      reported_amount: verified.amount,
      reported_currency: verified.currency,
      transaction_status: txn.status,
      transaction_amount: txn.amount,
      plan: txn.plan,
      event_ref_basis: verified.eventRefBasis ?? "status_only",
      subscription_changed: false,
    } satisfies Record<string, Json>,
    evidenceRef,
  );
  if (!result.ok) return { kind: "RPC_ERROR", message: result.message };
  return { kind: "ALARM", alarm, evidenceRef };
}
