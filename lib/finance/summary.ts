import type { FinanceSnapshot } from "./book";
import { paymentKey } from "./book";
import { assertRange, isWithin, localDate, WIB_OFFSET_MINUTES, type DateRange } from "./dates";
import { add, sub, zero, type Money } from "./money";
import { analyzeRefunds } from "./refunds";
import { reconcile, type ReconciliationResult } from "./reconciliation";
import { recognizedRevenue } from "./revenue";
import type { Anomaly } from "./types";

/**
 * Period summary. The four layers stay separate on purpose:
 *   - grossVerified      cash-side evidence: verified payments dated in the period
 *   - recognizedNet      revenue earned in the period (see revenue.ts)
 *   - settledNet         funds the gateway actually paid out in the period
 *   - unsettled          verified money not yet paid out, as of the period end
 * A payment is never "revenue" just because it was paid, and never "cash" just
 * because it was paid: only a settlement is cash.
 */

export interface SummaryOptions {
  /** Days after payment before a missing settlement is flagged late. Required; no default. */
  readonly lateAfterDays: number;
  readonly offsetMinutes?: number;
}

export interface PeriodSummary {
  readonly currency: string;
  readonly range: DateRange;

  readonly grossVerified: Money;
  readonly refundsProcessed: Money;
  readonly gatewayFees: Money;
  readonly recognizedNet: Money;
  readonly deferredAtEnd: Money;

  readonly settledNet: Money;
  readonly unsettled: Money;
  readonly lateUnsettled: Money;

  readonly operatingExpenses: Money;

  /** Simple P&L: recognised net revenue - gateway fees - operating expenses. Not a tax computation. */
  readonly simplePnl: {
    readonly recognizedNet: Money;
    readonly gatewayFees: Money;
    readonly operatingExpenses: Money;
    readonly operatingResult: Money;
  };

  /**
   * Actual cash movement: settled net payouts (refunds and fees are already
   * netted off by the gateway) minus operating expenses paid. A refund the
   * gateway has not yet deducted is NOT cash out here.
   */
  readonly cashFlow: {
    readonly inflowSettled: Money;
    readonly outflowExpenses: Money;
    readonly net: Money;
  };

  readonly paymentCount: number;
  readonly reconciliation: ReconciliationResult;
  readonly anomalies: readonly Anomaly[];
}

export function summarize(snapshot: FinanceSnapshot, range: DateRange, options: SummaryOptions): PeriodSummary {
  assertRange(range);
  const offset = options.offsetMinutes ?? WIB_OFFSET_MINUTES;
  const cur = snapshot.currency;

  let grossVerified = zero(cur);
  let paymentCount = 0;
  const paidInRange = new Set<string>();
  for (const p of snapshot.payments) {
    if (isWithin(localDate(p.paidAt, offset), range.from, range.to)) {
      grossVerified = add(grossVerified, p.amount);
      paymentCount += 1;
      paidInRange.add(paymentKey(p.provider, p.providerPaymentId));
    }
  }

  let refundsProcessed = zero(cur);
  for (const r of analyzeRefunds(snapshot, offset).applied) {
    if (isWithin(r.effectiveDate, range.from, range.to)) refundsProcessed = add(refundsProcessed, r.applied);
  }

  // Gateway fees follow the payment they were charged on.
  let gatewayFees = zero(cur);
  for (const fee of snapshot.fees) {
    if (paidInRange.has(paymentKey(fee.provider, fee.providerPaymentId))) {
      gatewayFees = add(gatewayFees, fee.amount);
    }
  }

  const revenue = recognizedRevenue(snapshot, range, offset);

  let settledNet = zero(cur);
  for (const s of snapshot.settlements) {
    if (isWithin(localDate(s.settledAt, offset), range.from, range.to)) settledNet = add(settledNet, s.netAmount);
  }

  let operatingExpenses = zero(cur);
  for (const e of snapshot.expenses) {
    if (!e.isVoid && isWithin(e.date, range.from, range.to)) operatingExpenses = add(operatingExpenses, e.amount);
  }

  const reconciliation = reconcile(snapshot, { asOf: range.to, lateAfterDays: options.lateAfterDays, offsetMinutes: offset });

  const operatingResult = sub(sub(revenue.recognizedNet, gatewayFees), operatingExpenses);

  return {
    currency: cur,
    range,
    grossVerified,
    refundsProcessed,
    gatewayFees,
    recognizedNet: revenue.recognizedNet,
    deferredAtEnd: revenue.deferredAtEnd,
    settledNet,
    unsettled: reconciliation.unsettledAmount,
    lateUnsettled: reconciliation.lateAmount,
    operatingExpenses,
    simplePnl: {
      recognizedNet: revenue.recognizedNet,
      gatewayFees,
      operatingExpenses,
      operatingResult,
    },
    cashFlow: {
      inflowSettled: settledNet,
      outflowExpenses: operatingExpenses,
      net: sub(settledNet, operatingExpenses),
    },
    paymentCount,
    reconciliation,
    anomalies: reconciliation.anomalies,
  };
}
