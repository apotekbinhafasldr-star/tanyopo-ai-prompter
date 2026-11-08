/**
 * C5 — pure helpers for the daily reconciliation CSV export (/ops/payments/export). No I/O, no server-only imports so
 * they are directly unit-testable. The export carries ids, plan, amounts and dates only: this app never holds card data
 * (Midtrans Snap hosts the card form), and no secret or gateway payload is ever put into a row.
 */

/** Days are Asia/Jakarta calendar days (UTC+7, no DST). */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
export const MAX_EXPORT_DAYS = 92;
export const MAX_EXPORT_ROWS = 5000;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(value: string | undefined): number | null {
  const m = DAY_PATTERN.exec(value ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // round-trip rejects impossible dates such as 2026-02-30
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

export type ExportRange = { ok: true; fromIso: string; toExclusiveIso: string; days: number } | { ok: false; reason: "INVALID" | "TOO_LONG" | "REVERSED" };

/** `from` and `to` are inclusive YYYY-MM-DD days in WIB; returns the half-open UTC interval [fromIso, toExclusiveIso). */
export function parseExportRange(from: string | undefined, to: string | undefined): ExportRange {
  const f = parseDay(from);
  const t = parseDay(to);
  if (f === null || t === null) return { ok: false, reason: "INVALID" };
  if (t < f) return { ok: false, reason: "REVERSED" };
  const days = Math.round((t - f) / 86_400_000) + 1;
  if (days > MAX_EXPORT_DAYS) return { ok: false, reason: "TOO_LONG" };
  return {
    ok: true,
    days,
    fromIso: new Date(f - WIB_OFFSET_MS).toISOString(),
    toExclusiveIso: new Date(t + 86_400_000 - WIB_OFFSET_MS).toISOString(),
  };
}

/**
 * One CSV cell. Strings that a spreadsheet could read as a formula (leading = + - @, tab or carriage return) get a
 * leading apostrophe (OWASP CSV-injection guidance); real numbers are written as numbers and left alone. Cells with a
 * comma, quote or line break are quoted with doubled quotes.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const RECONCILIATION_HEADERS = [
  "paid_at_wib",
  "transaction_id",
  "tenant_id",
  "plan",
  "provider",
  "gateway_transaction_id",
  "amount",
  "currency",
  "invoice_id",
  "invoice_status",
  "invoice_amount",
  "invoice_period_start",
  "invoice_period_end",
  "check",
] as const;

export interface ReconciliationTxn {
  id: string;
  tenant_id: string;
  provider: string;
  provider_payment_id: string | null;
  plan: string;
  amount: number;
  currency: string;
  paid_at: string | null;
}

export interface ReconciliationInvoice {
  id: string;
  transaction_id: string | null;
  status: string;
  amount: number | null;
  currency: string;
  period_start: string | null;
  period_end: string | null;
}

/** Renders a UTC instant as "YYYY-MM-DD HH:mm:ss" in WIB, or empty when absent / unparsable. */
export function formatWib(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

/** "OK" when a PAID invoice for the same amount and currency exists; otherwise a fixed word the operator can filter on. */
function checkWord(txn: ReconciliationTxn, invoice: ReconciliationInvoice | undefined): string {
  if (!invoice) return "NO_INVOICE";
  if (invoice.status !== "PAID") return "INVOICE_NOT_PAID";
  if (invoice.amount !== txn.amount || invoice.currency !== txn.currency) return "AMOUNT_MISMATCH";
  return "OK";
}

export function buildReconciliationCsv(txns: ReconciliationTxn[], invoices: ReconciliationInvoice[]): string {
  const byTxn = new Map<string, ReconciliationInvoice>();
  for (const inv of invoices) if (inv.transaction_id) byTxn.set(inv.transaction_id, inv);

  const lines = [RECONCILIATION_HEADERS.join(",")];
  for (const t of txns) {
    const inv = byTxn.get(t.id);
    lines.push(
      [
        formatWib(t.paid_at),
        t.id,
        t.tenant_id,
        t.plan,
        t.provider,
        t.provider_payment_id,
        t.amount,
        t.currency,
        inv?.id,
        inv?.status,
        inv?.amount,
        inv?.period_start,
        inv?.period_end,
        checkWord(t, inv),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
