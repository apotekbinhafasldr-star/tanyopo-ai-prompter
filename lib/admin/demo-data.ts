import {
  FinanceBook,
  UNVERIFIED_TAX_CONFIG,
  money,
  summarize,
  turnoverRecap,
  type PeriodSummary,
  type TurnoverRecap,
} from "@/lib/finance";
import type { Permission } from "@/lib/admin/permissions";

/**
 * DEMO DATA ONLY. Everything here is fictional and fixed in source: no database,
 * no production record, no real customer, no real amount. It exists so the Admin
 * Center can be reviewed before the finance migration is approved and applied.
 * Every screen that shows it must render <DemoBanner />.
 */

export const DEMO_LABEL = "DATA DEMO — contoh fiktif, bukan data produksi";
export const DEMO_PERIOD = { from: "2026-11-01", to: "2026-11-30" } as const;
/** Illustrative only; the real value will be set from the gateway's documented payout time. */
export const DEMO_LATE_AFTER_DAYS = 3;

const IDR = "IDR";
const idr = (n: string) => money(n, IDR);

function pay(
  id: string,
  amount: string,
  paidAt: string,
  start: string,
  end: string,
  invoiceRef = `DEMO-INV-${id}`,
) {
  return {
    provider: "demo",
    providerPaymentId: id,
    tenantId: "demo-tenant",
    invoiceRef,
    amount: idr(amount),
    paidAt,
    servicePeriodStart: start,
    servicePeriodEnd: end,
    verification: { source: "PROVIDER_WEBHOOK" as const, webhookEventId: `DEMO-EVT-${id}` },
  };
}

export function buildDemoBook(): FinanceBook {
  const book = new FinanceBook(IDR);

  book.ingestPayment(pay("DEMO-PAY-001", "300000", "2026-11-01T03:00:00Z", "2026-11-01", "2026-11-30"));
  book.ingestPayment(pay("DEMO-PAY-002", "150000", "2026-11-05T03:00:00Z", "2026-11-05", "2026-12-04"));
  book.ingestPayment(pay("DEMO-PAY-003", "300000", "2026-11-12T03:00:00Z", "2026-11-12", "2026-12-11"));
  book.ingestPayment(pay("DEMO-PAY-004", "300000", "2026-11-28T03:00:00Z", "2026-11-28", "2026-12-27"));
  book.ingestPayment(pay("DEMO-PAY-005", "300000", "2026-11-15T03:00:00Z", "2026-11-15", "2026-12-14"));
  // Same invoice paid twice: an anomaly the dashboard should surface.
  book.ingestPayment(pay("DEMO-PAY-006", "150000", "2026-11-06T03:00:00Z", "2026-11-05", "2026-12-04", "DEMO-INV-DEMO-PAY-002"));

  for (const [id, fee] of [
    ["DEMO-PAY-001", "4000"],
    ["DEMO-PAY-002", "2500"],
    ["DEMO-PAY-003", "4000"],
    ["DEMO-PAY-004", "4000"],
    ["DEMO-PAY-005", "4000"],
    ["DEMO-PAY-006", "2500"],
  ] as const) {
    book.ingestGatewayFee({ provider: "demo", providerPaymentId: id, amount: idr(fee), source: "SETTLEMENT_REPORT" });
  }

  const settle = (
    id: string,
    at: string,
    items: Array<{ p: string; gross: string; fee: string }>,
  ) => {
    const gross = items.reduce((n, i) => n + Number(i.gross), 0);
    const fee = items.reduce((n, i) => n + Number(i.fee), 0);
    book.ingestSettlement({
      provider: "demo",
      providerSettlementId: id,
      settledAt: at,
      grossAmount: idr(String(gross)),
      feeAmount: idr(String(fee)),
      refundDeducted: idr("0"),
      netAmount: idr(String(gross - fee)),
      items: items.map((i) => ({ providerPaymentId: i.p, grossAmount: idr(i.gross), feeAmount: idr(i.fee) })),
    });
  };
  settle("DEMO-SET-001", "2026-11-04T03:00:00Z", [{ p: "DEMO-PAY-001", gross: "300000", fee: "4000" }]);
  settle("DEMO-SET-002", "2026-11-09T03:00:00Z", [{ p: "DEMO-PAY-002", gross: "150000", fee: "2500" }]);
  // The gateway listed 290,000 for a 300,000 payment: a mismatch to investigate.
  settle("DEMO-SET-003", "2026-11-18T03:00:00Z", [{ p: "DEMO-PAY-005", gross: "290000", fee: "4000" }]);

  book.ingestRefund({
    provider: "demo",
    providerRefundId: "DEMO-REF-001",
    providerPaymentId: "DEMO-PAY-004",
    amount: idr("100000"),
    status: "PROCESSED",
    processedAt: "2026-11-29T03:00:00Z",
    reason: "Contoh refund sebagian",
  });

  book.ingestExpense({ id: "DEMO-EXP-001", date: "2026-11-03", category: "Hosting", vendor: "Vendor Demo A", amount: idr("450000"), taxAmount: null, receiptRef: null, isVoid: false });
  book.ingestExpense({ id: "DEMO-EXP-002", date: "2026-11-10", category: "API AI", vendor: "Vendor Demo B", amount: idr("1250000"), taxAmount: null, receiptRef: null, isVoid: false });
  book.ingestExpense({ id: "DEMO-EXP-003", date: "2026-11-11", category: "Lain-lain", vendor: "Vendor Demo C", amount: idr("99000"), taxAmount: null, receiptRef: null, isVoid: true });

  return book;
}

export interface DemoFinance {
  readonly summary: PeriodSummary;
  readonly recap: TurnoverRecap;
}

export function buildDemoFinance(): DemoFinance {
  const snapshot = buildDemoBook().snapshot();
  return {
    summary: summarize(snapshot, DEMO_PERIOD, { lateAfterDays: DEMO_LATE_AFTER_DAYS }),
    // Tax configuration is deliberately UNVERIFIED in the demo: no rate is shown anywhere.
    recap: turnoverRecap(snapshot, "2026", UNVERIFIED_TAX_CONFIG),
  };
}

export interface DemoStaffMember {
  readonly name: string;
  readonly title: string;
  readonly role: "SUPER_ADMIN" | "STAFF";
  readonly isActive: boolean;
  readonly permissions: readonly Permission[];
}

export const DEMO_STAFF: readonly DemoStaffMember[] = [
  {
    name: "Founder (contoh)",
    title: "Super Admin",
    role: "SUPER_ADMIN",
    isActive: true,
    permissions: [],
  },
  {
    name: "Staf Demo A",
    title: "Staf keuangan",
    role: "STAFF",
    isActive: true,
    permissions: ["finance.view", "finance.export", "tax.view"],
  },
  {
    name: "Staf Demo B",
    title: "Staf operasional",
    role: "STAFF",
    isActive: true,
    permissions: ["finance.view"],
  },
  {
    name: "Staf Demo C",
    title: "Staf nonaktif",
    role: "STAFF",
    isActive: false,
    permissions: [],
  },
];

export const PERMISSION_LABELS: Record<Permission, { label: string; sensitive: boolean }> = {
  "admin.overview": { label: "Melihat ringkasan Admin Center", sensitive: false },
  "finance.view": { label: "Melihat dashboard keuangan", sensitive: false },
  "finance.export": { label: "Mengekspor laporan CSV", sensitive: false },
  "finance.expense.write": { label: "Mencatat / membatalkan pengeluaran", sensitive: false },
  "finance.settlement.import": { label: "Mengimpor laporan settlement", sensitive: true },
  "tax.view": { label: "Melihat rekap pajak", sensitive: false },
  "tax.manage": { label: "Mengubah konfigurasi pajak", sensitive: true },
  "refund.approve": { label: "Menyetujui refund", sensitive: true },
  "bank.manage": { label: "Mengubah rekening perusahaan", sensitive: true },
  "staff.view": { label: "Melihat hak akses staf", sensitive: false },
  "staff.manage": { label: "Mengatur hak akses staf (khusus Super Admin)", sensitive: true },
};
