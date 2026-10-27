import { IdempotencyConflictError, canonicalJson } from "@/lib/finance/idempotency";
import { add, zero, type Money } from "@/lib/finance/money";
import type { ChartOfAccounts } from "./coa";
import {
  JournalError,
  normalizeLines,
  periodOf,
  type JournalDraft,
  type JournalLine,
  type PostedJournal,
} from "./journal";

export type AuditAction = "POST" | "REVERSE" | "CLOSE_PERIOD" | "REOPEN_PERIOD";

export interface AuditEvent {
  readonly seq: number;
  readonly at: string;
  readonly actor: string;
  readonly action: AuditAction;
  readonly entryId: string | null;
  readonly detail: string;
}

export interface PostResult {
  readonly result: "APPLIED" | "DUPLICATE";
  readonly entry: PostedJournal;
}

export interface AccountTotals {
  readonly debit: Money;
  readonly credit: Money;
}

export interface RangeFilter {
  readonly from?: string;
  readonly to?: string;
  /** Closing journals move P&L balances to equity; income statements leave them out. */
  readonly excludeClosing?: boolean;
}

function freezeEntry(entry: PostedJournal): PostedJournal {
  for (const line of entry.lines) Object.freeze(line);
  Object.freeze(entry.lines);
  return Object.freeze(entry);
}

/**
 * Double-entry general ledger (append-only).
 *
 *  - every journal balances and has two sides, a reference and an actor;
 *  - a posted journal is frozen and the class has no update or delete: a
 *    correction is a reversing journal, never an edit;
 *  - posting the same business fact twice (same sourceKey) is a no-op, and a
 *    different journal under the same key is a conflict;
 *  - a closed period accepts no postings;
 *  - every post, reversal and period action lands in the audit trail.
 */
export class Ledger {
  readonly currency: string;
  readonly chart: ChartOfAccounts;
  private readonly journals: PostedJournal[] = [];
  private readonly byKey = new Map<string, PostedJournal>();
  private readonly byId = new Map<string, PostedJournal>();
  private readonly reversedBy = new Map<string, string>();
  private readonly closed = new Set<string>();
  private readonly audit: AuditEvent[] = [];

  constructor(chart: ChartOfAccounts, currency: string) {
    this.chart = chart;
    this.currency = currency;
  }

  private log(at: string, actor: string, action: AuditAction, entryId: string | null, detail: string): void {
    this.audit.push(Object.freeze({ seq: this.audit.length + 1, at, actor, action, entryId, detail }));
  }

  private requireActor(actor: string, at: string): void {
    if (!actor || !actor.trim()) throw new JournalError("NO_ACTOR", "Every ledger action needs an actor");
    if (Number.isNaN(Date.parse(at))) throw new JournalError("BAD_DATE", "Invalid action timestamp");
  }

  private fingerprint(draft: JournalDraft, lines: readonly JournalLine[]): string {
    return canonicalJson({
      date: draft.date,
      type: draft.type,
      reference: draft.reference.trim(),
      description: draft.description.trim(),
      lines: lines
        .map((l) => ({ a: l.account, d: l.debit.minor, c: l.credit.minor }))
        .sort((x, y) => (canonicalJson(x) < canonicalJson(y) ? -1 : 1)),
    });
  }

  post(draft: JournalDraft, actor: string, at: string, reversesId: string | null = null): PostResult {
    this.requireActor(actor, at);
    const lines = normalizeLines(draft, this.chart, this.currency);
    const fingerprint = this.fingerprint(draft, lines);

    const existing = this.byKey.get(draft.sourceKey);
    if (existing) {
      const prior = this.fingerprint(
        { ...existing, lines: existing.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })) },
        existing.lines,
      );
      if (prior === fingerprint) return { result: "DUPLICATE", entry: existing };
      throw new IdempotencyConflictError(draft.sourceKey);
    }

    const period = periodOf(draft.date);
    if (this.closed.has(period)) {
      throw new JournalError("PERIOD_CLOSED", `Period ${period} is closed; post an adjustment in an open period`);
    }

    const seq = this.journals.length + 1;
    const entry = freezeEntry({
      id: `J-${String(seq).padStart(6, "0")}`,
      seq,
      sourceKey: draft.sourceKey,
      date: draft.date,
      periodKey: period,
      description: draft.description.trim(),
      reference: draft.reference.trim(),
      type: draft.type,
      lines,
      evidence: draft.evidence?.trim() ? draft.evidence.trim() : null,
      reversesId,
      postedBy: actor,
      postedAt: at,
      status: "POSTED",
    });
    this.journals.push(entry);
    this.byKey.set(entry.sourceKey, entry);
    this.byId.set(entry.id, entry);
    this.log(at, actor, "POST", entry.id, `${entry.type} ${entry.reference}`);
    return { result: "APPLIED", entry };
  }

  /** Corrects a posted journal by posting its mirror image. The original is never touched. */
  reverse(entryId: string, options: { date: string; actor: string; at: string; reason: string }): PostedJournal {
    this.requireActor(options.actor, options.at);
    const original = this.byId.get(entryId);
    if (!original) throw new JournalError("NOT_FOUND", `Journal ${entryId} not found`);
    if (!options.reason || !options.reason.trim()) throw new JournalError("NO_REASON", "A reversal needs a reason");
    if (original.type === "REVERSAL") throw new JournalError("CANNOT_REVERSE_REVERSAL", "A reversal cannot be reversed; post a new journal");
    if (this.reversedBy.has(entryId)) throw new JournalError("ALREADY_REVERSED", `Journal ${entryId} is already reversed`);
    if (options.date < original.date) throw new JournalError("BAD_DATE", "A reversal cannot be dated before the journal it reverses");

    const draft: JournalDraft = {
      sourceKey: `reversal|${original.id}`,
      date: options.date,
      description: `Pembalik ${original.id}: ${options.reason.trim()}`,
      reference: `REV:${original.reference}`,
      type: "REVERSAL",
      lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, memo: l.memo ?? undefined })),
    };
    const { entry } = this.post(draft, options.actor, options.at, original.id);
    this.reversedBy.set(original.id, entry.id);
    this.log(options.at, options.actor, "REVERSE", original.id, `reversed by ${entry.id}: ${options.reason.trim()}`);
    return entry;
  }

  closePeriod(periodKey: string, actor: string, at: string): void {
    this.requireActor(actor, at);
    if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new JournalError("BAD_DATE", "Period must be YYYY-MM");
    this.closed.add(periodKey);
    this.log(at, actor, "CLOSE_PERIOD", null, periodKey);
  }

  reopenPeriod(periodKey: string, actor: string, at: string, reason: string): void {
    this.requireActor(actor, at);
    if (!reason || !reason.trim()) throw new JournalError("NO_REASON", "Reopening a period needs a reason");
    this.closed.delete(periodKey);
    this.log(at, actor, "REOPEN_PERIOD", null, `${periodKey}: ${reason.trim()}`);
  }

  isClosed(periodKey: string): boolean {
    return this.closed.has(periodKey);
  }

  entries(): readonly PostedJournal[] {
    return this.journals;
  }

  entry(id: string): PostedJournal | undefined {
    return this.byId.get(id);
  }

  entryByKey(sourceKey: string): PostedJournal | undefined {
    return this.byKey.get(sourceKey);
  }

  reversalOf(id: string): string | null {
    return this.reversedBy.get(id) ?? null;
  }

  auditTrail(): readonly AuditEvent[] {
    return this.audit;
  }

  /** Per-account debit/credit totals over a date range. */
  totals(filter: RangeFilter = {}): Map<string, AccountTotals> {
    const out = new Map<string, AccountTotals>();
    for (const entry of this.journals) {
      if (filter.from !== undefined && entry.date < filter.from) continue;
      if (filter.to !== undefined && entry.date > filter.to) continue;
      if (filter.excludeClosing && entry.type === "CLOSING") continue;
      for (const line of entry.lines) {
        const prev = out.get(line.account) ?? { debit: zero(this.currency), credit: zero(this.currency) };
        out.set(line.account, { debit: add(prev.debit, line.debit), credit: add(prev.credit, line.credit) });
      }
    }
    return out;
  }
}
