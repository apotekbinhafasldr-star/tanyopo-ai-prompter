import { toDecimalString, type Money } from "./money";

/**
 * CSV export that is safe to open in a spreadsheet.
 *
 * Free text (vendor names, refund reasons, tenant names) is attacker-influenced.
 * A cell starting with `=`, `+`, `-`, `@`, TAB or CR can be executed as a
 * formula by Excel / Sheets / LibreOffice, so text cells get a leading `'` which
 * makes the spreadsheet treat them as plain text. Money and integers are NOT
 * text: they are rendered from typed values by this module, never from a string
 * a user supplied, so negative amounts stay real numbers.
 */

export type CsvCell = string | number | bigint | Money | null | undefined;

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r", "\n"]);

function isMoney(value: unknown): value is Money {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Money).minor === "bigint" &&
    typeof (value as Money).currency === "string"
  );
}

/** Neutralises a spreadsheet formula in free text. Exported for tests. */
export function neutralizeFormula(text: string): string {
  // Check the first visible character too: some apps trim leading spaces/control characters first.
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/^[\s\u0000-\u001f\u007f ﻿]+/, "");
  const first = stripped.charAt(0);
  const firstRaw = text.charAt(0);
  if (FORMULA_TRIGGERS.has(first) || FORMULA_TRIGGERS.has(firstRaw)) {
    return `'${text}`;
  }
  return text;
}

function quote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "bigint") return cell.toString();
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) throw new Error("CSV numbers must be finite");
    return String(cell);
  }
  if (typeof cell === "string") return quote(neutralizeFormula(cell));
  if (isMoney(cell)) return toDecimalString(cell);
  throw new Error("Unsupported CSV cell type");
}

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines: string[] = [headers.map((h) => quote(neutralizeFormula(h))).join(",")];
  for (const row of rows) {
    if (row.length !== headers.length) {
      throw new Error(`CSV row has ${row.length} cells but there are ${headers.length} headers`);
    }
    lines.push(row.map(renderCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
