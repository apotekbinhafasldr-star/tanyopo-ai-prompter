/**
 * Calendar helpers for finance reporting. All "dates" are `YYYY-MM-DD` strings
 * and all arithmetic is integer day math on UTC midnights, so no DST or
 * floating-point behaviour can leak into period boundaries.
 *
 * Reporting periods follow the company's local calendar. Indonesia (WIB) is a
 * fixed UTC+07:00 with no DST, so a plain minute offset is sufficient. The
 * offset is a parameter, never a hidden global.
 */

export const WIB_OFFSET_MINUTES = 7 * 60;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateError";
  }
}

function toUtcMs(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    throw new DateError(`Invalid date (expected YYYY-MM-DD): ${JSON.stringify(date)}`);
  }
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const roundTrip = new Date(ms).toISOString().slice(0, 10);
  if (roundTrip !== date) {
    throw new DateError(`Date does not exist: ${date}`);
  }
  return ms;
}

export function assertDate(date: string): string {
  toUtcMs(date);
  return date;
}

/** Whole days from `from` to `to` (to - from). Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Converts an ISO-8601 instant to the local calendar date at a fixed offset. */
export function localDate(isoInstant: string, offsetMinutes: number = WIB_OFFSET_MINUTES): string {
  const ms = Date.parse(isoInstant);
  if (Number.isNaN(ms)) {
    throw new DateError(`Invalid timestamp: ${JSON.stringify(isoInstant)}`);
  }
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** `YYYY-MM` of a `YYYY-MM-DD` date. */
export function monthKey(date: string): string {
  assertDate(date);
  return date.slice(0, 7);
}

export function yearKey(date: string): string {
  assertDate(date);
  return date.slice(0, 4);
}

export function isWithin(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

export interface DateRange {
  /** Inclusive. */
  readonly from: string;
  /** Inclusive. */
  readonly to: string;
}

export function assertRange(range: DateRange): DateRange {
  assertDate(range.from);
  assertDate(range.to);
  if (range.from > range.to) {
    throw new DateError(`Range start ${range.from} is after end ${range.to}`);
  }
  return range;
}
