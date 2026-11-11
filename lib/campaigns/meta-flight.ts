/**
 * Campaign flight (run length) and total-budget rules for Meta (pure).
 *
 * What Meta's docs say (Marketing API "Ad Set" reference and "Budgets",
 * developers.facebook.com, accessed 2026-11-11):
 *  - `lifetime_budget`: "If specified, you must also specify an `end_time`."
 *  - `daily_budget`: "allowed only for ad sets with a duration (difference
 *    between `end_time` and `start_time`) longer than 24 hours."
 *  - `end_time`: "required when `lifetime_budget` is specified"; `end_time=0`
 *    means ongoing. Whether daily and lifetime budgets may be set together is
 *    NOT stated, so this code never sends both.
 *
 * LINOE keeps sending ONE budget, the Owner-approved DAILY budget. The Owner's
 * `total_budget` is therefore enforced on our side, not by Meta:
 *  1. `checkTotalBudgetCoverage` refuses a launch whose projected spend
 *     (daily budget x duration days) is above the Owner's total budget;
 *  2. `resolveMetaFlightEndTime` gives the connector an `end_time`, so the ad
 *     set cannot keep spending past the planned run length.
 * Neither check can raise a budget or open any gate; both only add refusals or
 * an end date. A campaign without `total_budget` or `duration_days` behaves as
 * before.
 *
 * Pure: no network, database, environment or connector access.
 */

export type TotalBudgetCoverageResult = { ok: true } | { ok: false; message: string };

const COVERAGE_INVALID =
  "Budget total atau durasi campaign tidak valid. Peluncuran dibatalkan; perbaiki budget total dan durasi lalu ajukan ulang.";
const COVERAGE_EXCEEDED =
  "Budget harian x durasi campaign melebihi budget total yang Anda tetapkan. Peluncuran dibatalkan; turunkan budget harian atau durasi, atau naikkan budget total, lalu ajukan ulang.";

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

const isUnset = (value: unknown): boolean => value === null || value === undefined;

/** Only evaluated when `total_budget` AND `duration_days` are both set; otherwise there is nothing to compare. */
export function checkTotalBudgetCoverage(input: {
  dailyBudget: unknown;
  totalBudget: unknown;
  durationDays: unknown;
}): TotalBudgetCoverageResult {
  const { dailyBudget, totalBudget, durationDays } = input;
  if (isUnset(totalBudget) || isUnset(durationDays) || isUnset(dailyBudget)) return { ok: true };
  if (!isPositiveSafeInteger(totalBudget) || !isPositiveSafeInteger(durationDays) || !isPositiveSafeInteger(dailyBudget)) {
    return { ok: false, message: COVERAGE_INVALID };
  }
  const projected = dailyBudget * durationDays;
  if (!Number.isSafeInteger(projected)) return { ok: false, message: COVERAGE_INVALID };
  return projected > totalBudget ? { ok: false, message: COVERAGE_EXCEEDED } : { ok: true };
}

const DAY_MS = 86_400_000;
/** `start_date` is a calendar date in Indonesian local time (WIB, UTC+7). */
const START_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DURATION_DAYS = 365;

/**
 * `end_time` (UTC UNIX seconds) for the ad set, or `null` = send none (ongoing,
 * as before). The run starts at the later of `start_date` (00:00 WIB) and now,
 * and lasts `durationDays`. Fewer than 2 days cannot satisfy Meta's "longer
 * than 24 hours" rule for a daily budget, so no end_time is sent then either.
 * Never throws; unreadable input yields `null`.
 */
export function resolveMetaFlightEndTime(input: { startDate: unknown; durationDays: unknown; now: Date }): number | null {
  const { startDate, durationDays, now } = input;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  if (typeof durationDays !== "number" || !Number.isSafeInteger(durationDays) || durationDays < 2 || durationDays > MAX_DURATION_DAYS) {
    return null;
  }

  let startMs = nowMs;
  if (typeof startDate === "string" && startDate.length > 0) {
    if (!START_DATE_PATTERN.test(startDate)) return null;
    const parsed = Date.parse(`${startDate}T00:00:00+07:00`);
    if (!Number.isFinite(parsed)) return null;
    startMs = Math.max(parsed, nowMs);
  } else if (startDate !== null && startDate !== undefined) {
    return null;
  }

  return Math.floor((startMs + durationDays * DAY_MS) / 1000);
}
