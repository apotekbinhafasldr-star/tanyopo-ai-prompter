import { balanceSheet, cashFlowStatement, incomeStatement, type Ledger } from "@/lib/accounting";
import { analyzeRefunds, paymentKey, summarize, type FinanceSnapshot, type Money, type PeriodSummary } from "@/lib/finance";
import { addDays, localDate, WIB_OFFSET_MINUTES } from "@/lib/finance/dates";
import { formatRupiah, monthLabel, shortDate } from "@/lib/admin/format";
import type { FinanceFilters, StatusFilter } from "@/lib/admin/filters";

/**
 * View model for the premium finance dashboard. Everything in it is a plain string or
 * a JS number so it can cross the server/client boundary (bigint cannot). The `value`
 * numbers are for DRAWING ONLY (bar heights); every label the reader sees comes from the
 * exact bigint arithmetic, never from these numbers.
 */
export interface Amt {
  readonly text: string;
  readonly value: number;
}
export type TrendView =
  | { readonly kind: "NONE" }
  | { readonly kind: "NEW" }
  | { readonly kind: "FLAT" }
  | { readonly kind: "UP" | "DOWN"; readonly text: string };

export interface KpiView {
  readonly id: string;
  readonly label: string;
  readonly amount: Amt;
  readonly trend: TrendView;
  /** Whether an increase is good news (false for expenses). */
  readonly upIsGood: boolean;
  readonly hint: string;
}
export interface MonthPoint {
  readonly key: string;
  readonly label: string;
  readonly short: string;
  readonly revenue: Amt;
  readonly expenses: Amt;
  readonly net: Amt;
  readonly cash: Amt;
}
export interface TxView {
  readonly id: string;
  readonly date: string;
  readonly ref: string;
  readonly amount: Amt;
  readonly status: Exclude<StatusFilter, "ALL">;
  readonly statusLabel: string;
  readonly refunded: Amt | null;
}
export interface DashboardModel {
  readonly demo: boolean;
  readonly period: { readonly key: string; readonly label: string; readonly from: string; readonly to: string };
  readonly periods: ReadonlyArray<{ key: string; label: string }>;
  readonly status: StatusFilter;
  readonly statusCounts: Readonly<Record<StatusFilter, number>>;
  readonly kpis: readonly KpiView[];
  readonly months: readonly MonthPoint[];
  readonly transactions: readonly TxView[];
  readonly checks: ReadonlyArray<{ label: string; ok: boolean; detail: string }>;
  readonly anomalyCount: number;
  readonly warnings: readonly string[];
}

const amt = (m: Money): Amt => ({ text: formatRupiah(m), value: Number(m.minor) / 100 });
const SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const shortMonth = (key: string): string => SHORT[Number(key.slice(5, 7)) - 1] ?? key;

function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${key}-01`, to: addDays(next, -1) };
}

/** Percentage change using exact integer math: (cur - prev) / |prev|, one decimal, "+12,5%". */
export function trendOf(cur: Money, prev: Money | null): TrendView {
  if (prev === null) return { kind: "NONE" };
  if (prev.minor === BigInt(0)) return cur.minor === BigInt(0) ? { kind: "FLAT" } : { kind: "NEW" };
  const diff = cur.minor - prev.minor;
  if (diff === BigInt(0)) return { kind: "FLAT" };
  const abs = prev.minor < BigInt(0) ? -prev.minor : prev.minor;
  const negative = diff < BigInt(0);
  const d = negative ? -diff : diff;
  const tenths = (d * BigInt(1000)) / abs; // percent * 10, truncated
  const whole = tenths / BigInt(10);
  const frac = tenths % BigInt(10);
  const text = `${negative ? "-" : "+"}${whole.toString()},${frac.toString()}%`;
  return { kind: negative ? "DOWN" : "UP", text };
}

export function buildDashboardModel(input: {
  snapshot: FinanceSnapshot;
  ledger: Ledger;
  filters: FinanceFilters;
  monthKeys: readonly string[];
  yearStart: string;
  today: string;
  lateAfterDays: number;
  demo: boolean;
}): DashboardModel {
  const { snapshot, ledger, filters, monthKeys } = input;
  const cur = snapshot.currency;

  // ---- months (trend chart): always all months, regardless of the filter
  const months: MonthPoint[] = monthKeys.map((key) => {
    const r = monthRange(key);
    const is = incomeStatement(ledger, r);
    const bs = balanceSheet(ledger, r.to);
    const cash = bs.assets.find((a) => a.code === "1110")?.amount ?? { minor: BigInt(0), currency: cur };
    return { key, label: monthLabel(key), short: shortMonth(key), revenue: amt(is.totalRevenue), expenses: amt(is.totalExpenses), net: amt(is.netIncome), cash: amt(cash) };
  });

  // ---- selected period
  const isYtd = filters.period === "ytd";
  const range = isYtd ? { from: input.yearStart, to: input.today } : monthRange(filters.period);
  const prevKey = isYtd ? null : monthKeys[monthKeys.indexOf(filters.period) - 1] ?? null;
  const periodSummary = (r: { from: string; to: string }): PeriodSummary => summarize(snapshot, r, { lateAfterDays: input.lateAfterDays });
  const s = periodSummary(range);
  const p = prevKey ? periodSummary(monthRange(prevKey)) : null;
  const is = incomeStatement(ledger, range);
  const pis = prevKey ? incomeStatement(ledger, monthRange(prevKey)) : null;
  const cashNow = balanceSheet(ledger, range.to).assets.find((a) => a.code === "1110")?.amount ?? { minor: BigInt(0), currency: cur };
  const cashPrev = prevKey ? balanceSheet(ledger, monthRange(prevKey).to).assets.find((a) => a.code === "1110")?.amount ?? { minor: BigInt(0), currency: cur } : null;

  const kpis: KpiView[] = [
    { id: "revenue", label: "Pendapatan diakui", amount: amt(is.totalRevenue), trend: trendOf(is.totalRevenue, pis?.totalRevenue ?? null), upIsGood: true, hint: "Dari jurnal, setelah refund" },
    { id: "gross", label: "Pembayaran terverifikasi", amount: amt(s.grossVerified), trend: trendOf(s.grossVerified, p?.grossVerified ?? null), upIsGood: true, hint: `${s.paymentCount} pembayaran` },
    { id: "expenses", label: "Beban + biaya gateway", amount: amt(is.totalExpenses), trend: trendOf(is.totalExpenses, pis?.totalExpenses ?? null), upIsGood: false, hint: "Operasional dan gateway" },
    { id: "result", label: "Hasil operasi", amount: amt(is.netIncome), trend: trendOf(is.netIncome, pis?.netIncome ?? null), upIsGood: true, hint: "Pendapatan dikurangi beban" },
    { id: "cash", label: "Kas dan bank", amount: amt(cashNow), trend: trendOf(cashNow, cashPrev), upIsGood: true, hint: ledger.entries().some((e) => e.type === "OPENING") ? (input.demo ? "Termasuk modal DEMO fiktif" : "Termasuk saldo awal terverifikasi") : "Saldo awal belum diinput" },
    { id: "deferred", label: "Pendapatan diterima di muka", amount: amt(s.deferredAtEnd), trend: trendOf(s.deferredAtEnd, p?.deferredAtEnd ?? null), upIsGood: true, hint: "Belum menjadi pendapatan" },
  ];

  // ---- transactions + status filter
  const refunds = analyzeRefunds(snapshot).applied;
  const settled = new Set<string>();
  for (const st of snapshot.settlements) for (const it of st.items) settled.add(`${st.provider}|${it.providerPaymentId}`);
  const flagged = new Set<string>();
  for (const a of s.anomalies) for (const ref of a.refs) flagged.add(ref);
  const all: TxView[] = [];
  for (const pay of snapshot.payments) {
    const date = localDate(pay.paidAt, WIB_OFFSET_MINUTES);
    if (date < range.from || date > range.to) continue;
    const key = paymentKey(pay.provider, pay.providerPaymentId);
    let refunded: Money | null = null;
    for (const r of refunds) if (paymentKey(r.payment.provider, r.payment.providerPaymentId) === key) refunded = refunded ? { minor: refunded.minor + r.applied.minor, currency: cur } : r.applied;
    let status: TxView["status"] = settled.has(`${pay.provider}|${pay.providerPaymentId}`) ? "SETTLED" : "UNSETTLED";
    if (refunded) status = "REFUNDED";
    if (flagged.has(pay.providerPaymentId) || (pay.invoiceRef !== null && flagged.has(pay.invoiceRef))) status = "ANOMALY";
    all.push({
      id: pay.providerPaymentId,
      date: shortDate(date),
      ref: `${pay.provider}:${pay.providerPaymentId}`,
      amount: amt(pay.amount),
      status,
      statusLabel: status === "SETTLED" ? "Sudah cair" : status === "UNSETTLED" ? "Belum cair" : status === "REFUNDED" ? "Ada refund" : "Perlu dicek",
      refunded: refunded ? amt(refunded) : null,
    });
  }
  all.sort((a, b) => (a.id < b.id ? -1 : 1));
  const count = (st: StatusFilter) => (st === "ALL" ? all.length : all.filter((t) => t.status === st).length);

  const cf = cashFlowStatement(ledger, range);
  const bsEnd = balanceSheet(ledger, range.to);
  const checks = [
    { label: "Neraca seimbang", ok: bsEnd.balanced, detail: "Aset = Liabilitas + Ekuitas" },
    { label: "Arus kas cocok dengan saldo kas", ok: cf.reconciled, detail: "Kas awal + perubahan = kas akhir" },
    { label: "Pendapatan di muka cocok dengan modul keuangan", ok: (bsEnd.liabilities.find((a) => a.code === "2120")?.amount.minor ?? BigInt(0)) === summarize(snapshot, { from: input.yearStart, to: range.to }, { lateAfterDays: input.lateAfterDays }).deferredAtEnd.minor, detail: "Akun 2120 vs pengakuan pendapatan" },
    { label: "Tanpa anomali pembayaran", ok: s.anomalies.length === 0, detail: `${s.anomalies.length} perlu dicek` },
  ];
  const warnings = ["Draf: belum final sebelum rekonsiliasi bank dan verifikasi akuntan."];
  if (input.demo) warnings.push("Data contoh fiktif. Tidak ada saldo awal yang dikarang.");

  return {
    demo: input.demo,
    period: { key: filters.period, label: isYtd ? `Tahun berjalan ${input.yearStart.slice(0, 4)}` : monthLabel(filters.period), from: range.from, to: range.to },
    periods: [...monthKeys].reverse().map((k) => ({ key: k, label: monthLabel(k) })).concat([{ key: "ytd", label: "Tahun berjalan" }]),
    status: filters.status,
    statusCounts: { ALL: count("ALL"), SETTLED: count("SETTLED"), UNSETTLED: count("UNSETTLED"), REFUNDED: count("REFUNDED"), ANOMALY: count("ANOMALY") },
    kpis,
    months,
    transactions: filters.status === "ALL" ? all : all.filter((t) => t.status === filters.status),
    checks,
    anomalyCount: s.anomalies.length,
    warnings,
  };
}
