import {
  FinanceBook,
  money,
  toDecimalString,
  type GatewayFee,
  type Money,
  type OperatingExpense,
  type Refund,
  type Settlement,
  type VerifiedPayment,
} from "@/lib/finance";

export const IDR = "IDR";
export const idr = (amount: string | number): Money => money(amount, IDR);
export const d = (m: Money): string => toDecimalString(m);

/** 300,000 for November 2026 (30 days => exactly 10,000 a day). Paid 1 Nov 10:00 WIB. */
export function payment(id = "pay_1", overrides: Partial<VerifiedPayment> = {}): VerifiedPayment {
  return {
    provider: "midtrans",
    providerPaymentId: id,
    tenantId: "tenant-1",
    invoiceRef: `inv_${id}`,
    amount: idr("300000"),
    paidAt: "2026-11-01T03:00:00Z",
    servicePeriodStart: "2026-11-01",
    servicePeriodEnd: "2026-11-30",
    verification: { source: "PROVIDER_WEBHOOK", webhookEventId: `evt_${id}` },
    ...overrides,
  };
}

export function refund(id: string, paymentId: string, amount: string, overrides: Partial<Refund> = {}): Refund {
  return {
    provider: "midtrans",
    providerRefundId: id,
    providerPaymentId: paymentId,
    amount: idr(amount),
    status: "PROCESSED",
    processedAt: "2026-11-20T03:00:00Z",
    reason: null,
    ...overrides,
  };
}

export function fee(paymentId: string, amount: string): GatewayFee {
  return { provider: "midtrans", providerPaymentId: paymentId, amount: idr(amount), source: "SETTLEMENT_REPORT" };
}

export function settlement(
  id: string,
  settledAt: string,
  items: Array<{ paymentId: string; gross: string; fee: string }>,
  overrides: Partial<Settlement> = {},
): Settlement {
  const gross = items.reduce((n, i) => n + Number(i.gross), 0);
  const feeTotal = items.reduce((n, i) => n + Number(i.fee), 0);
  return {
    provider: "midtrans",
    providerSettlementId: id,
    settledAt,
    grossAmount: idr(String(gross)),
    feeAmount: idr(String(feeTotal)),
    refundDeducted: idr("0"),
    netAmount: idr(String(gross - feeTotal)),
    items: items.map((i) => ({ providerPaymentId: i.paymentId, grossAmount: idr(i.gross), feeAmount: idr(i.fee) })),
    ...overrides,
  };
}

export function expense(id: string, date: string, amount: string, overrides: Partial<OperatingExpense> = {}): OperatingExpense {
  return {
    id,
    date,
    category: "hosting",
    vendor: "Vendor",
    amount: idr(amount),
    taxAmount: null,
    receiptRef: null,
    isVoid: false,
    ...overrides,
  };
}

export function newBook(): FinanceBook {
  return new FinanceBook(IDR);
}
