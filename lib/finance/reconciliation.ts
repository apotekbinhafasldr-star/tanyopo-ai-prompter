import type { FinanceSnapshot } from "./book";
import { describeAmount, paymentKey } from "./book";
import { daysBetween, localDate, WIB_OFFSET_MINUTES } from "./dates";
import { add, compare, equals, isZero, max, sub, zero, type Money } from "./money";
import { analyzeRefunds, refundedByPayment } from "./refunds";
import type { Anomaly, Settlement, SettlementItem, VerifiedPayment } from "./types";

/**
 * Reconciliation of verified payments against gateway settlements.
 *
 * "The customer paid" and "the money reached our bank account" are different
 * facts. A payment is only SETTLED once a settlement report lists it; until then
 * it is UNSETTLED, and after `lateAfterDays` it is SETTLEMENT_LATE. How many
 * days a gateway normally takes is NOT assumed here: the caller must supply it.
 */

export type PaymentSettlementStatus =
  | "SETTLED"
  | "UNSETTLED"
  | "SETTLEMENT_LATE"
  | "AMOUNT_MISMATCH"
  | "FULLY_REFUNDED";

export interface ReconciliationOptions {
  /** Local calendar date the report is "as of", `YYYY-MM-DD`. */
  readonly asOf: string;
  /** Days after payment beyond which a missing settlement is flagged late. Required; no default. */
  readonly lateAfterDays: number;
  readonly offsetMinutes?: number;
}

export interface PaymentReconciliationRow {
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly paidDate: string;
  readonly gross: Money;
  readonly refundedApplied: Money;
  readonly gatewayFee: Money;
  readonly feeKnown: boolean;
  /** What should arrive: gross - fee - refunds, never below zero. */
  readonly expectedNet: Money;
  readonly status: PaymentSettlementStatus;
  readonly settlementId: string | null;
  readonly settledAt: string | null;
  /** True when a settlement exists but arrived later than `lateAfterDays` after payment. */
  readonly settledLate: boolean;
  readonly daysOutstanding: number;
}

export interface ReconciliationResult {
  readonly rows: readonly PaymentReconciliationRow[];
  /** Expected net of payments that are UNSETTLED or SETTLEMENT_LATE. */
  readonly unsettledAmount: Money;
  /** The subset of `unsettledAmount` that is already late. */
  readonly lateAmount: Money;
  readonly anomalies: readonly Anomaly[];
}

/** Anomalies that depend only on the books, not on the report date. */
export function findAnomalies(snapshot: FinanceSnapshot, offsetMinutes: number = WIB_OFFSET_MINUTES): Anomaly[] {
  const anomalies: Anomaly[] = [...analyzeRefunds(snapshot, offsetMinutes).anomalies];
  const known = new Map<string, VerifiedPayment>();
  for (const p of snapshot.payments) known.set(paymentKey(p.provider, p.providerPaymentId), p);

  // The same invoice paid by two distinct gateway payments: both are real cash
  // received, so both stay counted, but one of them probably needs refunding.
  const byInvoice = new Map<string, VerifiedPayment[]>();
  for (const p of snapshot.payments) {
    if (!p.invoiceRef) continue;
    const key = `${p.provider}|${p.invoiceRef}`;
    byInvoice.set(key, [...(byInvoice.get(key) ?? []), p]);
  }
  for (const [key, list] of byInvoice) {
    if (list.length > 1) {
      anomalies.push({
        code: "DUPLICATE_PAYMENT_FOR_INVOICE",
        detail: `Invoice ${key.split("|").slice(1).join("|")} was paid ${list.length} times`,
        refs: list.map((p) => p.providerPaymentId),
      });
    }
  }

  for (const fee of snapshot.fees) {
    if (!known.has(paymentKey(fee.provider, fee.providerPaymentId))) {
      anomalies.push({
        code: "FEE_FOR_UNKNOWN_PAYMENT",
        detail: `Gateway fee recorded for payment ${fee.providerPaymentId}, which is not a verified payment`,
        refs: [fee.providerPaymentId],
      });
    }
  }

  for (const s of snapshot.settlements) {
    let itemGross = zero(snapshot.currency);
    for (const item of s.items) itemGross = add(itemGross, item.grossAmount);
    if (s.items.length > 0 && !equals(itemGross, s.grossAmount)) {
      anomalies.push({
        code: "SETTLEMENT_TOTAL_MISMATCH",
        detail: `Settlement ${s.providerSettlementId}: items add up to ${describeAmount(itemGross)} but the header says ${describeAmount(s.grossAmount)}`,
        refs: [s.providerSettlementId],
      });
    }
    const expectedNet = max(sub(sub(s.grossAmount, s.feeAmount), s.refundDeducted), zero(snapshot.currency));
    if (!equals(expectedNet, s.netAmount)) {
      anomalies.push({
        code: "SETTLEMENT_NET_MISMATCH",
        detail: `Settlement ${s.providerSettlementId}: gross - fee - refunds = ${describeAmount(expectedNet)} but the gateway reported net ${describeAmount(s.netAmount)}`,
        refs: [s.providerSettlementId],
      });
    }
    for (const item of s.items) {
      if (!known.has(paymentKey(s.provider, item.providerPaymentId))) {
        anomalies.push({
          code: "SETTLEMENT_ITEM_UNKNOWN_PAYMENT",
          detail: `Settlement ${s.providerSettlementId} lists payment ${item.providerPaymentId}, which is not a verified payment`,
          refs: [s.providerSettlementId, item.providerPaymentId],
        });
      }
    }
  }

  return anomalies;
}

interface SettledItem {
  readonly settlement: Settlement;
  readonly item: SettlementItem;
}

export function reconcile(snapshot: FinanceSnapshot, options: ReconciliationOptions): ReconciliationResult {
  if (!Number.isInteger(options.lateAfterDays) || options.lateAfterDays < 0) {
    throw new Error("lateAfterDays must be a non-negative integer supplied by the caller");
  }
  const offset = options.offsetMinutes ?? WIB_OFFSET_MINUTES;
  const anomalies: Anomaly[] = [...findAnomalies(snapshot, offset)];

  const refundTotals = refundedByPayment(analyzeRefunds(snapshot, offset), snapshot.currency);

  const feeByPayment = new Map<string, Money>();
  for (const fee of snapshot.fees) {
    feeByPayment.set(paymentKey(fee.provider, fee.providerPaymentId), fee.amount);
  }

  const settledByPayment = new Map<string, SettledItem[]>();
  for (const settlement of snapshot.settlements) {
    for (const item of settlement.items) {
      const key = paymentKey(settlement.provider, item.providerPaymentId);
      settledByPayment.set(key, [...(settledByPayment.get(key) ?? []), { settlement, item }]);
    }
  }

  const rows: PaymentReconciliationRow[] = [];
  let unsettled = zero(snapshot.currency);
  let late = zero(snapshot.currency);

  for (const payment of snapshot.payments) {
    const key = paymentKey(payment.provider, payment.providerPaymentId);
    const paidDate = localDate(payment.paidAt, offset);
    const refunded = refundTotals.get(key) ?? zero(snapshot.currency);
    const settledItems = (settledByPayment.get(key) ?? []).slice().sort((a, b) =>
      Date.parse(a.settlement.settledAt) - Date.parse(b.settlement.settledAt),
    );
    const settledFee = settledItems[0]?.item.feeAmount ?? null;
    const recordedFee = feeByPayment.get(key) ?? settledFee;
    const gatewayFee = recordedFee ?? zero(snapshot.currency);
    const expectedNet = max(sub(sub(payment.amount, gatewayFee), refunded), zero(snapshot.currency));
    const daysOutstanding = Math.max(0, daysBetween(paidDate, options.asOf));

    if (settledItems.length > 1) {
      anomalies.push({
        code: "PAYMENT_SETTLED_TWICE",
        detail: `Payment ${payment.providerPaymentId} appears in ${settledItems.length} settlements`,
        refs: [payment.providerPaymentId, ...settledItems.map((s) => s.settlement.providerSettlementId)],
      });
    }

    let status: PaymentSettlementStatus;
    let settlementId: string | null = null;
    let settledAt: string | null = null;
    let settledLate = false;

    if (settledItems.length > 0) {
      const first = settledItems[0];
      settlementId = first.settlement.providerSettlementId;
      settledAt = first.settlement.settledAt;
      settledLate = daysBetween(paidDate, localDate(first.settlement.settledAt, offset)) > options.lateAfterDays;
      if (compare(first.item.grossAmount, payment.amount) !== 0) {
        status = "AMOUNT_MISMATCH";
        anomalies.push({
          code: "SETTLEMENT_AMOUNT_MISMATCH",
          detail: `Payment ${payment.providerPaymentId} is ${describeAmount(payment.amount)} but settlement ${first.settlement.providerSettlementId} lists ${describeAmount(first.item.grossAmount)}`,
          refs: [payment.providerPaymentId, first.settlement.providerSettlementId],
        });
      } else {
        status = "SETTLED";
      }
    } else if (isZero(expectedNet) && compare(refunded, payment.amount) >= 0) {
      status = "FULLY_REFUNDED";
    } else if (daysOutstanding > options.lateAfterDays) {
      status = "SETTLEMENT_LATE";
      unsettled = add(unsettled, expectedNet);
      late = add(late, expectedNet);
    } else {
      status = "UNSETTLED";
      unsettled = add(unsettled, expectedNet);
    }

    rows.push({
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paidDate,
      gross: payment.amount,
      refundedApplied: refunded,
      gatewayFee,
      feeKnown: recordedFee !== null,
      expectedNet,
      status,
      settlementId,
      settledAt,
      settledLate,
      daysOutstanding,
    });
  }

  rows.sort((a, b) => (a.paidDate === b.paidDate ? a.providerPaymentId.localeCompare(b.providerPaymentId) : a.paidDate < b.paidDate ? -1 : 1));
  return { rows, unsettledAmount: unsettled, lateAmount: late, anomalies };
}
