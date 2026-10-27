import type { FinanceSnapshot } from "./book";
import { paymentKey } from "./book";
import { addDays, assertRange, daysBetween, localDate, monthKey, WIB_OFFSET_MINUTES, type DateRange } from "./dates";
import { add, floorFraction, max, min, sub, zero, type Money } from "./money";
import { analyzeRefunds, type AppliedRefund } from "./refunds";
import type { VerifiedPayment } from "./types";

/**
 * Revenue recognition.
 *
 * A verified payment is cash-side evidence, NOT revenue. Revenue is the part of
 * the payment earned over its service period, recognised on a straight-line,
 * per-day basis. Cumulative floor allocation is used so the schedule always
 * adds up to exactly the payment amount, with no rounding drift.
 *
 * Refunds interact like this: the net amount that may ever be recognised for a
 * payment is `amount - refunds applied so far`. So a refund first removes
 * not-yet-earned (deferred) value without touching revenue, and only reduces
 * revenue (as a negative adjustment in the refund's period) when it exceeds
 * what is still unearned. A full refund therefore nets a payment to zero.
 *
 * The policy itself (straight-line daily over the service period) is a
 * placeholder pending the accountant's confirmation; the function is isolated
 * here so only this file changes if that policy does.
 */

/** Gross earned value of a payment as of the end of `date` (before refunds). */
export function earnedGrossUpTo(payment: VerifiedPayment, date: string): Money {
  if (date < payment.servicePeriodStart) return zero(payment.amount.currency);
  if (date >= payment.servicePeriodEnd) return payment.amount;
  const totalDays = daysBetween(payment.servicePeriodStart, payment.servicePeriodEnd) + 1;
  const elapsedDays = daysBetween(payment.servicePeriodStart, date) + 1;
  return floorFraction(payment.amount, elapsedDays, totalDays);
}

/** Cumulative revenue recognised for one payment as of the end of `date`, net of refunds applied by then. */
export function netRecognizedUpTo(payment: VerifiedPayment, refunds: readonly AppliedRefund[], date: string): Money {
  let refunded = zero(payment.amount.currency);
  for (const r of refunds) {
    if (r.effectiveDate <= date) {
      refunded = add(refunded, r.applied);
    }
  }
  const cap = sub(payment.amount, refunded);
  return min(earnedGrossUpTo(payment, date), max(cap, zero(payment.amount.currency)));
}

export interface RevenueResult {
  readonly currency: string;
  /** Net revenue recognised inside the range (can be negative if refunds exceed the earned amount of the period). */
  readonly recognizedNet: Money;
  /** Verified cash received but still unearned at the end of the range, net of refunds. */
  readonly deferredAtEnd: Money;
}

function groupRefundsByPayment(snapshot: FinanceSnapshot, offsetMinutes: number): Map<string, AppliedRefund[]> {
  const grouped = new Map<string, AppliedRefund[]>();
  for (const item of analyzeRefunds(snapshot, offsetMinutes).applied) {
    const key = paymentKey(item.payment.provider, item.payment.providerPaymentId);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return grouped;
}

export function recognizedRevenue(
  snapshot: FinanceSnapshot,
  range: DateRange,
  offsetMinutes: number = WIB_OFFSET_MINUTES,
): RevenueResult {
  assertRange(range);
  const grouped = groupRefundsByPayment(snapshot, offsetMinutes);
  const dayBefore = addDays(range.from, -1);

  let recognized = zero(snapshot.currency);
  let deferred = zero(snapshot.currency);

  for (const payment of snapshot.payments) {
    const refunds = grouped.get(paymentKey(payment.provider, payment.providerPaymentId)) ?? [];
    const upToEnd = netRecognizedUpTo(payment, refunds, range.to);
    const upToBefore = netRecognizedUpTo(payment, refunds, dayBefore);
    recognized = add(recognized, sub(upToEnd, upToBefore));

    // Only payments already received by the end of the range count towards deferred revenue.
    if (localDate(payment.paidAt, offsetMinutes) <= range.to) {
      let refunded = zero(snapshot.currency);
      for (const r of refunds) {
        if (r.effectiveDate <= range.to) refunded = add(refunded, r.applied);
      }
      const remainingValue = max(sub(payment.amount, refunded), zero(snapshot.currency));
      deferred = add(deferred, max(sub(remainingValue, upToEnd), zero(snapshot.currency)));
    }
  }

  return { currency: snapshot.currency, recognizedNet: recognized, deferredAtEnd: deferred };
}

/** Net recognised revenue per `YYYY-MM` for every month touched by `range`. */
export function recognizedRevenueByMonth(
  snapshot: FinanceSnapshot,
  range: DateRange,
  offsetMinutes: number = WIB_OFFSET_MINUTES,
): Array<{ month: string; recognizedNet: Money }> {
  assertRange(range);
  const months: Array<{ month: string; recognizedNet: Money }> = [];
  let cursor = range.from;
  while (cursor <= range.to) {
    const month = monthKey(cursor);
    const monthStart = `${month}-01`;
    // Last day of this month: day before the first of next month.
    const [year, mm] = month.split("-").map(Number);
    const nextMonthStart = mm === 12 ? `${year + 1}-01-01` : `${year}-${String(mm + 1).padStart(2, "0")}-01`;
    const monthEnd = addDays(nextMonthStart, -1);
    const from = monthStart < range.from ? range.from : monthStart;
    const to = monthEnd > range.to ? range.to : monthEnd;
    months.push({ month, recognizedNet: recognizedRevenue(snapshot, { from, to }, offsetMinutes).recognizedNet });
    cursor = nextMonthStart;
  }
  return months;
}
