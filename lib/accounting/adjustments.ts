import { compare, isPositive, negate, sub, zero, type Money } from "@/lib/finance/money";
import type { JournalDraft, JournalLineInput } from "./journal";
import type { Ledger } from "./ledger";

/**
 * Period-end adjustment builders. They return DRAFT journals only; nothing is posted
 * until a human with the right permission posts them. Amounts come from the caller
 * (accountant), never guessed here.
 */
export type AdjustmentKind = "ACCRUAL" | "PREPAYMENT_EXPIRY" | "DEPRECIATION" | "DEFERRED_REVENUE";

export interface AdjustmentInput {
  readonly key: string;
  readonly date: string;
  readonly reference: string;
  readonly description: string;
  readonly amount: Money;
  readonly expenseAccount?: string;
}

const adj = (input: AdjustmentInput, lines: JournalLineInput[]): JournalDraft => ({
  sourceKey: `adjustment|${input.key}`,
  date: input.date,
  reference: input.reference,
  description: input.description,
  type: "ADJUSTMENT",
  lines,
});

/** Expense incurred but not yet paid: Dr expense / Cr 2130. */
export const accrual = (i: AdjustmentInput): JournalDraft =>
  adj(i, [{ account: i.expenseAccount ?? "6900", debit: i.amount }, { account: "2130", credit: i.amount }]);

/** Prepaid tax or cost used up: Dr expense / Cr 1310. */
export const prepaymentExpiry = (i: AdjustmentInput): JournalDraft =>
  adj(i, [{ account: i.expenseAccount ?? "6900", debit: i.amount }, { account: "1310", credit: i.amount }]);

/** Depreciation for the period: Dr 6600 / Cr 1519. */
export const depreciation = (i: AdjustmentInput): JournalDraft =>
  adj(i, [{ account: "6600", debit: i.amount }, { account: "1519", credit: i.amount }]);

/** Moves earned revenue out of deferred: Dr 2120 / Cr 4100. */
export const deferredRevenueRelease = (i: AdjustmentInput): JournalDraft =>
  adj(i, [{ account: "2120", debit: i.amount }, { account: "4100", credit: i.amount }]);

/**
 * Year-end closing: zero every revenue and expense account into 3200 (retained earnings).
 * Returns null when there is nothing to close. Dated at the year end; posted as CLOSING.
 */
export function closingDraft(ledger: Ledger, year: string, date: string, reference: string): JournalDraft | null {
  const cur = ledger.currency;
  const totals = ledger.totals({ from: `${year}-01-01`, to: `${year}-12-31`, excludeClosing: true });
  const lines: JournalLineInput[] = [];
  let retained = zero(cur); // credit positive = profit
  for (const account of ledger.chart.list()) {
    if (account.type !== "REVENUE" && account.type !== "EXPENSE") continue;
    const t = totals.get(account.code);
    if (!t) continue;
    const net = sub(t.debit, t.credit); // debit positive
    if (net.minor === BigInt(0)) continue;
    if (isPositive(net)) lines.push({ account: account.code, credit: net });
    else lines.push({ account: account.code, debit: negate(net) });
    retained = sub(retained, net);
  }
  if (lines.length === 0) return null;
  if (isPositive(retained)) lines.push({ account: "3200", credit: retained });
  else if (compare(retained, zero(cur)) < 0) lines.push({ account: "3200", debit: negate(retained) });
  // retained == 0 with lines present (revenue offsets expense exactly) is already balanced.
  return {
    sourceKey: `closing|${year}`,
    date,
    reference,
    description: `Penutupan tahun ${year}`,
    type: "CLOSING",
    lines,
  };
}

