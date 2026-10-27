import { describe, expect, it } from "vitest";
import { summarize, recognizedRevenue } from "@/lib/finance";
import {
  Ledger,
  OpenItemBook,
  OpenItemError,
  balanceSheet,
  bucketFor,
  cashFlowStatement,
  defaultChart,
  incomeStatement,
  journalizeSnapshot,
  reconcileBank,
  reconcileControl,
  trialBalance,
  type JournalDraft,
} from "@/lib/accounting";
import { d, expense, fee, idr, newBook, payment, refund, settlement } from "../finance/helpers";

const AT = "2026-12-01T00:00:00Z";
const NOV = { from: "2026-11-01", to: "2026-11-30" };
const OPT = { actor: "system", at: AT, through: "2026-11-30" };

function demo() {
  const book = newBook();
  book.ingestPayment(payment("p1"));
  book.ingestPayment(payment("p2", { amount: idr("150000"), paidAt: "2026-11-05T03:00:00Z", servicePeriodStart: "2026-11-05", servicePeriodEnd: "2026-12-04", invoiceRef: "inv_p2" }));
  book.ingestGatewayFee(fee("p1", "4000"));
  book.ingestGatewayFee(fee("p2", "2000"));
  book.ingestSettlement(settlement("s1", "2026-11-04T03:00:00Z", [{ paymentId: "p1", gross: "300000", fee: "4000" }]));
  book.ingestRefund(refund("r1", "p1", "50000"));
  book.ingestExpense(expense("e1", "2026-11-10", "100000", { category: "Hosting" }));
  book.ingestExpense(expense("e2", "2026-11-12", "30000", { category: "Entah" }));
  return book;
}

describe("journalizing the finance book (no double recording)", () => {
  it("is idempotent: a second run posts nothing and changes no balance", () => {
    const l = new Ledger(defaultChart(), "IDR");
    const snap = demo().snapshot();
    const first = journalizeSnapshot(l, snap, OPT);
    const count = l.entries().length;
    const tb1 = trialBalance(l, "2026-11-30");
    const second = journalizeSnapshot(l, snap, OPT);
    expect(first.applied).toBe(count);
    expect(second.applied).toBe(0);
    expect(second.duplicates).toBe(count);
    expect(l.entries()).toHaveLength(count);
    expect(d(trialBalance(l, "2026-11-30").totalDebit)).toBe(d(tb1.totalDebit));
  });

  it("every journal reuses the book's idempotency keys", () => {
    const l = new Ledger(defaultChart(), "IDR");
    journalizeSnapshot(l, demo().snapshot(), OPT);
    const keys = l.entries().map((e) => e.sourceKey);
    expect(keys).toContain("payment|midtrans|p1");
    expect(keys).toContain("refund|midtrans|r1");
    expect(keys).toContain("settlement|midtrans|s1");
    expect(keys).toContain("expense|e1");
    expect(keys).toContain("recognition|2026-11");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cross-checks lib/finance: revenue, deferred revenue, cash and balance", () => {
    const l = new Ledger(defaultChart(), "IDR");
    const snap = demo().snapshot();
    journalizeSnapshot(l, snap, OPT);
    const s = summarize(snap, NOV, { lateAfterDays: 3 });
    const is = incomeStatement(l, NOV);
    // Revenue after refunds equals recognised net revenue.
    expect(d(is.totalRevenue)).toBe(d(recognizedRevenue(snap, NOV).recognizedNet));
    expect(d(is.totalExpenses)).toBe(d(s.operatingExpenses.minor === BigInt(0) ? s.gatewayFees : { minor: s.gatewayFees.minor + s.operatingExpenses.minor, currency: "IDR" }));
    expect(d(is.netIncome)).toBe(d(s.simplePnl.operatingResult));
    const bs = balanceSheet(l, "2026-11-30");
    expect(bs.balanced).toBe(true);
    expect(d(bs.liabilities.find((x) => x.code === "2120")!.amount)).toBe(d(s.deferredAtEnd));
    const cash = bs.assets.find((x) => x.code === "1110")!.amount;
    expect(d(cash)).toBe(d({ minor: s.settledNet.minor - s.operatingExpenses.minor, currency: "IDR" }));
    expect(cashFlowStatement(l, NOV).reconciled).toBe(true);
  });

  it("partial refund reduces deferred value first; full refund leaves zero revenue", () => {
    const part = newBook();
    part.ingestPayment(payment("p1"));
    part.ingestRefund(refund("r1", "p1", "100000", { processedAt: "2026-11-10T03:00:00Z" }));
    const l = new Ledger(defaultChart(), "IDR");
    journalizeSnapshot(l, part.snapshot(), OPT);
    expect(d(incomeStatement(l, NOV).totalRevenue)).toBe(d(recognizedRevenue(part.snapshot(), NOV).recognizedNet));
    expect(balanceSheet(l, "2026-11-30").balanced).toBe(true);

    const full = newBook();
    full.ingestPayment(payment("p1"));
    full.ingestRefund(refund("r1", "p1", "300000", { processedAt: "2026-11-02T03:00:00Z" }));
    const l2 = new Ledger(defaultChart(), "IDR");
    journalizeSnapshot(l2, full.snapshot(), { ...OPT, through: "2026-12-31" });
    const bs = balanceSheet(l2, "2026-12-31");
    expect(bs.balanced).toBe(true);
    expect(bs.liabilities.find((x) => x.code === "2120")).toBeUndefined();
    expect(d(incomeStatement(l2, { from: "2026-11-01", to: "2026-12-31" }).totalRevenue)).toBe("0.00");
  });

  it("over-refund is capped by the finance module and never journalised beyond the payment", () => {
    const b = newBook();
    b.ingestPayment(payment("p1"));
    b.ingestRefund(refund("r1", "p1", "250000", { processedAt: "2026-11-02T03:00:00Z" }));
    b.ingestRefund(refund("r2", "p1", "250000", { processedAt: "2026-11-03T03:00:00Z" }));
    const l = new Ledger(defaultChart(), "IDR");
    journalizeSnapshot(l, b.snapshot(), OPT);
    const refunded = l.entries().filter((e) => e.sourceKey.startsWith("refund|")).reduce((n, e) => n + e.lines[0].debit.minor, BigInt(0));
    expect(refunded).toBe(BigInt(30000000));
  });

  it("a voided expense that was already journalised is reversed, not deleted", () => {
    const l = new Ledger(defaultChart(), "IDR");
    const b = newBook();
    b.ingestExpense(expense("e1", "2026-11-10", "100000"));
    journalizeSnapshot(l, b.snapshot(), OPT);
    b.ingestExpense(expense("e1", "2026-11-10", "100000", { isVoid: true }));
    const r = journalizeSnapshot(l, b.snapshot(), OPT);
    expect(r.reversed).toBe(1);
    expect(l.entries().filter((e) => e.type === "REVERSAL")).toHaveLength(1);
    expect(d(incomeStatement(l, NOV).totalExpenses)).toBe("0.00");
    expect(journalizeSnapshot(l, b.snapshot(), OPT).reversed).toBe(0);
  });

  it("a changed fact is reported as a conflict, not silently overwritten", () => {
    const l = new Ledger(defaultChart(), "IDR");
    const a = newBook();
    a.ingestPayment(payment("p1"));
    a.ingestRefund(refund("r1", "p1", "50000", { processedAt: "2026-11-10T03:00:00Z" }));
    journalizeSnapshot(l, a.snapshot(), OPT);
    const b = newBook();
    b.ingestPayment(payment("p1"));
    b.ingestRefund(refund("r1", "p1", "50000", { processedAt: "2026-11-10T03:00:00Z" }));
    b.ingestRefund(refund("r2", "p1", "20000", { processedAt: "2026-11-11T03:00:00Z" }));
    const r = journalizeSnapshot(l, b.snapshot(), OPT);
    expect(r.conflicts).toContain("recognition|2026-11");
  });

  it("creates no opening balance: with no data the ledger is empty", () => {
    const l = new Ledger(defaultChart(), "IDR");
    journalizeSnapshot(l, newBook().snapshot(), OPT);
    expect(l.entries()).toHaveLength(0);
  });

  it("closing a period blocks a later re-run from rewriting it", () => {
    const l = new Ledger(defaultChart(), "IDR");
    const snap = demo().snapshot();
    journalizeSnapshot(l, snap, OPT);
    l.closePeriod("2026-11", "u", AT);
    expect(() => {
      const extra = newBook();
      extra.ingestPayment(payment("p9", { paidAt: "2026-11-15T03:00:00Z" }));
      journalizeSnapshot(l, extra.snapshot(), OPT);
    }).toThrow();
  });
});

describe("receivables and payables", () => {
  const cur = "IDR";
  const item = { id: "inv-1", kind: "RECEIVABLE" as const, party: "PT A", reference: "INV-1", issueDate: "2026-09-01", dueDate: "2026-09-30", amount: idr("1000") };

  it("aging buckets, partial payment, duplicate and overpayment protection", () => {
    expect(bucketFor("2026-09-30", "2026-09-30")).toBe("CURRENT");
    expect(bucketFor("2026-09-30", "2026-10-15")).toBe("D1_30");
    expect(bucketFor("2026-09-30", "2026-11-15")).toBe("D31_60");
    expect(bucketFor("2026-09-30", "2026-12-15")).toBe("D61_90");
    expect(bucketFor("2026-09-30", "2027-02-01")).toBe("OVER_90");
    const b = new OpenItemBook(cur);
    expect(b.addItem(item)).toBe("APPLIED");
    expect(b.addItem(item)).toBe("DUPLICATE");
    expect(() => b.addItem({ ...item, amount: idr("5") })).toThrow(OpenItemError);
    expect(b.applyPayment({ id: "pay-1", itemId: "inv-1", date: "2026-10-05", amount: idr("400") })).toBe("APPLIED");
    expect(b.applyPayment({ id: "pay-1", itemId: "inv-1", date: "2026-10-05", amount: idr("400") })).toBe("DUPLICATE");
    expect(() => b.applyPayment({ id: "pay-2", itemId: "inv-1", date: "2026-10-06", amount: idr("700") })).toThrow(OpenItemError);
    const aging = b.aging("RECEIVABLE", "2026-10-15");
    expect(d(aging.total)).toBe("600.00");
    expect(d(aging.buckets.D1_30)).toBe("600.00");
  });

  it("sub-ledger reconciles with the GL control account; a mismatch is visible", () => {
    const l = new Ledger(defaultChart(), cur);
    const b = new OpenItemBook(cur);
    b.addItem(item);
    const post = (key: string, lines: JournalDraft["lines"]) => l.post({ sourceKey: key, date: "2026-09-01", reference: key, description: key, type: "NORMAL", lines }, "u", AT);
    expect(reconcileControl(l, b, "RECEIVABLE", "2026-09-30").reconciled).toBe(false);
    post("inv-1", [{ account: "1210", debit: idr("1000") }, { account: "4100", credit: idr("1000") }]);
    const rc = reconcileControl(l, b, "RECEIVABLE", "2026-09-30");
    expect(rc.reconciled).toBe(true);
    expect(d(rc.difference)).toBe("0.00");
  });
});

describe("bank reconciliation", () => {
  const cur = "IDR";
  const mkLedger = () => {
    const l = new Ledger(defaultChart(), cur);
    l.post({ sourceKey: "a", date: "2026-11-04", reference: "midtrans:s1", description: "payout", type: "NORMAL", lines: [{ account: "1110", debit: idr("296000") }, { account: "1120", credit: idr("296000") }] }, "u", AT);
    l.post({ sourceKey: "b", date: "2026-11-10", reference: "RCPT-1", description: "hosting", type: "NORMAL", lines: [{ account: "6100", debit: idr("100000") }, { account: "1110", credit: idr("100000") }] }, "u", AT);
    return l;
  };

  it("matches one-to-one by reference+amount and explains the rest", () => {
    const r = reconcileBank(
      mkLedger(),
      { asOf: "2026-11-30", balance: idr("196000"), lines: [
        { id: "b1", date: "2026-11-05", reference: "midtrans:s1", amount: idr("296000") },
        { id: "b2", date: "2026-11-11", reference: "BANK-9", amount: idr("-100000") },
      ] },
      { windowDays: 3, finalizedBy: "founder" },
    );
    expect(r.matches).toHaveLength(2);
    expect(r.reconciled).toBe(true);
    expect(r.final).toBe(true);
  });

  it("is not final without a finaliser, and unexplained differences stay visible", () => {
    const ok = reconcileBank(mkLedger(), { asOf: "2026-11-30", balance: idr("196000"), lines: [
      { id: "b1", date: "2026-11-04", reference: "x", amount: idr("296000") },
      { id: "b2", date: "2026-11-10", reference: "y", amount: idr("-100000") },
    ] }, { windowDays: 1 });
    expect(ok.reconciled).toBe(true);
    expect(ok.final).toBe(false);

    const bad = reconcileBank(mkLedger(), { asOf: "2026-11-30", balance: idr("190000"), lines: [
      { id: "b1", date: "2026-11-04", reference: "x", amount: idr("296000") },
      { id: "b2", date: "2026-11-10", reference: "y", amount: idr("-100000") },
    ] }, { windowDays: 1, finalizedBy: "founder" });
    expect(bad.reconciled).toBe(false);
    expect(bad.final).toBe(false);
    expect(d(bad.unexplainedDifference)).toBe("-6000.00");
  });

  it("never matches one GL line twice", () => {
    const r = reconcileBank(mkLedger(), { asOf: "2026-11-30", balance: idr("592000"), lines: [
      { id: "b1", date: "2026-11-04", reference: "midtrans:s1", amount: idr("296000") },
      { id: "b2", date: "2026-11-04", reference: "midtrans:s1", amount: idr("296000") },
    ] }, { windowDays: 3 });
    expect(r.matches).toHaveLength(1);
    expect(r.unmatchedBank).toHaveLength(1);
  });
});
