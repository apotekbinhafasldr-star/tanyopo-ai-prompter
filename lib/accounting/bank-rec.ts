import { assertDate, daysBetween } from "@/lib/finance/dates";
import { add, compare, sub, zero, type Money } from "@/lib/finance/money";
import type { Ledger } from "./ledger";

export interface BankLine {
  readonly id: string;
  readonly date: string;
  readonly reference: string;
  /** Positive = money in, negative = money out. */
  readonly amount: Money;
}
export interface GlCashLine {
  readonly entryId: string;
  readonly date: string;
  readonly reference: string;
  readonly amount: Money;
}
export interface BankMatch {
  readonly bankLineId: string;
  readonly entryId: string;
  readonly basis: "REFERENCE_AND_AMOUNT" | "AMOUNT_AND_DATE_WINDOW";
}
export interface BankReconciliation {
  readonly asOf: string;
  readonly statementBalance: Money;
  readonly glBalance: Money;
  readonly matches: readonly BankMatch[];
  readonly unmatchedBank: readonly BankLine[];
  readonly unmatchedGl: readonly GlCashLine[];
  /** statement + unmatched GL items - unmatched bank items - GL. Zero means fully explained. */
  readonly unexplainedDifference: Money;
  readonly reconciled: boolean;
  /** A reconciliation is only final when a human finalises it AND nothing is unexplained. */
  readonly final: boolean;
}

export function glCashLines(ledger: Ledger, asOf: string, cashCode = "1110"): GlCashLine[] {
  const out: GlCashLine[] = [];
  for (const e of ledger.entries()) {
    if (e.date > asOf) continue;
    for (const l of e.lines) {
      if (l.account === cashCode) out.push({ entryId: e.id, date: e.date, reference: e.reference, amount: sub(l.debit, l.credit) });
    }
  }
  return out;
}

/**
 * One-to-one matching only: a bank line and a GL line are consumed by at most one match,
 * so nothing can be matched (and therefore counted) twice. Reference+amount first, then
 * amount within a small date window, and only when the candidate is unambiguous.
 */
export function reconcileBank(
  ledger: Ledger,
  statement: { lines: readonly BankLine[]; balance: Money; asOf: string },
  options: { windowDays: number; finalizedBy?: string | null; cashCode?: string },
): BankReconciliation {
  assertDate(statement.asOf);
  const cur = ledger.currency;
  const gl = glCashLines(ledger, statement.asOf, options.cashCode);
  const usedGl = new Set<number>();
  const matches: BankMatch[] = [];
  const unmatchedBank: BankLine[] = [];

  const pass = (basis: BankMatch["basis"], bankLines: BankLine[]): BankLine[] => {
    const rest: BankLine[] = [];
    for (const b of bankLines) {
      const candidates: number[] = [];
      gl.forEach((g, i) => {
        if (usedGl.has(i) || compare(g.amount, b.amount) !== 0) return;
        if (basis === "REFERENCE_AND_AMOUNT") {
          if (g.reference === b.reference) candidates.push(i);
        } else if (Math.abs(daysBetween(g.date, b.date)) <= options.windowDays) {
          candidates.push(i);
        }
      });
      if (basis === "REFERENCE_AND_AMOUNT" ? candidates.length >= 1 : candidates.length === 1) {
        const i = candidates[0];
        usedGl.add(i);
        matches.push({ bankLineId: b.id, entryId: gl[i].entryId, basis });
      } else rest.push(b);
    }
    return rest;
  };

  const afterRef = pass("REFERENCE_AND_AMOUNT", statement.lines.filter((l) => l.date <= statement.asOf).slice());
  const afterWindow = pass("AMOUNT_AND_DATE_WINDOW", afterRef);
  unmatchedBank.push(...afterWindow);
  const unmatchedGl = gl.filter((_, i) => !usedGl.has(i));

  let glBalance = zero(cur);
  for (const g of gl) glBalance = add(glBalance, g.amount);
  let bankUnmatched = zero(cur);
  for (const b of unmatchedBank) bankUnmatched = add(bankUnmatched, b.amount);
  let glUnmatched = zero(cur);
  for (const g of unmatchedGl) glUnmatched = add(glUnmatched, g.amount);

  // statement - unmatched bank = matched-only bank balance; GL - unmatched GL = matched-only GL balance.
  const unexplainedDifference = sub(sub(statement.balance, bankUnmatched), sub(glBalance, glUnmatched));
  const reconciled = unexplainedDifference.minor === BigInt(0);
  return {
    asOf: statement.asOf,
    statementBalance: statement.balance,
    glBalance,
    matches,
    unmatchedBank,
    unmatchedGl,
    unexplainedDifference,
    reconciled,
    final: reconciled && Boolean(options.finalizedBy && options.finalizedBy.trim()),
  };
}
