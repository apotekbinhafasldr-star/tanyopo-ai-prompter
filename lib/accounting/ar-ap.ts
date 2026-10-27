import { assertDate, daysBetween } from "@/lib/finance/dates";
import { add, compare, isPositive, sub, zero, type Money } from "@/lib/finance/money";
import type { Ledger } from "./ledger";

export type OpenItemKind = "RECEIVABLE" | "PAYABLE";
export type AgingBucket = "CURRENT" | "D1_30" | "D31_60" | "D61_90" | "OVER_90";

export interface OpenItem {
  readonly id: string;
  readonly kind: OpenItemKind;
  readonly party: string;
  readonly reference: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly amount: Money;
}
export interface ItemPayment {
  /** Unique id; applying the same payment id twice is a no-op. */
  readonly id: string;
  readonly itemId: string;
  readonly date: string;
  readonly amount: Money;
}

export class OpenItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenItemError";
  }
}

export function bucketFor(dueDate: string, asOf: string): AgingBucket {
  const late = daysBetween(dueDate, asOf);
  if (late <= 0) return "CURRENT";
  if (late <= 30) return "D1_30";
  if (late <= 60) return "D31_60";
  if (late <= 90) return "D61_90";
  return "OVER_90";
}

/** Sub-ledger of receivables and payables. Money only; the GL entry is posted separately. */
export class OpenItemBook {
  readonly currency: string;
  private readonly items = new Map<string, OpenItem>();
  private readonly payments = new Map<string, ItemPayment>();

  constructor(currency: string) {
    this.currency = currency;
  }

  addItem(item: OpenItem): "APPLIED" | "DUPLICATE" {
    assertDate(item.issueDate);
    assertDate(item.dueDate);
    if (!isPositive(item.amount) || item.amount.currency !== this.currency) throw new OpenItemError("Item amount must be positive, in book currency");
    if (!item.reference.trim() || !item.party.trim()) throw new OpenItemError("Item needs a party and a reference");
    if (item.dueDate < item.issueDate) throw new OpenItemError("Due date is before issue date");
    const prior = this.items.get(item.id);
    if (prior) {
      if (prior.amount.minor === item.amount.minor && prior.reference === item.reference && prior.kind === item.kind) return "DUPLICATE";
      throw new OpenItemError(`Item ${item.id} already exists with different content`);
    }
    this.items.set(item.id, item);
    return "APPLIED";
  }

  applyPayment(payment: ItemPayment): "APPLIED" | "DUPLICATE" {
    assertDate(payment.date);
    const item = this.items.get(payment.itemId);
    if (!item) throw new OpenItemError(`Unknown item ${payment.itemId}`);
    if (!isPositive(payment.amount) || payment.amount.currency !== this.currency) throw new OpenItemError("Payment must be positive, in book currency");
    const prior = this.payments.get(payment.id);
    if (prior) {
      if (prior.itemId === payment.itemId && prior.amount.minor === payment.amount.minor && prior.date === payment.date) return "DUPLICATE";
      throw new OpenItemError(`Payment ${payment.id} already exists with different content`);
    }
    if (compare(payment.amount, this.outstanding(payment.itemId)) > 0) throw new OpenItemError("Payment exceeds the outstanding amount");
    this.payments.set(payment.id, payment);
    return "APPLIED";
  }

  outstanding(itemId: string, asOf?: string): Money {
    const item = this.items.get(itemId);
    if (!item) throw new OpenItemError(`Unknown item ${itemId}`);
    let paid = zero(this.currency);
    for (const p of this.payments.values()) {
      if (p.itemId === itemId && (asOf === undefined || p.date <= asOf)) paid = add(paid, p.amount);
    }
    return sub(item.amount, paid);
  }

  aging(kind: OpenItemKind, asOf: string): { buckets: Record<AgingBucket, Money>; total: Money; rows: Array<{ item: OpenItem; outstanding: Money; bucket: AgingBucket }> } {
    const buckets: Record<AgingBucket, Money> = {
      CURRENT: zero(this.currency),
      D1_30: zero(this.currency),
      D31_60: zero(this.currency),
      D61_90: zero(this.currency),
      OVER_90: zero(this.currency),
    };
    const rows: Array<{ item: OpenItem; outstanding: Money; bucket: AgingBucket }> = [];
    let total = zero(this.currency);
    for (const item of this.items.values()) {
      if (item.kind !== kind || item.issueDate > asOf) continue;
      const outstanding = this.outstanding(item.id, asOf);
      if (!isPositive(outstanding)) continue;
      const bucket = bucketFor(item.dueDate, asOf);
      buckets[bucket] = add(buckets[bucket], outstanding);
      total = add(total, outstanding);
      rows.push({ item, outstanding, bucket });
    }
    return { buckets, total, rows };
  }
}

export interface ControlReconciliation {
  readonly subledger: Money;
  readonly glBalance: Money;
  readonly difference: Money;
  readonly reconciled: boolean;
}

/** Compares the sub-ledger total against the GL control account (1210 receivable, 2110 payable). */
export function reconcileControl(ledger: Ledger, book: OpenItemBook, kind: OpenItemKind, asOf: string): ControlReconciliation {
  const code = kind === "RECEIVABLE" ? "1210" : "2110";
  const t = ledger.totals({ to: asOf }).get(code);
  const cur = ledger.currency;
  const gl = t ? (kind === "RECEIVABLE" ? sub(t.debit, t.credit) : sub(t.credit, t.debit)) : zero(cur);
  const sub_ = book.aging(kind, asOf).total;
  const difference = sub(sub_, gl);
  return { subledger: sub_, glBalance: gl, difference, reconciled: difference.minor === BigInt(0) };
}
