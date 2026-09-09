/**
 * Batch B3 — Smart Scheduling. Pure, deterministic time-zone-aware helpers;
 * no AI Router call, since "when during the week does this platform's
 * audience typically engage" is fixed business logic, not free-form
 * generation. No historical engagement-by-time-of-day data source exists
 * anywhere in the schema yet (unlike ad-spend metrics used by Smart
 * Channel Selection), so this is intentionally Level 1 only — general,
 * well-known platform engagement patterns, never a claim about this
 * tenant's own real account data.
 */

/** Minutes the given instant reads ahead of UTC in `timeZone` (e.g. Asia/Jakarta -> 420). */
function getTimeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - instant.getTime()) / 60000;
}

/**
 * Converts a wall-clock date/time — as read on a clock in `timeZone` — into
 * the real UTC instant it represents. Two-pass so it stays correct across a
 * DST transition; JS has no native "construct a Date from zoned wall-clock
 * parts" API.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = getTimeZoneOffsetMinutes(new Date(guessMs), timeZone);
  const refinedMs = guessMs - offset1 * 60000;
  const offset2 = getTimeZoneOffsetMinutes(new Date(refinedMs), timeZone);
  return new Date(guessMs - offset2 * 60000);
}

/** Parses a `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm[...]") as wall-clock time in `timeZone`. Null if malformed. */
export function parseLocalDateTimeInZone(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return zonedWallTimeToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), timeZone);
}

/** Formats a Date as the "YYYY-MM-DDTHH:mm" wall-clock string for `timeZone` — the shape a datetime-local input expects/produces. */
export function formatAsLocalDateTimeInput(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export interface PublishTimeRecommendation {
  utcIso: string;
  /** For a datetime-local input's defaultValue/value — already in `timeZone`. */
  localInputValue: string;
  reason: string;
}

interface PlatformSlot {
  /** 0 = Sunday .. 6 = Saturday, matching the weekday index this module derives from Intl. */
  weekday: number;
  hour: number;
  minute: number;
  reason: string;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * General engagement-pattern baselines per platform — not per-tenant data.
 * Deliberately varies weekday/hour by platform rather than one fixed slot
 * for everyone. A platform absent here (e.g. WEBSITE — content isn't
 * time-sensitive the way a social feed post is) yields no recommendation
 * rather than a made-up one.
 */
const PLATFORM_SLOTS: Partial<Record<string, PlatformSlot>> = {
  FACEBOOK: {
    weekday: 3,
    hour: 13,
    minute: 0,
    reason: "Rabu siang biasanya jadi jam istirahat kerja — banyak orang membuka Facebook saat itu.",
  },
  INSTAGRAM: {
    weekday: 3,
    hour: 19,
    minute: 30,
    reason: "Malam hari sepulang kerja, saat orang lebih santai menjelajahi konten visual di Instagram.",
  },
  TIKTOK: {
    weekday: 4,
    hour: 20,
    minute: 0,
    reason: "Malam hari adalah jam tersibuk konsumsi video pendek di TikTok.",
  },
  X: {
    weekday: 2,
    hour: 12,
    minute: 0,
    reason: "Siang hari jam makan siang biasanya jadi waktu ramai diskusi/berita di X.",
  },
};

/**
 * Next occurrence of the platform's baseline weekday+hour, in `timeZone`,
 * on or after `now` — always a future slot (today if it hasn't passed yet,
 * otherwise the same weekday next week). Returns null for a platform with
 * no meaningful "best time" concept.
 */
export function recommendPublishTime(
  platform: string,
  timeZone: string,
  now: Date = new Date(),
): PublishTimeRecommendation | null {
  const slot = PLATFORM_SLOTS[platform];
  if (!slot) return null;

  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => nowParts.find((p) => p.type === type)?.value ?? "";
  const todayIndex = WEEKDAY_INDEX[get("weekday")] ?? 0;
  const nowHour = Number(get("hour"));
  const nowMinute = Number(get("minute"));

  let daysAhead = (slot.weekday - todayIndex + 7) % 7;
  if (daysAhead === 0 && (nowHour > slot.hour || (nowHour === slot.hour && nowMinute >= slot.minute))) {
    daysAhead = 7;
  }

  const targetDay = new Date(now.getTime() + daysAhead * 86400000);
  const dayParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(targetDay);
  const dget = (type: string) => Number(dayParts.find((p) => p.type === type)?.value ?? "0");

  const target = zonedWallTimeToUtc(dget("year"), dget("month"), dget("day"), slot.hour, slot.minute, timeZone);

  return {
    utcIso: target.toISOString(),
    localInputValue: formatAsLocalDateTimeInput(target, timeZone),
    reason: slot.reason,
  };
}
