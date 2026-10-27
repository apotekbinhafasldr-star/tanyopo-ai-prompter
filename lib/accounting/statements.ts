import { assertRange, type DateRange } from "@/lib/finance/dates";
import { add, compare, negate, sub, zero, type Money } from "@/lib/finance/money";
import { normalSide, type Account, type AccountType, type CashFlowClass } from "./coa";
import type { Ledger } from "./ledger";

/**
 * Reports are DRAFT until the reconciliation checks pass and a human verifies
 * them. Every report carries `final: false`; nothing in this module can set it.
 */
export interface ReportMeta {
  readonly final: false;
  readonly note: string;
}
const META: ReportMeta = {
  final: false,
  note: "Draf: belum final sebelum rekonsiliasi dan verifikasi akuntan.",
};

/** Natural-direction balance of an account (positive = on its normal side). */
function natural(account: Account, debit: Money, credit: Money): Money {
  return normalSide(account) === "DEBIT" ? sub(debit, credit) : sub(credit, debit);
}

export interface TrialBalanceRow {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly debit: Money;
  readonly credit: Money;
}
export interface TrialBalance {
  readonly meta: ReportMeta;
  readonly asOf: string;
  readonly rows: readonly TrialBalanceRow[];
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  readonly balanced: boolean;
}

export function trialBalance(ledger: Ledger, asOf: string): TrialBalance {
  const cur = ledger.currency;
  const totals = ledger.totals({ to: asOf });
  const rows: TrialBalanceRow[] = [];
  let totalDebit = zero(cur);
  let totalCredit = zero(cur);
  for (const account of ledger.chart.list()) {
    const t = totals.get(account.code);
    if (!t) continue;
    const net = sub(t.debit, t.credit);
    const debit = net.minor > BigInt(0) ? net : zero(cur);
    const credit = net.minor < BigInt(0) ? negate(net) : zero(cur);
    if (debit.minor === BigInt(0) && credit.minor === BigInt(0)) continue;
    totalDebit = add(totalDebit, debit);
    totalCredit = add(totalCredit, credit);
    rows.push({ code: account.code, name: account.name, type: account.type, debit, credit });
  }
  return { meta: META, asOf, rows, totalDebit, totalCredit, balanced: compare(totalDebit, totalCredit) === 0 };
}

export interface StatementLine {
  readonly code: string;
  readonly name: string;
  readonly amount: Money;
}
export interface IncomeStatement {
  readonly meta: ReportMeta;
  readonly range: DateRange;
  readonly revenue: readonly StatementLine[];
  readonly totalRevenue: Money;
  readonly expenses: readonly StatementLine[];
  readonly totalExpenses: Money;
  readonly netIncome: Money;
}

function sectionLines(ledger: Ledger, totals: ReturnType<Ledger["totals"]>, type: AccountType): { lines: StatementLine[]; total: Money } {
  const cur = ledger.currency;
  const lines: StatementLine[] = [];
  let total = zero(cur);
  for (const account of ledger.chart.list()) {
    if (account.type !== type) continue;
    const t = totals.get(account.code);
    if (!t) continue;
    const amount = natural(account, t.debit, t.credit);
    if (amount.minor === BigInt(0)) continue;
    // Contra accounts (e.g. refunds) reduce their section: show them negative.
    const signed = account.contra ? negate(amount) : amount;
    lines.push({ code: account.code, name: account.name, amount: signed });
    total = add(total, signed);
  }
  return { lines, total };
}

export function incomeStatement(ledger: Ledger, range: DateRange): IncomeStatement {
  assertRange(range);
  const totals = ledger.totals({ from: range.from, to: range.to, excludeClosing: true });
  const rev = sectionLines(ledger, totals, "REVENUE");
  const exp = sectionLines(ledger, totals, "EXPENSE");
  return {
    meta: META,
    range,
    revenue: rev.lines,
    totalRevenue: rev.total,
    expenses: exp.lines,
    totalExpenses: exp.total,
    netIncome: sub(rev.total, exp.total),
  };
}

export interface BalanceSheet {
  readonly meta: ReportMeta;
  readonly asOf: string;
  readonly assets: readonly StatementLine[];
  readonly totalAssets: Money;
  readonly liabilities: readonly StatementLine[];
  readonly totalLiabilities: Money;
  readonly equity: readonly StatementLine[];
  /** Cumulative P&L not yet closed to retained earnings. Zero after a closing journal. */
  readonly currentEarnings: Money;
  readonly totalEquity: Money;
  /** Assets - (Liabilities + Equity). Must be zero. */
  readonly difference: Money;
  readonly balanced: boolean;
}

export function balanceSheet(ledger: Ledger, asOf: string): BalanceSheet {
  const totals = ledger.totals({ to: asOf });
  const assets = sectionLines(ledger, totals, "ASSET");
  const liabilities = sectionLines(ledger, totals, "LIABILITY");
  const equity = sectionLines(ledger, totals, "EQUITY");
  const rev = sectionLines(ledger, totals, "REVENUE");
  const exp = sectionLines(ledger, totals, "EXPENSE");
  const currentEarnings = sub(rev.total, exp.total);
  const totalEquity = add(equity.total, currentEarnings);
  const difference = sub(assets.total, add(liabilities.total, totalEquity));
  return {
    meta: META,
    asOf,
    assets: assets.lines,
    totalAssets: assets.total,
    liabilities: liabilities.lines,
    totalLiabilities: liabilities.total,
    equity: equity.lines,
    currentEarnings,
    totalEquity,
    difference,
    balanced: difference.minor === BigInt(0),
  };
}

export interface CashFlowStatement {
  readonly meta: ReportMeta;
  readonly range: DateRange;
  readonly openingCash: Money;
  readonly operating: Money;
  readonly investing: Money;
  readonly financing: Money;
  /** Cash movement against an account with no cash-flow class. Visible, never hidden. */
  readonly unclassified: Money;
  readonly netChange: Money;
  readonly closingCash: Money;
  /** openingCash + netChange equals the cash-account balance at the end. */
  readonly reconciled: boolean;
}

export function cashFlowStatement(ledger: Ledger, range: DateRange): CashFlowStatement {
  assertRange(range);
  const cur = ledger.currency;
  const cashCodes = new Set(ledger.chart.list().filter((a) => a.cashFlow === "CASH").map((a) => a.code));
  const cashBalance = (to: string | undefined): Money => {
    const t = ledger.totals(to === undefined ? {} : { to });
    let sum = zero(cur);
    for (const code of cashCodes) {
      const x = t.get(code);
      if (x) sum = add(sum, sub(x.debit, x.credit));
    }
    return sum;
  };
  const dayBefore = new Date(Date.parse(`${range.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const openingCash = cashBalance(dayBefore);
  const closingCash = cashBalance(range.to);

  const buckets: Record<"OPERATING" | "INVESTING" | "FINANCING" | "UNCLASSIFIED", Money> = {
    OPERATING: zero(cur),
    INVESTING: zero(cur),
    FINANCING: zero(cur),
    UNCLASSIFIED: zero(cur),
  };
  for (const entry of ledger.entries()) {
    if (entry.date < range.from || entry.date > range.to) continue;
    for (const line of entry.lines) {
      if (cashCodes.has(line.account)) continue;
      const account = ledger.chart.get(line.account) as Account;
      // The non-cash side of a balanced journal mirrors the cash side: credit - debit.
      const contribution = sub(line.credit, line.debit);
      const hasCash = entry.lines.some((l) => cashCodes.has(l.account));
      if (!hasCash) continue;
      const cls: CashFlowClass | undefined = account.cashFlow;
      const key = cls === "OPERATING" || cls === "INVESTING" || cls === "FINANCING" ? cls : "UNCLASSIFIED";
      buckets[key] = add(buckets[key], contribution);
    }
  }
  const netChange = add(add(buckets.OPERATING, buckets.INVESTING), add(buckets.FINANCING, buckets.UNCLASSIFIED));
  return {
    meta: META,
    range,
    openingCash,
    operating: buckets.OPERATING,
    investing: buckets.INVESTING,
    financing: buckets.FINANCING,
    unclassified: buckets.UNCLASSIFIED,
    netChange,
    closingCash,
    reconciled: compare(add(openingCash, netChange), closingCash) === 0,
  };
}

export interface LedgerRow {
  readonly date: string;
  readonly entryId: string;
  readonly reference: string;
  readonly description: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly balance: Money;
}
export interface GeneralLedgerAccount {
  readonly code: string;
  readonly name: string;
  readonly openingBalance: Money;
  readonly rows: readonly LedgerRow[];
  readonly closingBalance: Money;
}

/** Buku besar for one account, with a running balance in the account's natural direction. */
export function generalLedger(ledger: Ledger, code: string, range: DateRange): GeneralLedgerAccount {
  assertRange(range);
  const account = ledger.chart.get(code);
  if (!account) throw new Error(`Unknown account ${code}`);
  const cur = ledger.currency;
  let balance = zero(cur);
  const rows: LedgerRow[] = [];
  let opening = zero(cur);
  for (const entry of ledger.entries()) {
    for (const line of entry.lines) {
      if (line.account !== code) continue;
      const delta = natural(account, line.debit, line.credit);
      if (entry.date < range.from) {
        balance = add(balance, delta);
        opening = balance;
      } else if (entry.date <= range.to) {
        balance = add(balance, delta);
        rows.push({
          date: entry.date,
          entryId: entry.id,
          reference: entry.reference,
          description: entry.description,
          debit: line.debit,
          credit: line.credit,
          balance,
        });
      }
    }
  }
  return { code, name: account.name, openingBalance: opening, rows, closingBalance: balance };
}
