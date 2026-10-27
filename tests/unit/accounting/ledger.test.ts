import { describe, expect, it } from "vitest";
import { IdempotencyConflictError } from "@/lib/finance";
import {
  Ledger,
  JournalError,
  defaultChart,
  trialBalance,
  incomeStatement,
  balanceSheet,
  cashFlowStatement,
  generalLedger,
  closingDraft,
  accrual,
  type JournalDraft,
} from "@/lib/accounting";
import { d, idr } from "../finance/helpers";

const AT = "2026-11-30T10:00:00Z";
const mk = (): Ledger => new Ledger(defaultChart(), "IDR");
const draft = (key: string, date: string, lines: JournalDraft["lines"], extra: Partial<JournalDraft> = {}): JournalDraft => ({
  sourceKey: key,
  date,
  reference: `REF-${key}`,
  description: `desc ${key}`,
  type: "NORMAL",
  lines,
  ...extra,
});
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof JournalError ? e.code : "OTHER";
  }
  return undefined;
};

describe("journal validation", () => {
  it("rejects unbalanced, one-sided, single-line, zero and header-account journals", () => {
    const l = mk();
    expect(code(() => l.post(draft("a", "2026-11-01", [{ account: "1110", debit: idr("100") }, { account: "4100", credit: idr("90") }]), "u", AT))).toBe("UNBALANCED");
    expect(code(() => l.post(draft("b", "2026-11-01", [{ account: "1110", debit: idr("50") }, { account: "1120", debit: idr("50") }]), "u", AT))).toBe("SINGLE_SIDED");
    expect(code(() => l.post(draft("c", "2026-11-01", [{ account: "1110", debit: idr("50") }]), "u", AT))).toBe("TOO_FEW_LINES");
    expect(code(() => l.post(draft("e", "2026-11-01", [{ account: "1000", debit: idr("50") }, { account: "4100", credit: idr("50") }]), "u", AT))).toBe("NOT_POSTABLE");
    expect(code(() => l.post(draft("f", "2026-11-01", [{ account: "9999", debit: idr("50") }, { account: "4100", credit: idr("50") }]), "u", AT))).toBe("UNKNOWN_ACCOUNT");
    expect(code(() => l.post(draft("g", "2026-11-01", [{ account: "1110", debit: idr("50"), credit: idr("50") }, { account: "4100", credit: idr("50") }]), "u", AT))).toBe("BAD_LINE");
    expect(l.entries()).toHaveLength(0);
  });

  it("requires reference, actor, valid date; opening balances need evidence", () => {
    const l = mk();
    const lines = [{ account: "1110", debit: idr("10") }, { account: "3100", credit: idr("10") }];
    expect(code(() => l.post(draft("a", "2026-11-01", lines, { reference: " " }), "u", AT))).toBe("NO_REFERENCE");
    expect(code(() => l.post(draft("b", "2026-11-01", lines), " ", AT))).toBe("NO_ACTOR");
    expect(code(() => l.post(draft("c", "2026-13-40", lines), "u", AT))).toBe("BAD_DATE");
    expect(code(() => l.post(draft("d", "2026-11-01", lines, { type: "OPENING" }), "u", AT))).toBe("NO_EVIDENCE");
    expect(l.post(draft("d", "2026-11-01", lines, { type: "OPENING", evidence: "Rekening koran 31 Okt" }), "u", AT).result).toBe("APPLIED");
  });
});

describe("immutability, reversal and duplicates", () => {
  const sale = [{ account: "1110", debit: idr("1000") }, { account: "4100", credit: idr("1000") }];

  it("posted journals are frozen and the ledger exposes no edit/delete", () => {
    const l = mk();
    const { entry } = l.post(draft("s1", "2026-11-01", sale), "u", AT);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.lines)).toBe(true);
    expect(() => {
      (entry as { description: string }).description = "x";
    }).toThrow();
    const api = l as unknown as Record<string, unknown>;
    for (const m of ["update", "edit", "delete", "remove"]) expect(api[m]).toBeUndefined();
  });

  it("duplicate source key is a no-op; different content under the same key conflicts", () => {
    const l = mk();
    expect(l.post(draft("s1", "2026-11-01", sale), "u", AT).result).toBe("APPLIED");
    expect(l.post(draft("s1", "2026-11-01", sale), "u", AT).result).toBe("DUPLICATE");
    expect(l.entries()).toHaveLength(1);
    const other = [{ account: "1110", debit: idr("999") }, { account: "4100", credit: idr("999") }];
    expect(() => l.post(draft("s1", "2026-11-01", other), "u", AT)).toThrow(IdempotencyConflictError);
    expect(d(l.totals().get("1110")!.debit)).toBe("1000.00");
  });

  it("a correction is a reversing journal: original untouched, net effect zero, no double reversal", () => {
    const l = mk();
    const { entry } = l.post(draft("s1", "2026-11-01", sale), "u", AT);
    const rev = l.reverse(entry.id, { date: "2026-11-02", actor: "u", at: AT, reason: "salah input" });
    expect(rev.type).toBe("REVERSAL");
    expect(rev.reversesId).toBe(entry.id);
    expect(l.entry(entry.id)!.lines[0].debit.minor).toBe(entry.lines[0].debit.minor);
    const t = l.totals().get("1110")!;
    expect(d(t.debit)).toBe("1000.00");
    expect(d(t.credit)).toBe("1000.00");
    expect(code(() => l.reverse(entry.id, { date: "2026-11-03", actor: "u", at: AT, reason: "lagi" }))).toBe("ALREADY_REVERSED");
    expect(code(() => l.reverse(rev.id, { date: "2026-11-03", actor: "u", at: AT, reason: "x" }))).toBe("CANNOT_REVERSE_REVERSAL");
    expect(code(() => l.reverse("J-999999", { date: "2026-11-03", actor: "u", at: AT, reason: "x" }))).toBe("NOT_FOUND");
    expect(code(() => l.reverse(entry.id, { date: "2026-11-03", actor: "u", at: AT, reason: " " }))).toBe("NO_REASON");
  });

  it("every action lands in the audit trail with a sequence and actor", () => {
    const l = mk();
    const { entry } = l.post(draft("s1", "2026-11-01", sale), "alice", AT);
    l.reverse(entry.id, { date: "2026-11-02", actor: "bob", at: AT, reason: "salah" });
    const trail = l.auditTrail();
    expect(trail.map((e) => e.action)).toEqual(["POST", "POST", "REVERSE"]);
    expect(trail.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(trail[2].actor).toBe("bob");
  });
});

describe("accounting periods", () => {
  const sale = [{ account: "1110", debit: idr("100") }, { account: "4100", credit: idr("100") }];
  it("a closed period rejects posting and reversal into it; reopening needs a reason and is audited", () => {
    const l = mk();
    const { entry } = l.post(draft("a", "2026-10-15", sale), "u", AT);
    l.closePeriod("2026-10", "u", AT);
    expect(code(() => l.post(draft("b", "2026-10-20", sale), "u", AT))).toBe("PERIOD_CLOSED");
    expect(code(() => l.reverse(entry.id, { date: "2026-10-25", actor: "u", at: AT, reason: "x" }))).toBe("PERIOD_CLOSED");
    expect(l.reverse(entry.id, { date: "2026-11-01", actor: "u", at: AT, reason: "koreksi periode baru" }).date).toBe("2026-11-01");
    expect(code(() => l.reopenPeriod("2026-10", "u", AT, " "))).toBe("NO_REASON");
    l.reopenPeriod("2026-10", "u", AT, "audit akuntan");
    expect(l.isClosed("2026-10")).toBe(false);
    expect(l.auditTrail().some((e) => e.action === "REOPEN_PERIOD")).toBe(true);
  });
});

describe("statements", () => {
  function sampleLedger(): Ledger {
    const l = mk();
    l.post(draft("cap", "2026-11-01", [{ account: "1110", debit: idr("5000000") }, { account: "3100", credit: idr("5000000") }], { type: "OPENING", evidence: "Akta pendirian + rekening koran" }), "u", AT);
    l.post(draft("pay", "2026-11-02", [{ account: "1120", debit: idr("300000") }, { account: "2120", credit: idr("300000") }]), "u", AT);
    l.post(draft("fee", "2026-11-02", [{ account: "5100", debit: idr("4000") }, { account: "1120", credit: idr("4000") }]), "u", AT);
    l.post(draft("rec", "2026-11-30", [{ account: "2120", debit: idr("100000") }, { account: "4100", credit: idr("100000") }]), "u", AT);
    l.post(draft("set", "2026-11-05", [{ account: "1110", debit: idr("296000") }, { account: "1120", credit: idr("296000") }]), "u", AT);
    l.post(draft("exp", "2026-11-10", [{ account: "6100", debit: idr("150000") }, { account: "1110", credit: idr("150000") }]), "u", AT);
    l.post(draft("ref", "2026-11-20", [{ account: "4900", debit: idr("10000") }, { account: "1110", credit: idr("10000") }]), "u", AT);
    return l;
  }

  it("trial balance balances and equals journal totals", () => {
    const tb = trialBalance(sampleLedger(), "2026-11-30");
    expect(tb.balanced).toBe(true);
    expect(d(tb.totalDebit)).toBe(d(tb.totalCredit));
    expect(tb.meta.final).toBe(false);
  });

  it("income statement: contra revenue reduces revenue; net income exact", () => {
    const is = incomeStatement(sampleLedger(), { from: "2026-11-01", to: "2026-11-30" });
    expect(d(is.totalRevenue)).toBe("90000.00");
    expect(d(is.totalExpenses)).toBe("154000.00");
    expect(d(is.netIncome)).toBe("-64000.00");
  });

  it("balance sheet satisfies Assets = Liabilities + Equity, before and after closing", () => {
    const l = sampleLedger();
    const before = balanceSheet(l, "2026-11-30");
    expect(before.balanced).toBe(true);
    expect(d(before.difference)).toBe("0.00");
    expect(d(before.currentEarnings)).toBe("-64000.00");
    const closing = closingDraft(l, "2026", "2026-12-31", "CLOSE-2026")!;
    l.post(closing, "u", AT);
    const after = balanceSheet(l, "2026-12-31");
    expect(after.balanced).toBe(true);
    expect(d(after.currentEarnings)).toBe("0.00");
    expect(d(after.equity.find((x) => x.code === "3200")!.amount)).toBe("-64000.00");
    expect(d(incomeStatement(l, { from: "2026-01-01", to: "2026-12-31" }).netIncome)).toBe("-64000.00");
  });

  it("an accrual adjustment keeps the books balanced and lowers profit", () => {
    const l = sampleLedger();
    l.post(accrual({ key: "acc-1", date: "2026-11-30", reference: "ACC-1", description: "Hosting Nov", amount: idr("25000"), expenseAccount: "6100" }), "u", AT);
    expect(balanceSheet(l, "2026-11-30").balanced).toBe(true);
    expect(d(incomeStatement(l, { from: "2026-11-01", to: "2026-11-30" }).netIncome)).toBe("-89000.00");
  });

  it("cash flow: opening + net change = closing, and unclassified is visible", () => {
    const l = sampleLedger();
    const cf = cashFlowStatement(l, { from: "2026-11-01", to: "2026-11-30" });
    expect(cf.reconciled).toBe(true);
    expect(d(cf.closingCash)).toBe("5136000.00");
    expect(d(cf.financing)).toBe("5000000.00");
    expect(d(cf.operating)).toBe("136000.00");
    const l2 = mk();
    l2.post(draft("x", "2026-11-01", [{ account: "1110", debit: idr("10") }, { account: "1120", credit: idr("10") }]), "u", AT);
    expect(cashFlowStatement(l2, { from: "2026-11-01", to: "2026-11-30" }).reconciled).toBe(true);
  });

  it("general ledger shows a running balance and an opening balance for earlier activity", () => {
    const gl = generalLedger(sampleLedger(), "1110", { from: "2026-11-06", to: "2026-11-30" });
    expect(d(gl.openingBalance)).toBe("5296000.00");
    expect(gl.rows).toHaveLength(2);
    expect(d(gl.closingBalance)).toBe("5136000.00");
  });

  it("no opening balance is invented: an empty ledger reports zeros and balances", () => {
    const l = mk();
    const bs = balanceSheet(l, "2026-11-30");
    expect(bs.balanced).toBe(true);
    expect(d(bs.totalAssets)).toBe("0.00");
    expect(trialBalance(l, "2026-11-30").rows).toHaveLength(0);
  });
});
