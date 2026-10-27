import { assertDate } from "@/lib/finance/dates";
import { add, compare, isPositive, isZero, zero, type Money } from "@/lib/finance/money";
import type { ChartOfAccounts } from "./coa";

export type JournalType = "NORMAL" | "REVERSAL" | "ADJUSTMENT" | "CLOSING" | "OPENING";

export type JournalErrorCode =
  | "TOO_FEW_LINES"
  | "SINGLE_SIDED"
  | "UNBALANCED"
  | "BAD_LINE"
  | "UNKNOWN_ACCOUNT"
  | "NOT_POSTABLE"
  | "NO_REFERENCE"
  | "NO_ACTOR"
  | "BAD_DATE"
  | "CURRENCY"
  | "NO_EVIDENCE"
  | "PERIOD_CLOSED"
  | "NOT_FOUND"
  | "ALREADY_REVERSED"
  | "CANNOT_REVERSE_REVERSAL"
  | "NO_REASON";

export class JournalError extends Error {
  readonly code: JournalErrorCode;
  constructor(code: JournalErrorCode, message: string) {
    super(message);
    this.name = "JournalError";
    this.code = code;
  }
}

export interface JournalLineInput {
  readonly account: string;
  readonly debit?: Money;
  readonly credit?: Money;
  readonly memo?: string;
}

export interface JournalLine {
  readonly account: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly memo: string | null;
}

export interface JournalDraft {
  /** Deterministic idempotency key of the business fact (same strings as lib/finance). Posting it twice is a no-op. */
  readonly sourceKey: string;
  /** Local accounting date, YYYY-MM-DD. */
  readonly date: string;
  readonly description: string;
  /** Document / transaction reference. Required: no journal exists without one. */
  readonly reference: string;
  readonly type: JournalType;
  readonly lines: readonly JournalLineInput[];
  /** Required for OPENING journals: where the opening balance was verified from. */
  readonly evidence?: string | null;
}

export interface PostedJournal {
  readonly id: string;
  readonly seq: number;
  readonly sourceKey: string;
  readonly date: string;
  readonly periodKey: string;
  readonly description: string;
  readonly reference: string;
  readonly type: JournalType;
  readonly lines: readonly JournalLine[];
  readonly evidence: string | null;
  readonly reversesId: string | null;
  readonly postedBy: string;
  readonly postedAt: string;
  readonly status: "POSTED";
}

const fail = (code: JournalErrorCode, message: string): never => {
  throw new JournalError(code, message);
};

/** Validates and normalises a draft. Throws JournalError; never returns a partially valid journal. */
export function normalizeLines(draft: JournalDraft, chart: ChartOfAccounts, currency: string): JournalLine[] {
  if (!draft.reference || !draft.reference.trim()) fail("NO_REFERENCE", "A journal needs a reference");
  if (!draft.sourceKey || !draft.sourceKey.trim()) fail("NO_REFERENCE", "A journal needs a source key");
  if (!draft.description || !draft.description.trim()) fail("NO_REFERENCE", "A journal needs a description");
  try {
    assertDate(draft.date);
  } catch {
    fail("BAD_DATE", `Invalid journal date ${draft.date}`);
  }
  if (draft.type === "OPENING" && !(draft.evidence && draft.evidence.trim())) {
    fail("NO_EVIDENCE", "An opening-balance journal needs evidence of where the balance was verified");
  }
  if (draft.lines.length < 2) fail("TOO_FEW_LINES", "A journal needs at least two lines");

  const lines: JournalLine[] = [];
  let debit = zero(currency);
  let credit = zero(currency);
  let hasDebit = false;
  let hasCredit = false;

  for (const raw of draft.lines) {
    const account = chart.get(raw.account);
    if (!account) fail("UNKNOWN_ACCOUNT", `Unknown account ${raw.account}`);
    if (!chart.isPostable(raw.account)) fail("NOT_POSTABLE", `Account ${raw.account} is a header and cannot be posted to`);
    const d = raw.debit ?? zero(currency);
    const c = raw.credit ?? zero(currency);
    if (d.currency !== currency || c.currency !== currency) fail("CURRENCY", "All journal lines must use the ledger currency");
    const dPos = isPositive(d);
    const cPos = isPositive(c);
    if (dPos === cPos) fail("BAD_LINE", `Line on ${raw.account} must carry exactly one positive side`);
    if (d.minor < zero(currency).minor || c.minor < zero(currency).minor) fail("BAD_LINE", "Line amounts cannot be negative");
    if (dPos) {
      hasDebit = true;
      debit = add(debit, d);
    } else {
      hasCredit = true;
      credit = add(credit, c);
    }
    lines.push({ account: raw.account, debit: d, credit: c, memo: raw.memo?.trim() ? raw.memo.trim() : null });
  }

  if (!hasDebit || !hasCredit) fail("SINGLE_SIDED", "A journal must have at least one debit and one credit line");
  if (compare(debit, credit) !== 0) fail("UNBALANCED", "Total debit must equal total credit");
  if (isZero(debit)) fail("BAD_LINE", "A journal cannot be zero");
  return lines;
}

export const periodOf = (date: string): string => date.slice(0, 7);
