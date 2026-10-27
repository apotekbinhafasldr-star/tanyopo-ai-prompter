import {
  Ledger,
  defaultChart,
  journalizeSnapshot,
  type BankLine,
} from "@/lib/accounting";
import { money, type FinanceSnapshot } from "@/lib/finance";
import { buildDemoBook } from "@/lib/admin/demo-data";

/**
 * DEMO ONLY. Extends the fixed November demo with fictional September and October
 * activity so trends, period filters and the accounting reports can be reviewed. Nothing
 * here touches a database, a customer or a real amount. No opening balance is invented:
 * the demo cash balance is simply what the demo transactions produce.
 */
const idr = (n: string) => money(n, "IDR");
export const DEMO_MONTHS = ["2026-09", "2026-10", "2026-11"] as const;
export const DEMO_YEAR = "2026";
export const DEMO_TODAY = "2026-11-30";
const DEMO_POSTED_AT = "2026-12-01T00:00:00Z";

export function buildDemoYearSnapshot(): FinanceSnapshot {
  const book = buildDemoBook();
  const pay = (id: string, amount: string, paidAt: string, start: string, end: string) =>
    book.ingestPayment({
      provider: "demo",
      providerPaymentId: id,
      tenantId: "demo-tenant",
      invoiceRef: `DEMO-INV-${id}`,
      amount: idr(amount),
      paidAt,
      servicePeriodStart: start,
      servicePeriodEnd: end,
      verification: { source: "PROVIDER_WEBHOOK", webhookEventId: `DEMO-EVT-${id}` },
    });
  // Service periods end by 31 Oct so the fixed November figures are unchanged.
  pay("DEMO-PAY-S01", "300000", "2026-09-03T03:00:00Z", "2026-09-03", "2026-10-02");
  pay("DEMO-PAY-S02", "150000", "2026-09-15T03:00:00Z", "2026-09-15", "2026-10-14");
  pay("DEMO-PAY-O01", "300000", "2026-10-02T03:00:00Z", "2026-10-02", "2026-10-31");
  pay("DEMO-PAY-O02", "300000", "2026-10-12T03:00:00Z", "2026-10-12", "2026-10-31");
  pay("DEMO-PAY-O03", "150000", "2026-10-20T03:00:00Z", "2026-10-20", "2026-10-31");
  for (const [id, fee] of [["DEMO-PAY-S01", "4000"], ["DEMO-PAY-S02", "2500"], ["DEMO-PAY-O01", "4000"], ["DEMO-PAY-O02", "4000"], ["DEMO-PAY-O03", "2500"]] as const) {
    book.ingestGatewayFee({ provider: "demo", providerPaymentId: id, amount: idr(fee), source: "SETTLEMENT_REPORT" });
  }
  const settle = (id: string, at: string, items: Array<{ p: string; gross: string; fee: string }>) => {
    const gross = items.reduce((n, i) => n + Number(i.gross), 0);
    const fee = items.reduce((n, i) => n + Number(i.fee), 0);
    book.ingestSettlement({
      provider: "demo", providerSettlementId: id, settledAt: at,
      grossAmount: idr(String(gross)), feeAmount: idr(String(fee)), refundDeducted: idr("0"), netAmount: idr(String(gross - fee)),
      items: items.map((i) => ({ providerPaymentId: i.p, grossAmount: idr(i.gross), feeAmount: idr(i.fee) })),
    });
  };
  settle("DEMO-SET-S01", "2026-09-18T03:00:00Z", [{ p: "DEMO-PAY-S01", gross: "300000", fee: "4000" }, { p: "DEMO-PAY-S02", gross: "150000", fee: "2500" }]);
  settle("DEMO-SET-O01", "2026-10-15T03:00:00Z", [{ p: "DEMO-PAY-O01", gross: "300000", fee: "4000" }, { p: "DEMO-PAY-O02", gross: "300000", fee: "4000" }]);
  settle("DEMO-SET-O02", "2026-10-26T03:00:00Z", [{ p: "DEMO-PAY-O03", gross: "150000", fee: "2500" }]);
  book.ingestRefund({
    provider: "demo", providerRefundId: "DEMO-REF-002", providerPaymentId: "DEMO-PAY-O01", amount: idr("30000"),
    status: "PROCESSED", processedAt: "2026-10-20T03:00:00Z", reason: "Contoh refund sebagian (Okt)",
  });
  const exp = (id: string, date: string, category: string, amount: string) =>
    book.ingestExpense({ id, date, category, vendor: "Vendor Demo", amount: idr(amount), taxAmount: null, receiptRef: `DEMO-RCPT-${id}`, isVoid: false });
  exp("DEMO-EXP-S01", "2026-09-05", "Hosting", "400000");
  exp("DEMO-EXP-S02", "2026-09-12", "API AI", "700000");
  exp("DEMO-EXP-O01", "2026-10-05", "Hosting", "420000");
  exp("DEMO-EXP-O02", "2026-10-11", "API AI", "950000");
  return book.snapshot();
}

export interface DemoAccounting {
  readonly snapshot: FinanceSnapshot;
  readonly ledger: Ledger;
  readonly bankStatement: { asOf: string; balance: ReturnType<typeof idr>; lines: BankLine[] };
}

export function buildDemoAccounting(): DemoAccounting {
  const snapshot = buildDemoYearSnapshot();
  const ledger = new Ledger(defaultChart(), "IDR");
  // FICTIONAL demo capital so the demo balance sheet has an equity section. Real books get an
  // opening balance only from a journal with verified evidence (bank statement); none is invented.
  ledger.post(
    {
      sourceKey: "opening|demo-capital",
      date: "2026-09-01",
      reference: "DEMO-MODAL",
      description: "Modal disetor (DEMO fiktif)",
      type: "OPENING",
      evidence: "DATA DEMO — fiktif, bukan saldo nyata",
      lines: [{ account: "1110", debit: idr("10000000") }, { account: "3100", credit: idr("10000000") }],
    },
    "demo-system",
    DEMO_POSTED_AT,
  );
  journalizeSnapshot(ledger, snapshot, { actor: "demo-system", at: DEMO_POSTED_AT, through: DEMO_TODAY });

  // Demo bank statement: mirrors every settlement and expense, plus one bank charge the books
  // do not know about yet. It shows an UNEXPLAINED difference, so the reconciliation is not final.
  const lines: BankLine[] = [
    { id: "BANK-DEMO-MODAL", date: "2026-09-01", reference: "DEMO-MODAL", amount: idr("10000000") },
    ...snapshot.settlements.map((s) => ({ id: `BANK-${s.providerSettlementId}`, date: s.settledAt.slice(0, 10), reference: `${s.provider}:${s.providerSettlementId}`, amount: s.netAmount })),
    ...snapshot.expenses.filter((e) => !e.isVoid).map((e) => ({ id: `BANK-${e.id}`, date: e.date, reference: e.receiptRef ?? e.id, amount: { minor: -e.amount.minor, currency: "IDR" } })),
    { id: "BANK-ADM-NOV", date: "2026-11-30", reference: "BIAYA ADMIN BANK", amount: idr("-6500") },
  ];
  const total = lines.reduce((n, l) => n + l.amount.minor, BigInt(0));
  return { snapshot, ledger, bankStatement: { asOf: DEMO_TODAY, balance: { minor: total, currency: "IDR" }, lines } };
}

import { incomeStatement, reconcileFiscal, type FiscalReconciliation } from "@/lib/accounting";

/** Fictional fiscal inputs: one verified positive correction, one still pending, tax rate NOT verified. */
export function buildDemoFiscal(ledger: Ledger): FiscalReconciliation {
  const is = incomeStatement(ledger, { from: `${DEMO_YEAR}-01-01`, to: DEMO_TODAY });
  const adj = (id: string, direction: "POSITIVE" | "NEGATIVE", amount: string, verified: boolean, description: string) => ({
    id, direction, nature: "PERMANENT" as const, description, amount: idr(amount), evidenceRef: null,
    verifiedBy: verified ? "Akuntan Demo (fiktif)" : null, verifiedAt: verified ? "2026-12-01T00:00:00Z" : null,
  });
  return reconcileFiscal({
    year: DEMO_YEAR,
    commercialProfit: is.netIncome,
    adjustments: [
      adj("DEMO-FA-1", "POSITIVE", "100000", true, "Contoh koreksi positif (fiktif)"),
      adj("DEMO-FA-2", "NEGATIVE", "250000", false, "Contoh koreksi negatif belum diverifikasi"),
    ],
    lossCarryforward: null,
    config: { rateBps: null, verifiedBy: null, verifiedAt: null },
  });
}
