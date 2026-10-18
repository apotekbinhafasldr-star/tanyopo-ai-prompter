import {
  evaluateAdPerformance,
  type AdPerformanceVerdict,
} from "@/lib/ad-performance-verdict";

/**
 * Winning Ads Phase 2B — pure aggregation of manually typed daily ad metrics
 * into an Ad Performance Verdict (Phase 2A engine). No I/O, no database, no
 * platform call: callers pass rows already loaded (tenant-scoped) by the page.
 *
 * Everything here is advisory. A verdict from this module is computed from
 * numbers a person typed in; nothing verifies them against the ad platform.
 */

export const MANUAL_DATA_LABEL = "Data input manual, belum diverifikasi platform";

export const MANUAL_ASSUMPTION_NOTE =
  "Perhitungan mengasumsikan 1 konversi = 1 unit produk terjual, dan memakai harga & HPP produk saat ini (bukan nilai pada saat penjualan). Pesanan berisi banyak unit membuat estimasi break-even terlihat lebih optimistis dari kenyataan.";

export interface ManualMetricRow {
  metric_date: string;
  spend: number | string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  conversions: number | string | null;
  revenue: number | string | null;
  currency: string;
}

export interface ManualMetricContext {
  /** Currency of the master campaign. */
  campaignCurrency: string | null | undefined;
  /** Product economics; null/absent when the campaign has no product. */
  product?: {
    hpp: number | string | null;
    price: number | string | null;
    currency: string | null;
  } | null;
}

export interface ManualMetricTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export type ManualVerdictBlock =
  | "NO_DATA"
  | "CURRENCY_MISMATCH"
  | "INVALID_DATA";

export interface ManualMetricsSummary {
  totals: ManualMetricTotals;
  /** Distinct dates with an entry — NOT the calendar span between first and last. */
  daysObserved: number;
  currency: string | null;
  /** Null when a verdict must not be shown, see `blockedReason`. */
  verdict: AdPerformanceVerdict | null;
  blockedReason: ManualVerdictBlock | null;
  /** Plain-Indonesian explanation when `verdict` is null. */
  blockedMessage: string | null;
  /** Non-blocking caveats (e.g. HPP missing). */
  warnings: string[];
}

const ZERO: ManualMetricTotals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };

function toFiniteNonNegative(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normCurrency(c: string | null | undefined): string | null {
  const v = (c ?? "").trim().toUpperCase();
  return v === "" ? null : v;
}

/**
 * Sums the rows and, when it is safe to, evaluates the verdict.
 *
 * A verdict is withheld (never guessed) when there are no rows, when any row
 * has a malformed number, or when the entry currency, the campaign currency
 * and the product currency are not all the same — mixing currencies would give
 * a plausible-looking but wrong ROAS.
 */
export function summarizeManualMetrics(
  rows: readonly ManualMetricRow[],
  context: ManualMetricContext,
): ManualMetricsSummary {
  if (rows.length === 0) {
    return {
      totals: { ...ZERO },
      daysObserved: 0,
      currency: normCurrency(context.campaignCurrency),
      verdict: null,
      blockedReason: "NO_DATA",
      blockedMessage: "Belum ada data. Tambahkan metrik harian untuk melihat verdict.",
      warnings: [],
    };
  }

  const totals: ManualMetricTotals = { ...ZERO };
  const dates = new Set<string>();
  const rowCurrencies = new Set<string>();
  let invalid = false;

  for (const row of rows) {
    const spend = toFiniteNonNegative(row.spend);
    const impressions = toFiniteNonNegative(row.impressions);
    const clicks = toFiniteNonNegative(row.clicks);
    const conversions = toFiniteNonNegative(row.conversions);
    const revenue = toFiniteNonNegative(row.revenue);
    if (
      spend === null ||
      impressions === null ||
      clicks === null ||
      conversions === null ||
      revenue === null ||
      !row.metric_date
    ) {
      invalid = true;
      continue;
    }
    totals.spend += spend;
    totals.impressions += impressions;
    totals.clicks += clicks;
    totals.conversions += conversions;
    totals.revenue += revenue;
    dates.add(row.metric_date);
    const rc = normCurrency(row.currency);
    if (rc) rowCurrencies.add(rc);
    else invalid = true;
  }

  const daysObserved = dates.size;
  const campaignCurrency = normCurrency(context.campaignCurrency);
  const productCurrency = normCurrency(context.product?.currency);

  const base = { totals, daysObserved, warnings: [] as string[] };

  if (invalid) {
    return {
      ...base,
      currency: null,
      verdict: null,
      blockedReason: "INVALID_DATA",
      blockedMessage: "Ada data tersimpan yang tidak valid, verdict tidak ditampilkan. Periksa atau hapus entri yang bermasalah.",
    };
  }

  const currencies = new Set<string>(rowCurrencies);
  if (campaignCurrency) currencies.add(campaignCurrency);
  if (context.product && productCurrency) currencies.add(productCurrency);

  if (!campaignCurrency || currencies.size !== 1) {
    return {
      ...base,
      currency: null,
      verdict: null,
      blockedReason: "CURRENCY_MISMATCH",
      blockedMessage:
        "Mata uang data, campaign, dan produk tidak sama, sehingga ROAS tidak bisa dihitung dengan benar. Samakan mata uang produk dengan campaign, atau hapus entri dengan mata uang berbeda.",
    };
  }

  const hpp = toFiniteNonNegative(context.product?.hpp ?? null);
  const price = toFiniteNonNegative(context.product?.price ?? null);
  const warnings: string[] = [];
  if (!context.product) {
    warnings.push("Campaign ini tidak terhubung ke produk, sehingga HPP dan harga tidak tersedia.");
  } else if (hpp === null) {
    warnings.push("HPP produk belum diisi — profitabilitas tidak bisa dinilai, verdict tetap konservatif.");
  }
  if (context.product && price === null) {
    warnings.push("Harga produk belum diisi — nilai pesanan rata-rata dari omzet dipakai sebagai pengganti.");
  }

  const verdict = evaluateAdPerformance({
    spend: totals.spend,
    impressions: totals.impressions,
    clicks: totals.clicks,
    conversions: totals.conversions,
    revenue: totals.revenue,
    hpp,
    unitPrice: price,
    daysObserved,
  });

  return {
    totals,
    daysObserved,
    currency: [...currencies][0],
    verdict,
    blockedReason: null,
    blockedMessage: null,
    warnings,
  };
}

export const MANUAL_METRICS_UNAVAILABLE_MESSAGE =
  "Fitur input metrik manual belum aktif di lingkungan ini. Hubungi admin LINOE.";

/**
 * True when a Supabase/PostgREST error means the table itself is absent (the
 * migration has not been applied). Callers fail CLOSED on it: no form, no
 * verdict, an explanatory notice — never a fabricated empty-but-working state.
 */
export function isManualMetricsTableMissing(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("prompter_manual_ad_metrics") &&
    (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"))
  );
}
