/**
 * Pure helpers for the OptimizationAgent: how much real data a channel has, the
 * rates computed IN CODE (never by the model), and the minimum-data thresholds
 * that must be met before the AI is asked anything or a budget increase is
 * recommended.
 *
 * UNVERIFIED: the thresholds below are PROPOSED starting values ("usulan, belum
 * divalidasi"). They are not derived from Meta documentation or from LINOE's own
 * data and must be reviewed by the founder before being relied on. They only make
 * the system more cautious; they do not claim that data above them is "enough" to
 * conclude anything.
 */

export interface OptimizationDataThresholds {
  /** Distinct days with delivery (impressions > 0). */
  readonly minDays: number;
  readonly minImpressions: number;
  /** Extra requirement for click-based actions (see CLICK_BASED_ACTIONS). */
  readonly minClicksForClickBasedActions: number;
}

/** usulan, belum divalidasi: >= 3 hari data, >= 1000 impresi, >= 100 klik untuk aksi berbasis klik. */
export const OPTIMIZATION_DATA_THRESHOLDS: OptimizationDataThresholds = Object.freeze({
  minDays: 3,
  minImpressions: 1000,
  minClicksForClickBasedActions: 100,
});

/** Actions whose justification rests on click behaviour (CTR / CPC). Blocked below the click threshold. */
export const CLICK_BASED_ACTIONS: readonly string[] = Object.freeze(["INCREASE_BUDGET"]);

export interface MetricRowInput {
  readonly spend?: number | null;
  readonly impressions?: number | null;
  readonly clicks?: number | null;
  readonly reach?: number | null;
  /** YYYY-MM-DD */
  readonly date?: string | null;
}

export interface ChannelMetricsSummary {
  readonly spend: number;
  readonly impressions: number;
  readonly clicks: number;
  /** Sum of the daily reach values. NOT unique reach: the same person on two days counts twice. */
  readonly reach: number;
  /** Distinct dates with impressions > 0. */
  readonly days: number;
  /** clicks / impressions * 100, two decimals; null when there are no impressions. */
  readonly ctrPercent: number | null;
  /** spend / clicks, two decimals; null when there are no clicks. */
  readonly cpc: number | null;
}

const num = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function summarizeChannelMetrics(rows: readonly MetricRowInput[]): ChannelMetricsSummary {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let reach = 0;
  const daysWithDelivery = new Set<string>();
  for (const row of rows) {
    spend += num(row.spend);
    const rowImpressions = num(row.impressions);
    impressions += rowImpressions;
    clicks += num(row.clicks);
    reach += num(row.reach);
    if (rowImpressions > 0 && typeof row.date === "string" && row.date.length > 0) daysWithDelivery.add(row.date);
  }
  return {
    spend,
    impressions,
    clicks,
    reach,
    days: daysWithDelivery.size,
    ctrPercent: impressions > 0 ? round2((clicks / impressions) * 100) : null,
    cpc: clicks > 0 ? round2(spend / clicks) : null,
  };
}

export interface DataSufficiency {
  /** Meets minDays and minImpressions: the channel may be analysed at all. */
  readonly enough: boolean;
  /** Also meets the click threshold: a click-based action (INCREASE_BUDGET) may be recommended. */
  readonly clickBasedOk: boolean;
  /** Plain-language Indonesian reasons for what is missing (empty when everything is met). */
  readonly shortfalls: readonly string[];
}

export function assessDataSufficiency(
  summary: ChannelMetricsSummary,
  thresholds: OptimizationDataThresholds = OPTIMIZATION_DATA_THRESHOLDS,
): DataSufficiency {
  const shortfalls: string[] = [];
  if (summary.days < thresholds.minDays) shortfalls.push(`${summary.days} dari minimal ${thresholds.minDays} hari data`);
  if (summary.impressions < thresholds.minImpressions) {
    shortfalls.push(`${summary.impressions} dari minimal ${thresholds.minImpressions} impresi`);
  }
  const enough = shortfalls.length === 0;
  const clickShortfall = summary.clicks < thresholds.minClicksForClickBasedActions;
  const clickBasedOk = enough && !clickShortfall;
  if (enough && clickShortfall) {
    shortfalls.push(`${summary.clicks} dari minimal ${thresholds.minClicksForClickBasedActions} klik (untuk aksi berbasis klik)`);
  }
  return { enough, clickBasedOk, shortfalls };
}

/** Whether `actionType` may be recommended for a channel with this data. NO_ACTION and non-click actions need only `enough`. */
export function isActionAllowedByData(actionType: string, sufficiency: DataSufficiency): boolean {
  if (CLICK_BASED_ACTIONS.includes(actionType)) return sufficiency.clickBasedOk;
  return true;
}

export interface InsufficientDataChannel {
  readonly channel: string;
  readonly summary: ChannelMetricsSummary;
  readonly sufficiency: DataSufficiency;
}

/** User-facing message when no channel has enough data. No AI quota is used in that case. */
export function buildInsufficientDataMessage(channels: readonly InsufficientDataChannel[]): string {
  const detail = channels
    .map((c) => `${c.channel}: ${c.sufficiency.shortfalls.length > 0 ? c.sufficiency.shortfalls.join(", ") : "data belum cukup"}`)
    .join("; ");
  return `Data belum cukup untuk dianalisis. Kumpulkan data iklan lebih lama dulu (ambang usulan, belum divalidasi: minimal ${OPTIMIZATION_DATA_THRESHOLDS.minDays} hari, ${OPTIMIZATION_DATA_THRESHOLDS.minImpressions} impresi per channel). Saat ini: ${detail}. Tidak ada kuota AI yang dipakai.`;
}

export const DATA_THRESHOLD_NOTE =
  "Tidak ada kenaikan budget karena data belum memenuhi ambang minimum (usulan, belum divalidasi).";

export interface RecommendationLike {
  readonly channel: string;
  readonly action_type: string;
  readonly rationale: string;
  readonly suggested_daily_budget: number | null;
}

/**
 * Forces a click-based action (INCREASE_BUDGET) back to NO_ACTION for a channel whose data is below the
 * thresholds, whatever the model said. Other fields are kept; the budget is cleared and the rationale says why.
 */
export function enforceDataThresholds<T extends RecommendationLike>(
  recommendations: readonly T[],
  sufficiencyByChannel: ReadonlyMap<string, DataSufficiency>,
): T[] {
  return recommendations.map((rec) => {
    const sufficiency = sufficiencyByChannel.get(rec.channel);
    // A channel we have no data row for is not allowed a click-based action either.
    const allowed = sufficiency ? isActionAllowedByData(rec.action_type, sufficiency) : !CLICK_BASED_ACTIONS.includes(rec.action_type);
    if (allowed) return rec;
    return {
      ...rec,
      action_type: "NO_ACTION",
      suggested_daily_budget: null,
      rationale: `${rec.rationale} ${DATA_THRESHOLD_NOTE}`.trim(),
    } as T;
  });
}
