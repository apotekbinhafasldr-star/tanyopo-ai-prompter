/** Validated query-string filters. Anything not on the allow-list falls back to a safe default. */
export const STATUS_FILTERS = ["ALL", "SETTLED", "UNSETTLED", "REFUNDED", "ANOMALY"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_LABEL: Record<StatusFilter, string> = {
  ALL: "Semua",
  SETTLED: "Sudah cair",
  UNSETTLED: "Belum cair",
  REFUNDED: "Ada refund",
  ANOMALY: "Perlu dicek",
};

export interface FinanceFilters {
  /** A month key from the allowed list, or "ytd" (year to date). */
  readonly period: string;
  readonly status: StatusFilter;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseFinanceFilters(raw: Raw, allowedMonths: readonly string[]): FinanceFilters {
  const p = first(raw.period);
  const s = first(raw.status);
  const fallback = allowedMonths[allowedMonths.length - 1] ?? "ytd";
  return {
    period: p === "ytd" || (p !== undefined && allowedMonths.includes(p)) ? p : fallback,
    status: (STATUS_FILTERS as readonly string[]).includes(s ?? "") ? (s as StatusFilter) : "ALL",
  };
}

export const REPORT_TABS = ["jurnal", "buku-besar", "neraca-saldo", "laba-rugi", "neraca", "arus-kas", "piutang-utang", "bank"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export const REPORT_TAB_LABEL: Record<ReportTab, string> = {
  jurnal: "Jurnal umum",
  "buku-besar": "Buku besar",
  "neraca-saldo": "Neraca saldo",
  "laba-rugi": "Laba rugi",
  neraca: "Neraca",
  "arus-kas": "Arus kas",
  "piutang-utang": "Piutang & utang",
  bank: "Rekonsiliasi bank",
};
export function parseReportTab(raw: Raw): ReportTab {
  const t = first(raw.r);
  return (REPORT_TABS as readonly string[]).includes(t ?? "") ? (t as ReportTab) : "laba-rugi";
}
