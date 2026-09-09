import { describe, expect, it } from "vitest";
import {
  zonedWallTimeToUtc,
  parseLocalDateTimeInZone,
  formatAsLocalDateTimeInput,
  recommendPublishTime,
} from "@/lib/scheduling/recommend-time";

describe("zonedWallTimeToUtc", () => {
  it("converts a WIB (UTC+7) wall-clock time to the correct UTC instant", () => {
    const result = zonedWallTimeToUtc(2026, 9, 9, 19, 30, "Asia/Jakarta");
    expect(result.toISOString()).toBe("2026-09-09T12:30:00.000Z");
  });

  it("handles a timezone with a non-whole-hour offset", () => {
    // Asia/Kolkata is UTC+5:30
    const result = zonedWallTimeToUtc(2026, 9, 9, 19, 30, "Asia/Kolkata");
    expect(result.toISOString()).toBe("2026-09-09T14:00:00.000Z");
  });
});

describe("parseLocalDateTimeInZone", () => {
  it("parses a datetime-local value as wall-clock time in the given zone", () => {
    const result = parseLocalDateTimeInZone("2026-09-09T19:30", "Asia/Jakarta");
    expect(result?.toISOString()).toBe("2026-09-09T12:30:00.000Z");
  });

  it("returns null for a malformed value", () => {
    expect(parseLocalDateTimeInZone("not-a-date", "Asia/Jakarta")).toBeNull();
    expect(parseLocalDateTimeInZone("", "Asia/Jakarta")).toBeNull();
  });
});

describe("formatAsLocalDateTimeInput", () => {
  it("round-trips with zonedWallTimeToUtc", () => {
    const utc = zonedWallTimeToUtc(2026, 9, 9, 19, 30, "Asia/Jakarta");
    expect(formatAsLocalDateTimeInput(utc, "Asia/Jakarta")).toBe("2026-09-09T19:30");
  });
});

describe("recommendPublishTime", () => {
  // 2026-09-07 is a Monday, 2026-09-08 a Tuesday, 2026-09-09 a Wednesday,
  // 2026-09-10 a Thursday (Asia/Jakarta).
  const monday10am = new Date(zonedWallTimeToUtc(2026, 9, 7, 10, 0, "Asia/Jakarta"));

  it("returns null for a platform with no meaningful best-time concept", () => {
    expect(recommendPublishTime("WEBSITE", "Asia/Jakarta", monday10am)).toBeNull();
  });

  it("recommends the coming Wednesday for Instagram when today is Monday", () => {
    const result = recommendPublishTime("INSTAGRAM", "Asia/Jakarta", monday10am);
    expect(result).not.toBeNull();
    expect(result?.localInputValue).toBe("2026-09-09T19:30");
    expect(result?.reason.length).toBeGreaterThan(0);
  });

  it("recommends the coming Thursday for TikTok when today is Monday", () => {
    const result = recommendPublishTime("TIKTOK", "Asia/Jakarta", monday10am);
    expect(result?.localInputValue).toBe("2026-09-10T20:00");
  });

  it("recommends the very next day for X when today is Monday (slot is Tuesday)", () => {
    const result = recommendPublishTime("X", "Asia/Jakarta", monday10am);
    expect(result?.localInputValue).toBe("2026-09-08T12:00");
  });

  it("rolls over to next week when today IS the slot's weekday but the time already passed", () => {
    // Wednesday 20:00 WIB — Instagram's own Wednesday 19:30 slot has already passed.
    const wednesdayEvening = new Date(zonedWallTimeToUtc(2026, 9, 9, 20, 0, "Asia/Jakarta"));
    const result = recommendPublishTime("INSTAGRAM", "Asia/Jakarta", wednesdayEvening);
    expect(result?.localInputValue).toBe("2026-09-16T19:30");
  });

  it("keeps today's slot when the slot's weekday and time haven't passed yet", () => {
    // Wednesday 09:00 WIB — Instagram's 19:30 slot is still later today.
    const wednesdayMorning = new Date(zonedWallTimeToUtc(2026, 9, 9, 9, 0, "Asia/Jakarta"));
    const result = recommendPublishTime("INSTAGRAM", "Asia/Jakarta", wednesdayMorning);
    expect(result?.localInputValue).toBe("2026-09-09T19:30");
  });

  it("computes a different real-world instant for a different timezone with the same platform", () => {
    const jakarta = recommendPublishTime("INSTAGRAM", "Asia/Jakarta", monday10am);
    const newYork = recommendPublishTime("INSTAGRAM", "America/New_York", monday10am);
    expect(jakarta?.utcIso).not.toBe(newYork?.utcIso);
  });
});
