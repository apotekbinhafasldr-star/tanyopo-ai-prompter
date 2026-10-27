import type { FinanceSnapshot } from "./book";
import { paymentKey, describeAmount } from "./book";
import { localDate, WIB_OFFSET_MINUTES } from "./dates";
import { compare, min, sub, zero, add, isZero, type Money } from "./money";
import type { Anomaly, Refund, VerifiedPayment } from "./types";

export interface AppliedRefund {
  readonly refund: Refund;
  readonly payment: VerifiedPayment;
  /** The part of the refund that fits inside what the payment still has left. */
  readonly applied: Money;
  /** The part that would take the payment below zero. Reported, never counted. */
  readonly excess: Money;
  /** Local calendar date the refund was processed. */
  readonly effectiveDate: string;
}

export interface RefundAnalysis {
  readonly applied: readonly AppliedRefund[];
  readonly anomalies: readonly Anomaly[];
}

/**
 * Applies PROCESSED refunds to their payments in processing order. A payment
 * can never be refunded for more than it received: any excess is capped and
 * surfaced as an `OVER_REFUND` anomaly. Requested/approved/failed refunds do
 * not reduce anything. A refund whose payment is not in the books is NOT
 * counted; it is reported as `REFUND_FOR_UNKNOWN_PAYMENT`.
 */
export function analyzeRefunds(snapshot: FinanceSnapshot, offsetMinutes: number = WIB_OFFSET_MINUTES): RefundAnalysis {
  const payments = new Map<string, VerifiedPayment>();
  for (const p of snapshot.payments) {
    payments.set(paymentKey(p.provider, p.providerPaymentId), p);
  }

  const processed = snapshot.refunds
    .filter((r) => r.status === "PROCESSED" && r.processedAt)
    .slice()
    .sort((a, b) => {
      const byTime = Date.parse(a.processedAt as string) - Date.parse(b.processedAt as string);
      return byTime !== 0 ? byTime : a.providerRefundId.localeCompare(b.providerRefundId);
    });

  const refundedSoFar = new Map<string, Money>();
  const applied: AppliedRefund[] = [];
  const anomalies: Anomaly[] = [];

  for (const refund of processed) {
    const key = paymentKey(refund.provider, refund.providerPaymentId);
    const payment = payments.get(key);
    if (!payment) {
      anomalies.push({
        code: "REFUND_FOR_UNKNOWN_PAYMENT",
        detail: `Refund ${refund.providerRefundId} references payment ${refund.providerPaymentId}, which is not a verified payment`,
        refs: [refund.providerRefundId, refund.providerPaymentId],
      });
      continue;
    }

    const already = refundedSoFar.get(key) ?? zero(snapshot.currency);
    const remaining = sub(payment.amount, already);
    const fits = min(refund.amount, remaining);
    const excess = sub(refund.amount, fits);

    if (!isZero(excess)) {
      anomalies.push({
        code: "OVER_REFUND",
        detail: `Refund ${refund.providerRefundId} exceeds the refundable balance of payment ${refund.providerPaymentId} by ${describeAmount(excess)}`,
        refs: [refund.providerRefundId, refund.providerPaymentId],
      });
    }

    refundedSoFar.set(key, add(already, fits));
    applied.push({
      refund,
      payment,
      applied: fits,
      excess,
      effectiveDate: localDate(refund.processedAt as string, offsetMinutes),
    });
  }

  return { applied, anomalies };
}

export type PaymentRefundState = "NONE" | "PARTIALLY_REFUNDED" | "REFUNDED";

/** Total applied refunds per payment key. */
export function refundedByPayment(analysis: RefundAnalysis, currency: string): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const item of analysis.applied) {
    const key = paymentKey(item.payment.provider, item.payment.providerPaymentId);
    totals.set(key, add(totals.get(key) ?? zero(currency), item.applied));
  }
  return totals;
}

export function refundState(payment: VerifiedPayment, refunded: Money): PaymentRefundState {
  if (isZero(refunded)) return "NONE";
  return compare(refunded, payment.amount) >= 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
}
