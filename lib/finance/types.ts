import type { Money } from "./money";

/**
 * LINOE finance domain types.
 *
 * Four things that look similar but are NOT the same, and are never merged:
 *   1. Verified payment   - the gateway confirmed it (webhook) and we recorded it.
 *   2. Recognised revenue - the part of a payment earned over its service period.
 *   3. Settled funds      - money the gateway actually paid out to the bank.
 *   4. Refunds and gateway fees - reductions, tracked separately.
 */

export type PaymentVerification = {
  readonly source: "PROVIDER_WEBHOOK";
  /** Id of the processed `prompter_webhook_events` row that confirmed the payment. */
  readonly webhookEventId: string;
};

export interface VerifiedPayment {
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly tenantId: string | null;
  /** Invoice / order the payment is for, used to spot a customer paying twice. */
  readonly invoiceRef: string | null;
  readonly amount: Money;
  /** ISO-8601 instant the gateway reported the payment as paid. */
  readonly paidAt: string;
  /** Service period the payment buys, `YYYY-MM-DD`, both ends inclusive. */
  readonly servicePeriodStart: string;
  readonly servicePeriodEnd: string;
  readonly verification: PaymentVerification;
}

export type RefundStatus = "REQUESTED" | "APPROVED" | "PROCESSED" | "FAILED";

export interface Refund {
  readonly provider: string;
  readonly providerRefundId: string;
  readonly providerPaymentId: string;
  readonly amount: Money;
  readonly status: RefundStatus;
  /** ISO-8601 instant the refund was processed (required when PROCESSED). */
  readonly processedAt: string | null;
  readonly reason: string | null;
}

export interface GatewayFee {
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly amount: Money;
  readonly source: "WEBHOOK" | "SETTLEMENT_REPORT" | "MANUAL";
}

export interface SettlementItem {
  readonly providerPaymentId: string;
  readonly grossAmount: Money;
  readonly feeAmount: Money;
}

export interface Settlement {
  readonly provider: string;
  readonly providerSettlementId: string;
  /** ISO-8601 instant the funds were paid out / credited. */
  readonly settledAt: string;
  readonly grossAmount: Money;
  readonly feeAmount: Money;
  /** Refunds the gateway netted off this payout. */
  readonly refundDeducted: Money;
  /** Net amount as REPORTED by the gateway. Never assumed to equal gross - fee - refund. */
  readonly netAmount: Money;
  readonly items: readonly SettlementItem[];
}

export interface OperatingExpense {
  readonly id: string;
  /** Local calendar date the expense was incurred/paid, `YYYY-MM-DD`. */
  readonly date: string;
  readonly category: string;
  readonly vendor: string | null;
  readonly amount: Money;
  /** Input tax shown on the receipt, informational only. */
  readonly taxAmount: Money | null;
  /** Reference to the stored proof of transaction (receipt/invoice). */
  readonly receiptRef: string | null;
  readonly isVoid: boolean;
}

export type LedgerEntryType = "PAYMENT_VERIFIED" | "REFUND" | "GATEWAY_FEE" | "SETTLEMENT" | "EXPENSE";

export interface LedgerEntry {
  readonly idempotencyKey: string;
  readonly type: LedgerEntryType;
  readonly direction: "IN" | "OUT";
  readonly amount: Money;
  /** ISO-8601 instant, or `YYYY-MM-DD` for date-only facts such as expenses. */
  readonly effectiveAt: string;
  readonly provider: string | null;
  readonly providerRef: string | null;
}

export type AnomalyCode =
  | "DUPLICATE_PAYMENT_FOR_INVOICE"
  | "OVER_REFUND"
  | "REFUND_FOR_UNKNOWN_PAYMENT"
  | "FEE_FOR_UNKNOWN_PAYMENT"
  | "SETTLEMENT_ITEM_UNKNOWN_PAYMENT"
  | "SETTLEMENT_AMOUNT_MISMATCH"
  | "SETTLEMENT_TOTAL_MISMATCH"
  | "SETTLEMENT_NET_MISMATCH"
  | "PAYMENT_SETTLED_TWICE";

export interface Anomaly {
  readonly code: AnomalyCode;
  readonly detail: string;
  readonly refs: readonly string[];
}
