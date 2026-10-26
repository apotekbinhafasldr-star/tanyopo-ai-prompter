import { assertDate } from "./dates";
import { canonicalJson, IdempotencyConflictError, idempotencyKey, registerOnce, type RegisterResult } from "./idempotency";
import { isNegative, isPositive, toDecimalString } from "./money";
import type {
  GatewayFee,
  LedgerEntry,
  OperatingExpense,
  Refund,
  RefundStatus,
  Settlement,
  VerifiedPayment,
} from "./types";

export class FinanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceValidationError";
  }
}

export type IngestResult = RegisterResult | "UPDATED";

/** Read-only view of everything a book holds. All report functions take this. */
export interface FinanceSnapshot {
  readonly currency: string;
  readonly payments: readonly VerifiedPayment[];
  readonly refunds: readonly Refund[];
  readonly fees: readonly GatewayFee[];
  readonly settlements: readonly Settlement[];
  readonly expenses: readonly OperatingExpense[];
}

const REFUND_RANK: Record<RefundStatus, number> = { REQUESTED: 0, APPROVED: 1, PROCESSED: 2, FAILED: 2 };

export function paymentKey(provider: string, providerPaymentId: string): string {
  return idempotencyKey("payment", provider, providerPaymentId);
}

function fail(message: string): never {
  throw new FinanceValidationError(message);
}

function requireCurrency(book: string, actual: string, what: string): void {
  if (actual !== book) {
    fail(`${what} is in ${actual} but this book is ${book}`);
  }
}

/**
 * In-memory finance book. Ingestion is idempotent: re-delivering the same fact
 * (a repeated webhook, a retried job) is a no-op, and a conflicting fact under
 * the same key throws. Reports are computed from `snapshot()`, never stored.
 */
export class FinanceBook {
  readonly currency: string;
  private readonly payments = new Map<string, VerifiedPayment>();
  private readonly refunds = new Map<string, Refund>();
  private readonly fees = new Map<string, GatewayFee>();
  private readonly settlements = new Map<string, Settlement>();
  private readonly expenses = new Map<string, OperatingExpense>();

  constructor(currency: string) {
    this.currency = currency;
  }

  /**
   * Records a gateway-VERIFIED payment. A payment without webhook verification
   * is rejected: pending rows a tenant can create for itself, or amounts sent
   * by a browser, must never reach the books.
   */
  ingestPayment(payment: VerifiedPayment): IngestResult {
    if (!payment.verification || payment.verification.source !== "PROVIDER_WEBHOOK" || !payment.verification.webhookEventId) {
      fail(`Payment ${payment.providerPaymentId} is not gateway-verified`);
    }
    requireCurrency(this.currency, payment.amount.currency, "Payment");
    if (!isPositive(payment.amount)) {
      fail("Payment amount must be greater than zero");
    }
    assertDate(payment.servicePeriodStart);
    assertDate(payment.servicePeriodEnd);
    if (payment.servicePeriodStart > payment.servicePeriodEnd) {
      fail("Service period start is after its end");
    }
    if (Number.isNaN(Date.parse(payment.paidAt))) {
      fail("paidAt is not a valid timestamp");
    }

    // The id of the webhook delivery is NOT part of the economic fact: a
    // re-delivered webhook carries a new event id for the same payment.
    return registerOnce(
      this.payments,
      paymentKey(payment.provider, payment.providerPaymentId),
      payment,
      (p) =>
        canonicalJson({
          provider: p.provider,
          providerPaymentId: p.providerPaymentId,
          tenantId: p.tenantId,
          invoiceRef: p.invoiceRef,
          amount: p.amount,
          paidAt: new Date(p.paidAt).toISOString(),
          servicePeriodStart: p.servicePeriodStart,
          servicePeriodEnd: p.servicePeriodEnd,
        }),
    );
  }

  ingestRefund(refund: Refund): IngestResult {
    requireCurrency(this.currency, refund.amount.currency, "Refund");
    if (!isPositive(refund.amount)) {
      fail("Refund amount must be greater than zero");
    }
    if (refund.status === "PROCESSED") {
      if (!refund.processedAt || Number.isNaN(Date.parse(refund.processedAt))) {
        fail("A PROCESSED refund needs a valid processedAt");
      }
    }

    const key = idempotencyKey("refund", refund.provider, refund.providerRefundId);
    const existing = this.refunds.get(key);
    if (!existing) {
      this.refunds.set(key, refund);
      return "APPLIED";
    }

    const sameFact =
      existing.providerPaymentId === refund.providerPaymentId && existing.amount.minor === refund.amount.minor;
    if (!sameFact) {
      throw new IdempotencyConflictError(key);
    }
    if (existing.status === refund.status) {
      if (existing.status === "PROCESSED" && existing.processedAt !== refund.processedAt) {
        // Same terminal state delivered again with a different timestamp: keep the first.
        if (Date.parse(existing.processedAt ?? "") !== Date.parse(refund.processedAt ?? "")) {
          throw new IdempotencyConflictError(key);
        }
      }
      return "DUPLICATE";
    }
    const existingRank = REFUND_RANK[existing.status];
    const incomingRank = REFUND_RANK[refund.status];
    if (existingRank === 2 && incomingRank === 2) {
      // PROCESSED <-> FAILED can never both be true.
      throw new IdempotencyConflictError(key);
    }
    if (incomingRank > existingRank) {
      this.refunds.set(key, refund);
      return "UPDATED";
    }
    // A stale, earlier-state delivery arriving late: ignore it.
    return "DUPLICATE";
  }

  ingestGatewayFee(fee: GatewayFee): IngestResult {
    requireCurrency(this.currency, fee.amount.currency, "Gateway fee");
    if (isNegative(fee.amount)) {
      fail("Gateway fee cannot be negative");
    }
    // The fee for a payment is one fact, whichever channel reports it first.
    return registerOnce(this.fees, idempotencyKey("fee", fee.provider, fee.providerPaymentId), fee, (f) =>
      canonicalJson({ provider: f.provider, providerPaymentId: f.providerPaymentId, amount: f.amount }),
    );
  }

  ingestSettlement(settlement: Settlement): IngestResult {
    for (const [label, value] of [
      ["gross", settlement.grossAmount],
      ["fee", settlement.feeAmount],
      ["refundDeducted", settlement.refundDeducted],
      ["net", settlement.netAmount],
    ] as const) {
      requireCurrency(this.currency, value.currency, `Settlement ${label}`);
      if (isNegative(value)) {
        fail(`Settlement ${label} cannot be negative`);
      }
    }
    if (Number.isNaN(Date.parse(settlement.settledAt))) {
      fail("settledAt is not a valid timestamp");
    }
    for (const item of settlement.items) {
      requireCurrency(this.currency, item.grossAmount.currency, "Settlement item");
      requireCurrency(this.currency, item.feeAmount.currency, "Settlement item fee");
    }
    return registerOnce(
      this.settlements,
      idempotencyKey("settlement", settlement.provider, settlement.providerSettlementId),
      settlement,
      (s) =>
        canonicalJson({
          ...s,
          settledAt: new Date(s.settledAt).toISOString(),
          items: [...s.items].sort((a, b) => a.providerPaymentId.localeCompare(b.providerPaymentId)),
        }),
    );
  }

  ingestExpense(expense: OperatingExpense): IngestResult {
    requireCurrency(this.currency, expense.amount.currency, "Expense");
    if (isNegative(expense.amount)) {
      fail("Expense amount cannot be negative");
    }
    assertDate(expense.date);
    const key = idempotencyKey("expense", expense.id);
    const existing = this.expenses.get(key);
    if (!existing) {
      this.expenses.set(key, expense);
      return "APPLIED";
    }
    const sameFact =
      existing.date === expense.date &&
      existing.amount.minor === expense.amount.minor &&
      existing.category === expense.category;
    if (!sameFact) {
      throw new IdempotencyConflictError(key);
    }
    if (existing.isVoid === expense.isVoid) {
      return "DUPLICATE";
    }
    if (!existing.isVoid && expense.isVoid) {
      // Voiding is the only permitted change; the expense is never deleted.
      this.expenses.set(key, expense);
      return "UPDATED";
    }
    // Un-voiding is not allowed: re-enter the expense under a new id instead.
    throw new IdempotencyConflictError(key);
  }

  snapshot(): FinanceSnapshot {
    return {
      currency: this.currency,
      payments: [...this.payments.values()],
      refunds: [...this.refunds.values()],
      fees: [...this.fees.values()],
      settlements: [...this.settlements.values()],
      expenses: [...this.expenses.values()],
    };
  }

  /**
   * The ledger lines this book corresponds to, in the same shape and with the
   * same idempotency keys as `finance_ledger_entries`. Deterministically
   * ordered. Non-processed refunds and void expenses produce no line.
   */
  ledgerEntries(): LedgerEntry[] {
    const entries: LedgerEntry[] = [];
    for (const p of this.payments.values()) {
      entries.push({
        idempotencyKey: paymentKey(p.provider, p.providerPaymentId),
        type: "PAYMENT_VERIFIED",
        direction: "IN",
        amount: p.amount,
        effectiveAt: new Date(p.paidAt).toISOString(),
        provider: p.provider,
        providerRef: p.providerPaymentId,
      });
    }
    for (const r of this.refunds.values()) {
      if (r.status !== "PROCESSED" || !r.processedAt) continue;
      entries.push({
        idempotencyKey: idempotencyKey("refund", r.provider, r.providerRefundId),
        type: "REFUND",
        direction: "OUT",
        amount: r.amount,
        effectiveAt: new Date(r.processedAt).toISOString(),
        provider: r.provider,
        providerRef: r.providerRefundId,
      });
    }
    for (const f of this.fees.values()) {
      const payment = this.payments.get(paymentKey(f.provider, f.providerPaymentId));
      entries.push({
        idempotencyKey: idempotencyKey("fee", f.provider, f.providerPaymentId),
        type: "GATEWAY_FEE",
        direction: "OUT",
        amount: f.amount,
        effectiveAt: payment ? new Date(payment.paidAt).toISOString() : "",
        provider: f.provider,
        providerRef: f.providerPaymentId,
      });
    }
    for (const s of this.settlements.values()) {
      entries.push({
        idempotencyKey: idempotencyKey("settlement", s.provider, s.providerSettlementId),
        type: "SETTLEMENT",
        direction: "IN",
        amount: s.netAmount,
        effectiveAt: new Date(s.settledAt).toISOString(),
        provider: s.provider,
        providerRef: s.providerSettlementId,
      });
    }
    for (const e of this.expenses.values()) {
      if (e.isVoid) continue;
      entries.push({
        idempotencyKey: idempotencyKey("expense", e.id),
        type: "EXPENSE",
        direction: "OUT",
        amount: e.amount,
        effectiveAt: e.date,
        provider: null,
        providerRef: e.id,
      });
    }
    return entries.sort((a, b) => (a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0));
  }
}

/** Human-readable one-liner used in anomaly details. */
export function describeAmount(amount: { minor: bigint; currency: string }): string {
  return `${toDecimalString(amount)} ${amount.currency}`;
}
