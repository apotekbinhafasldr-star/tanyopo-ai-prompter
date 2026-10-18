import { z } from "zod";

/**
 * Winning Ads Phase 2B — validation for manually typed ad metrics.
 *
 * These bounds mirror the CHECK constraints in
 * supabase/migrations/20261018160000_prompter_manual_ad_metrics.sql (a unit
 * test pins the two together). Validation here is the first layer; the database
 * constraints are the layer that still holds if a client skips this code.
 *
 * Numbers are parsed from STRICT text, never `Number(x)`/`z.coerce`: an empty
 * field must not become 0, and "150.000" (an Indonesian thousands separator)
 * must not silently become 150.00 — it is rejected with an instruction instead.
 */

export const MANUAL_METRIC_LIMITS = Object.freeze({
  maxMoney: 100_000_000_000,
  maxImpressions: 10_000_000_000,
  /** How far back a metric date may be. */
  maxDaysBack: 366,
  /** Allows for timezones ahead of UTC; the database repeats this as current_date + 1. */
  maxDaysAhead: 1,
});

export const MANUAL_METRIC_CHANNELS = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "X"] as const;
export type ManualMetricChannel = (typeof MANUAL_METRIC_CHANNELS)[number];

const MONEY_RE = /^\d{1,14}(\.\d{1,2})?$/;
const COUNT_RE = /^\d{1,11}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONEY_HINT =
  "Tulis angka biasa tanpa titik/koma pemisah ribuan (contoh: 150000), maksimal 2 desimal dengan titik.";
const COUNT_HINT = "Tulis bilangan bulat tanpa titik/koma pemisah (contoh: 12500).";

function moneyField(label: string) {
  return z
    .string({ error: `${label} wajib diisi.` })
    .trim()
    .min(1, `${label} wajib diisi.`)
    .refine((v) => MONEY_RE.test(v), `${label} tidak valid. ${MONEY_HINT}`)
    .transform((v) => Number(v))
    .refine((n) => Number.isFinite(n) && n >= 0, `${label} tidak boleh negatif.`)
    .refine((n) => n <= MANUAL_METRIC_LIMITS.maxMoney, `${label} terlalu besar.`);
}

function countField(label: string, max: number) {
  return z
    .string({ error: `${label} wajib diisi.` })
    .trim()
    .min(1, `${label} wajib diisi.`)
    .refine((v) => COUNT_RE.test(v), `${label} tidak valid. ${COUNT_HINT}`)
    .transform((v) => Number(v))
    .refine((n) => Number.isSafeInteger(n) && n >= 0, `${label} tidak boleh negatif.`)
    .refine((n) => n <= max, `${label} terlalu besar.`);
}

/** Days since epoch for a YYYY-MM-DD calendar date, or null when it is not a real date. */
export function parseCalendarDate(value: string): number | null {
  if (!DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.floor(ms / 86_400_000);
}

/** Returns an error message, or null when `value` is an acceptable metric date relative to `now`. */
export function validateMetricDate(value: string, now: Date = new Date()): string | null {
  const day = parseCalendarDate(value);
  if (day === null) return "Tanggal tidak valid. Gunakan format YYYY-MM-DD.";
  const today = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  if (day > today + MANUAL_METRIC_LIMITS.maxDaysAhead) return "Tanggal tidak boleh di masa depan.";
  if (day < today - MANUAL_METRIC_LIMITS.maxDaysBack) {
    return `Tanggal terlalu lama (maksimal ${MANUAL_METRIC_LIMITS.maxDaysBack} hari ke belakang).`;
  }
  return null;
}

const metricsShape = {
  spend: moneyField("Biaya iklan (spend)"),
  impressions: countField("Tayangan (impressions)", MANUAL_METRIC_LIMITS.maxImpressions),
  clicks: countField("Klik", MANUAL_METRIC_LIMITS.maxImpressions),
  conversions: countField("Konversi", MANUAL_METRIC_LIMITS.maxImpressions),
  revenue: moneyField("Omzet (revenue)"),
};

type MetricValues = { impressions: number; clicks: number; conversions: number; revenue: number };

function crossFieldIssues(v: MetricValues, ctx: z.RefinementCtx) {
  if (v.clicks > v.impressions) {
    ctx.addIssue({ code: "custom", path: ["clicks"], message: "Klik tidak boleh lebih besar dari tayangan." });
  }
  if (v.conversions > v.clicks) {
    ctx.addIssue({ code: "custom", path: ["conversions"], message: "Konversi tidak boleh lebih besar dari klik." });
  }
  if (v.revenue > 0 && v.conversions === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["revenue"],
      message: "Omzet hanya boleh diisi jika ada konversi (isi 0 jika tidak ada penjualan).",
    });
  }
}

/** Metrics only (used by edit). */
export const manualMetricValuesSchema = z.object(metricsShape).superRefine(crossFieldIssues);

/**
 * Add form. `now` is injectable so the date window is testable. The currency is
 * deliberately NOT a field: the server takes it from the campaign, never from
 * the client.
 */
export function buildManualMetricCreateSchema(now: Date = new Date()) {
  return z
    .object({
      channelCampaignId: z.string({ error: "Channel campaign wajib dipilih." }).uuid("Channel campaign tidak valid."),
      metricDate: z
        .string({ error: "Tanggal wajib diisi." })
        .trim()
        .superRefine((v, ctx) => {
          const message = validateMetricDate(v, now);
          if (message) ctx.addIssue({ code: "custom", message });
        }),
      ...metricsShape,
    })
    .superRefine(crossFieldIssues);
}

export type ManualMetricCreateInput = z.infer<ReturnType<typeof buildManualMetricCreateSchema>>;
export type ManualMetricValuesInput = z.infer<typeof manualMetricValuesSchema>;

/** First human-readable validation message (the forms show one error at a time). */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Input tidak valid.";
}
