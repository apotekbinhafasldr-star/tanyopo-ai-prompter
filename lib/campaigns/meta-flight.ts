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
 *  2. `resolveMetaFlightEndTime` gives the connector an `end_time` of
 *     (launch time + duration), so the ad set cannot keep spending past the
 *     planned run length. It also refuses the cases that could not be bounded.
 * Neither check can raise a budget or open any gate; both only add refusals or
 * an end date. A campaign with neither `total_budget` nor `duration_days`
 * behaves as before.
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
const MIN_DURATION_DAYS = 2;
const MAX_DURATION_DAYS = 365;

const FLIGHT_DURATION_INVALID =
  "Durasi campaign tidak valid untuk Meta (harus bilangan bulat 2 sampai 365 hari; budget harian Meta butuh durasi lebih dari 24 jam). Peluncuran dibatalkan; perbaiki durasi lalu ajukan ulang.";
const FLIGHT_DURATION_REQUIRED =
  "Budget total sudah ditetapkan tetapi durasi campaign belum diisi, sehingga pengeluaran harian tidak bisa dibatasi. Peluncuran dibatalkan; isi durasi campaign lalu ajukan ulang.";
const FLIGHT_CLOCK_INVALID = "Waktu sistem tidak terbaca. Peluncuran dibatalkan; coba lagi.";

export type MetaFlightEndTimeResult = { ok: true; endTime: number | null } | { ok: false; message: string };

/**
 * `end_time` (UTC UNIX seconds) for the ad set.
 *
 * `createAdSet` sends NO `start_time`, so Meta starts the ad set as soon as it
 * is activated, regardless of `start_date`. The end is therefore always
 * `now + durationDays` (elapsed seconds, so time zones and calendar-day
 * boundaries cannot matter); `start_date` is deliberately NOT an input. Using
 * a future `start_date` here would let the ad set run past `duration_days`
 * (and past `total_budget`); a past one would do the same the other way round.
 * `now` is floored to whole seconds, so any rounding only ends the run earlier.
 *
 * Fail closed (the caller must refuse the launch, nothing is created):
 *  - `durationDays` set but not an integer in 2..365 (1 day cannot satisfy
 *    Meta's "longer than 24 hours" rule for a daily budget; more than 365 or an
 *    unreadable value would otherwise silently become "ongoing");
 *  - `totalBudget` set while `durationDays` is not: daily spend cannot be bounded;
 *  - an unreadable clock.
 * Both unset: `endTime: null` (ongoing, as before). Never throws.
 */
export function resolveMetaFlightEndTime(input: {
  durationDays: unknown;
  totalBudget?: unknown;
  now: Date;
}): MetaFlightEndTimeResult {
  const { durationDays, totalBudget, now } = input;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, message: FLIGHT_CLOCK_INVALID };

  if (isUnset(durationDays)) {
    return isUnset(totalBudget) ? { ok: true, endTime: null } : { ok: false, message: FLIGHT_DURATION_REQUIRED };
  }
  if (
    typeof durationDays !== "number" ||
    !Number.isSafeInteger(durationDays) ||
    durationDays < MIN_DURATION_DAYS ||
    durationDays > MAX_DURATION_DAYS
  ) {
    return { ok: false, message: FLIGHT_DURATION_INVALID };
  }

  const endTime = Math.floor(nowMs / 1000) + (durationDays * DAY_MS) / 1000;
  return Number.isSafeInteger(endTime) && endTime > 0 ? { ok: true, endTime } : { ok: false, message: FLIGHT_CLOCK_INVALID };
}
