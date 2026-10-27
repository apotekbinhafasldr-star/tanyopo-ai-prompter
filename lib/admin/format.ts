import { toDecimalString, type Money } from "@/lib/finance";

/** "Rp 1.234.567" (or "Rp 1.234,50" when there are cents). Pure string work, no floating point. */
export function formatRupiah(amount: Money): string {
  const decimal = toDecimalString(amount); // e.g. "-1234567.50"
  const negative = decimal.startsWith("-");
  const [whole, cents] = (negative ? decimal.slice(1) : decimal).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = cents === "00" ? grouped : `${grouped},${cents}`;
  const prefix = amount.currency === "IDR" ? "Rp" : amount.currency;
  return `${negative ? "-" : ""}${prefix} ${body}`;
}

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "2026-11" -> "November 2026". Returns the input unchanged if it is not a month key. */
export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${match[1]}` : key;
}

/** "2026-11-04" -> "4 Nov 2026". */
export function shortDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return date;
  return `${Number(match[3])} ${MONTHS[month - 1].slice(0, 3)} ${match[1]}`;
}
