import { describe, expect, it } from "vitest";
import {
  FinanceValidationError,
  IdempotencyConflictError,
  analyzeRefunds,
  findAnomalies,
  reconcile,
  recognizedRevenue,
  refundState,
  summarize,
} from "@/lib/finance";
import { d, expense, fee, idr, newBook, payment, refund, settlement } from "./helpers";

const NOV = { from: "2026-11-01", to: "2026-11-30" };
const OPTS = { lateAfterDays: 3 };

describe("verified payments and idempotency", () => {
  it("duplicate payment: ingesting the same payment twice counts it once", () => {
    const book = newBook();
    expect(book.ingestPayment(payment())).toBe("APPLIED");
    expect(book.ingestPayment(payment())).toBe("DUPLICATE");
    const summary = summarize(book.snapshot(), NOV, OPTS);
    expect(summary.paymentCount).toBe(1);
    expect(d(summary.grossVerified)).toBe("300000.00");
    expect(book.ledgerEntries()).toHaveLength(1);
  });

  it("repeated webhook: a re-delivery with a NEW event id is still a no-op", () => {
    const book = newBook();
    book.ingestPayment(payment());
    const again = payment("pay_1", { verification: { source: "PROVIDER_WEBHOOK", webhookEventId: "evt_other" } });
    expect(book.ingestPayment(again)).toBe("DUPLICATE");
    expect(book.snapshot().payments).toHaveLength(1);
  });

  it("the same payment id with a different amount is a conflict, never summed", () => {
    const book = newBook();
    book.ingestPayment(payment());
    expect(() => book.ingestPayment(payment("pay_1", { amount: idr("999") }))).toThrow(IdempotencyConflictError);
  });

  it("rejects payments that are not gateway-verified or not positive", () => {
    const book = newBook();
    const unverified = { ...payment(), verification: undefined } as unknown as ReturnType<typeof payment>;
    expect(() => book.ingestPayment(unverified)).toThrow(FinanceValidationError);
    expect(() => book.ingestPayment(payment("p2", { amount: idr("0") }))).toThrow(FinanceValidationError);
  });

  it("the same invoice paid by two different payments is flagged, and both stay counted", () => {
    const book = newBook();
    book.ingestPayment(payment("pay_1", { invoiceRef: "inv_X" }));
    book.ingestPayment(payment("pay_2", { invoiceRef: "inv_X" }));
    const anomalies = findAnomalies(book.snapshot());
    expect(anomalies.map((a) => a.code)).toContain("DUPLICATE_PAYMENT_FOR_INVOICE");
    expect(d(summarize(book.snapshot(), NOV, OPTS).grossVerified)).toBe("600000.00");
  });

  it("a repeated refund webhook is a no-op, and a stale earlier state is ignored", () => {
    const book = newBook();
    book.ingestPayment(payment());
    expect(book.ingestRefund(refund("r1", "pay_1", "100000", { status: "REQUESTED", processedAt: null }))).toBe("APPLIED");
    expect(book.ingestRefund(refund("r1", "pay_1", "100000"))).toBe("UPDATED");
    expect(book.ingestRefund(refund("r1", "pay_1", "100000"))).toBe("DUPLICATE");
    expect(book.ingestRefund(refund("r1", "pay_1", "100000", { status: "REQUESTED", processedAt: null }))).toBe("DUPLICATE");
    expect(book.snapshot().refunds[0].status).toBe("PROCESSED");
  });
});

describe("refunds and revenue recognition", () => {
  it("partial refund: reduces revenue by the refunded amount and marks the payment partially refunded", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestRefund(refund("r1", "pay_1", "100000"));
    const snap = book.snapshot();
    const full = recognizedRevenue(snap, NOV);
    expect(d(full.recognizedNet)).toBe("200000.00");
    expect(d(full.deferredAtEnd)).toBe("0.00");
    const applied = analyzeRefunds(snap).applied;
    expect(refundState(snap.payments[0], applied[0].applied)).toBe("PARTIALLY_REFUNDED");
    // Before the refund date revenue is untouched: 19 days x 10,000.
    expect(d(recognizedRevenue(snap, { from: "2026-11-01", to: "2026-11-19" }).recognizedNet)).toBe("190000.00");
  });

  it("full refund: the payment nets to zero revenue (a negative adjustment lands in the refund period)", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestRefund(refund("r1", "pay_1", "300000"));
    const snap = book.snapshot();
    expect(d(recognizedRevenue(snap, NOV).recognizedNet)).toBe("0.00");
    expect(d(recognizedRevenue(snap, { from: "2026-11-20", to: "2026-11-30" }).recognizedNet)).toBe("-190000.00");
    expect(refundState(snap.payments[0], analyzeRefunds(snap).applied[0].applied)).toBe("REFUNDED");
  });

  it("requested, approved and failed refunds change nothing", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestRefund(refund("r1", "pay_1", "100000", { status: "APPROVED", processedAt: null }));
    book.ingestRefund(refund("r2", "pay_1", "100000", { status: "FAILED", processedAt: null }));
    expect(d(recognizedRevenue(book.snapshot(), NOV).recognizedNet)).toBe("300000.00");
  });

  it("an over-refund is capped at the payment balance and reported", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestRefund(refund("r1", "pay_1", "250000"));
    book.ingestRefund(refund("r2", "pay_1", "250000", { processedAt: "2026-11-21T03:00:00Z" }));
    const snap = book.snapshot();
    expect(d(recognizedRevenue(snap, NOV).recognizedNet)).toBe("0.00");
    expect(findAnomalies(snap).some((a) => a.code === "OVER_REFUND")).toBe(true);
  });

  it("a refund for an unknown payment is reported, not counted", () => {
    const book = newBook();
    book.ingestRefund(refund("r9", "ghost", "1000"));
    const snap = book.snapshot();
    expect(analyzeRefunds(snap).applied).toHaveLength(0);
    expect(findAnomalies(snap).map((a) => a.code)).toContain("REFUND_FOR_UNKNOWN_PAYMENT");
  });

  it("revenue is earned over the service period, not when the payment arrives", () => {
    const book = newBook();
    book.ingestPayment(payment());
    const half = recognizedRevenue(book.snapshot(), { from: "2026-11-01", to: "2026-11-15" });
    expect(d(half.recognizedNet)).toBe("150000.00");
    expect(d(half.deferredAtEnd)).toBe("150000.00");
  });

  it("a payment received after the period is not deferred revenue of that period", () => {
    const book = newBook();
    book.ingestPayment(payment("late", { paidAt: "2026-12-05T03:00:00Z", servicePeriodStart: "2026-12-01", servicePeriodEnd: "2026-12-31" }));
    expect(d(recognizedRevenue(book.snapshot(), NOV).deferredAtEnd)).toBe("0.00");
  });
});

describe("gateway fees, settlement and reconciliation", () => {
  it("gateway fee: is deducted in the simple P&L and from the expected payout", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestGatewayFee(fee("pay_1", "4000"));
    const s = summarize(book.snapshot(), NOV, OPTS);
    expect(d(s.gatewayFees)).toBe("4000.00");
    expect(d(s.simplePnl.operatingResult)).toBe("296000.00");
    expect(d(s.reconciliation.rows[0].expectedNet)).toBe("296000.00");
  });

  it("the same fee delivered twice is one fee; a different amount is a conflict", () => {
    const book = newBook();
    expect(book.ingestGatewayFee(fee("pay_1", "4000"))).toBe("APPLIED");
    expect(book.ingestGatewayFee(fee("pay_1", "4000"))).toBe("DUPLICATE");
    expect(() => book.ingestGatewayFee(fee("pay_1", "5000"))).toThrow(IdempotencyConflictError);
  });

  it("late settlement: unpaid-out money is flagged after the allowed days, not before", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestGatewayFee(fee("pay_1", "4000"));
    const early = reconcile(book.snapshot(), { asOf: "2026-11-03", lateAfterDays: 3 });
    expect(early.rows[0].status).toBe("UNSETTLED");
    expect(d(early.lateAmount)).toBe("0.00");
    const late = reconcile(book.snapshot(), { asOf: "2026-11-10", lateAfterDays: 3 });
    expect(late.rows[0].status).toBe("SETTLEMENT_LATE");
    expect(d(late.unsettledAmount)).toBe("296000.00");
    expect(d(late.lateAmount)).toBe("296000.00");
  });

  it("a settlement that arrives late still settles the payment but is marked as late", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestSettlement(settlement("s1", "2026-11-20T03:00:00Z", [{ paymentId: "pay_1", gross: "300000", fee: "4000" }]));
    const row = reconcile(book.snapshot(), { asOf: "2026-11-30", lateAfterDays: 3 }).rows[0];
    expect(row.status).toBe("SETTLED");
    expect(row.settledLate).toBe(true);
  });

  it("lateAfterDays is mandatory: there is no assumed gateway settlement time", () => {
    const book = newBook();
    expect(() => reconcile(book.snapshot(), { asOf: "2026-11-10", lateAfterDays: -1 })).toThrow();
    expect(() => reconcile(book.snapshot(), { asOf: "2026-11-10", lateAfterDays: undefined as unknown as number })).toThrow();
  });

  it("payment vs settlement difference: gross, revenue and cash are three different numbers", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestSettlement(settlement("s1", "2026-11-04T03:00:00Z", [{ paymentId: "pay_1", gross: "290000", fee: "4000" }]));
    const s = summarize(book.snapshot(), NOV, OPTS);
    expect(d(s.grossVerified)).toBe("300000.00");
    expect(d(s.recognizedNet)).toBe("300000.00");
    expect(d(s.settledNet)).toBe("286000.00");
    expect(s.reconciliation.rows[0].status).toBe("AMOUNT_MISMATCH");
    expect(s.anomalies.map((a) => a.code)).toContain("SETTLEMENT_AMOUNT_MISMATCH");
  });

  it("flags a gateway-reported net that does not equal gross - fee - refunds", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestSettlement(
      settlement("s1", "2026-11-04T03:00:00Z", [{ paymentId: "pay_1", gross: "300000", fee: "4000" }], { netAmount: idr("290000") }),
    );
    expect(findAnomalies(book.snapshot()).map((a) => a.code)).toContain("SETTLEMENT_NET_MISMATCH");
  });

  it("a payment listed in two settlements is flagged", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestSettlement(settlement("s1", "2026-11-04T03:00:00Z", [{ paymentId: "pay_1", gross: "300000", fee: "4000" }]));
    book.ingestSettlement(settlement("s2", "2026-11-05T03:00:00Z", [{ paymentId: "pay_1", gross: "300000", fee: "4000" }]));
    expect(reconcile(book.snapshot(), { asOf: "2026-11-30", lateAfterDays: 3 }).anomalies.map((a) => a.code)).toContain("PAYMENT_SETTLED_TWICE");
  });
});

describe("expenses, P&L and cash flow", () => {
  it("combines revenue, gateway fee and expenses; voided expenses are ignored", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestGatewayFee(fee("pay_1", "4000"));
    book.ingestSettlement(settlement("s1", "2026-11-04T03:00:00Z", [{ paymentId: "pay_1", gross: "300000", fee: "4000" }]));
    book.ingestExpense(expense("e1", "2026-11-05", "50000"));
    book.ingestExpense(expense("e2", "2026-11-06", "99999"));
    book.ingestExpense(expense("e2", "2026-11-06", "99999", { isVoid: true }));
    const s = summarize(book.snapshot(), NOV, OPTS);
    expect(d(s.operatingExpenses)).toBe("50000.00");
    expect(d(s.simplePnl.operatingResult)).toBe("246000.00");
    expect(d(s.cashFlow.net)).toBe("246000.00");
    expect(d(s.unsettled)).toBe("0.00");
  });

  it("an expense cannot be un-voided or silently changed", () => {
    const book = newBook();
    book.ingestExpense(expense("e1", "2026-11-05", "50000", { isVoid: true }));
    expect(() => book.ingestExpense(expense("e1", "2026-11-05", "50000"))).toThrow(IdempotencyConflictError);
    expect(() => book.ingestExpense(expense("e1", "2026-11-05", "60000", { isVoid: true }))).toThrow(IdempotencyConflictError);
  });

  it("ledger entries are deterministic and use the same keys the database enforces", () => {
    const book = newBook();
    book.ingestPayment(payment());
    book.ingestGatewayFee(fee("pay_1", "4000"));
    const keys = book.ledgerEntries().map((e) => e.idempotencyKey);
    expect(keys).toEqual(["fee|midtrans|pay_1", "payment|midtrans|pay_1"]);
  });
});
