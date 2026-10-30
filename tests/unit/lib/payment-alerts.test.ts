// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PAYMENT_ALERT_STALE_AFTER_MS,
  checkOptionalNote,
  checkResolveNote,
  describeAlertActionOutcome,
  isSyncStale,
  isUuid,
} from "@/lib/billing/payment-alerts";

describe("Billing B4.1 — alert helpers", () => {
  it("isUuid accepts only real uuids", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    for (const bad of ["", "abc", "11111111-1111-4111-8111-11111111111", null, undefined, 5, "1; drop table x"]) expect(isUuid(bad)).toBe(false);
  });
  it("resolve needs a trimmed note of 5..1000 characters", () => {
    expect(checkResolveNote(undefined).ok).toBe(false);
    expect(checkResolveNote("    ab  ").ok).toBe(false);
    expect(checkResolveNote("x".repeat(1001)).ok).toBe(false);
    expect(checkResolveNote("  sudah dicek manual  ")).toEqual({ ok: true, note: "sudah dicek manual" });
  });
  it("ack note is optional but bounded", () => {
    expect(checkOptionalNote(undefined)).toEqual({ ok: true, note: "" });
    expect(checkOptionalNote("x".repeat(1001)).ok).toBe(false);
  });
  it("maps every database outcome to a message; only ACKED / RESOLVED are successes", () => {
    for (const code of ["ACKED", "RESOLVED"]) expect(describeAlertActionOutcome(code).ok).toBe(true);
    for (const code of ["INVALID_STATE", "NOT_FOUND", "NOT_OPERATOR", "NOTE_REQUIRED", "NOTE_TOO_LONG", "ERROR", "???"]) {
      const r = describeAlertActionOutcome(code);
      expect(r.ok).toBe(false);
      expect(r.message.length).toBeGreaterThan(3);
    }
  });
  it("sync staleness", () => {
    const now = Date.parse("2026-11-01T00:10:00Z");
    expect(isSyncStale(null, now)).toBe(true);
    expect(isSyncStale("garbage", now)).toBe(true);
    expect(isSyncStale(new Date(now - PAYMENT_ALERT_STALE_AFTER_MS + 1000).toISOString(), now)).toBe(false);
    expect(isSyncStale(new Date(now - PAYMENT_ALERT_STALE_AFTER_MS - 1000).toISOString(), now)).toBe(true);
  });
});
