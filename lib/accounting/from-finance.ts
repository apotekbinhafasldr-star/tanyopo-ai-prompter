import type { FinanceSnapshot } from "@/lib/finance/book";
import { addDays, localDate, monthKey, WIB_OFFSET_MINUTES } from "@/lib/finance/dates";
import { IdempotencyConflictError, idempotencyKey } from "@/lib/finance/idempotency";
import { isNegative, isZero, negate, type Money } from "@/lib/finance/money";
import { analyzeRefunds } from "@/lib/finance/refunds";
import { recognizedRevenue } from "@/lib/finance/revenue";
import { expenseAccountFor } from "./coa";
import type { JournalDraft } from "./journal";
import type { Ledger } from "./ledger";

/**
 * Turns the verified facts of lib/finance into journals. It never invents a
 * transaction: every journal comes from one fact and reuses the SAME idempotency key
 * as the finance book, so re-running it (or running it after a webhook retry) cannot
 * record anything twice. No opening balance is created here.
 *
 *   payment      Dr 1120 gateway clearing        Cr 2120 deferred revenue
 *   gateway fee  Dr 5100 gateway fees            Cr 1120
 *   refund       Dr 2120                         Cr 1120      (applied part only)
 *   settlement   Dr 1110 bank (reported net)     Cr 1120
 *   recognition  Dr 2120                         Cr 4100      (monthly, net of refunds)
 *   expense      Dr expense account              Cr 1110
 */
export interface JournalizeResult {
  readonly applied: number;
  readonly duplicates: number;
  readonly reversed: number;
  /** Facts whose journal exists with different content. Left untouched: needs a reviewed reversal and repost. */
  readonly conflicts: readonly string[];
}

export interface JournalizeOptions {
  readonly actor: string;
  readonly at: string;
  /** Recognition journals are posted for every month that has ended on or before this date. */
  readonly through: string;
  readonly offsetMinutes?: number;
  readonly expenseMap?: Readonly<Record<string, string>>;
}

export function journalizeSnapshot(ledger: Ledger, snapshot: FinanceSnapshot, options: JournalizeOptions): JournalizeResult {
  const offset = options.offsetMinutes ?? WIB_OFFSET_MINUTES;
  let applied = 0;
  let duplicates = 0;
  let reversed = 0;
  const conflicts: string[] = [];

  const post = (draft: JournalDraft): void => {
    try {
      const r = ledger.post(draft, options.actor, options.at);
      if (r.result === "APPLIED") applied += 1;
      else duplicates += 1;
    } catch (e) {
      if (e instanceof IdempotencyConflictError) conflicts.push(draft.sourceKey);
      else throw e;
    }
  };
  const two = (key: string, date: string, ref: string, desc: string, dr: string, cr: string, amount: Money): void => {
    if (isZero(amount)) return;
    post({
      sourceKey: key,
      date,
      reference: ref,
      description: desc,
      type: "NORMAL",
      lines: [{ account: dr, debit: amount }, { account: cr, credit: amount }],
    });
  };

  for (const p of snapshot.payments) {
    two(
      idempotencyKey("payment", p.provider, p.providerPaymentId),
      localDate(p.paidAt, offset),
      `${p.provider}:${p.providerPaymentId}`,
      "Pembayaran terverifikasi",
      "1120",
      "2120",
      p.amount,
    );
  }
  for (const f of snapshot.fees) {
    const payment = snapshot.payments.find((p) => p.provider === f.provider && p.providerPaymentId === f.providerPaymentId);
    if (!payment) continue; // a fee for an unknown payment is an anomaly, not a journal
    two(
      idempotencyKey("fee", f.provider, f.providerPaymentId),
      localDate(payment.paidAt, offset),
      `${f.provider}:${f.providerPaymentId}`,
      "Biaya gateway",
      "5100",
      "1120",
      f.amount,
    );
  }
  for (const r of analyzeRefunds(snapshot, offset).applied) {
    two(
      idempotencyKey("refund", r.refund.provider, r.refund.providerRefundId),
      r.effectiveDate,
      `${r.refund.provider}:${r.refund.providerRefundId}`,
      "Refund diproses",
      "2120",
      "1120",
      r.applied,
    );
  }
  for (const s of snapshot.settlements) {
    two(
      idempotencyKey("settlement", s.provider, s.providerSettlementId),
      localDate(s.settledAt, offset),
      `${s.provider}:${s.providerSettlementId}`,
      "Pencairan dana gateway",
      "1110",
      "1120",
      s.netAmount,
    );
  }
  for (const e of snapshot.expenses) {
    const key = idempotencyKey("expense", e.id);
    const existing = ledger.entryByKey(key);
    if (e.isVoid) {
      if (existing && !ledger.reversalOf(existing.id)) {
        ledger.reverse(existing.id, {
          date: e.date > existing.date ? e.date : existing.date,
          actor: options.actor,
          at: options.at,
          reason: "Beban dibatalkan (void)",
        });
        reversed += 1;
      }
      continue;
    }
    two(key, e.date, e.receiptRef ?? e.id, `Beban ${e.category}`, expenseAccountFor(e.category, options.expenseMap), "1110", e.amount);
  }

  // Monthly recognition, one journal per ended month.
  const dates = snapshot.payments.map((p) => localDate(p.paidAt, offset)).sort();
  if (dates.length > 0) {
    let month = monthKey(dates[0]);
    for (;;) {
      const [y, m] = month.split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const end = addDays(next, -1);
      if (end > options.through) break;
      const { recognizedNet } = recognizedRevenue(snapshot, { from: `${month}-01`, to: end }, offset);
      const key = `recognition|${month}`;
      if (!isZero(recognizedNet)) {
        const neg = isNegative(recognizedNet);
        const amount = neg ? negate(recognizedNet) : recognizedNet;
        post({
          sourceKey: key,
          date: end,
          reference: `RECOGNITION:${month}`,
          description: `Pengakuan pendapatan ${month} (garis lurus harian, usulan; menunggu kebijakan akuntan)`,
          type: "NORMAL",
          lines: neg
            ? [{ account: "4100", debit: amount }, { account: "2120", credit: amount }]
            : [{ account: "2120", debit: amount }, { account: "4100", credit: amount }],
        });
      }
      month = next.slice(0, 7);
    }
  }

  return { applied, duplicates, reversed, conflicts };
}
