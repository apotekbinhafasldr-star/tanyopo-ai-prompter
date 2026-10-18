import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MANUAL_METRIC_LIMITS,
  buildManualMetricCreateSchema,
  firstIssueMessage,
  manualMetricValuesSchema,
  parseCalendarDate,
  validateMetricDate,
} from "@/schemas/manual-ad-metrics";

const NOW = new Date("2026-10-18T10:00:00Z");
const CC = "8f1c3a52-6a3e-4b8e-9a3b-2f7d6f6f2c11";

const valid = {
  channelCampaignId: CC,
  metricDate: "2026-10-17",
  spend: "150000",
  impressions: "12500",
  clicks: "240",
  conversions: "12",
  revenue: "480000",
};

const schema = buildManualMetricCreateSchema(NOW);
const messageFor = (input: Record<string, unknown>) => {
  const r = schema.safeParse(input);
  return r.success ? null : firstIssueMessage(r.error);
};

describe("manual ad metrics — create schema", () => {
  it("accepts a valid entry and returns numbers", () => {
    const r = schema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.spend).toBe(150000);
      expect(r.data.impressions).toBe(12500);
      expect(r.data.revenue).toBe(480000);
    }
  });

  it("accepts decimals up to 2 places with a dot", () => {
    expect(schema.safeParse({ ...valid, spend: "150000.5", revenue: "480000.25" }).success).toBe(true);
  });

  it("accepts zeros (a day with no spend / no sales)", () => {
    expect(schema.safeParse({ ...valid, spend: "0", clicks: "0", conversions: "0", revenue: "0" }).success).toBe(true);
  });

  it("does not accept the currency from the client (it is not a field)", () => {
    const r = schema.safeParse({ ...valid, currency: "USD" });
    expect(r.success).toBe(true);
    if (r.success) expect("currency" in r.data).toBe(false);
  });

  it.each([
    ["empty string must not become 0", { spend: "" }],
    ["whitespace only", { spend: "   " }],
    ["missing field", { spend: undefined }],
    ["negative number", { spend: "-1" }],
    ["NaN text", { spend: "NaN" }],
    ["Infinity text", { spend: "Infinity" }],
    ["exponent notation", { spend: "1e5" }],
    ["comma decimal", { spend: "150,5" }],
    ["Indonesian thousands separator would be misread as 150.00", { spend: "150.000" }],
    ["thousands separators in a count", { impressions: "12.500" }],
    ["3 decimals", { revenue: "10.123" }],
    ["decimal in a count", { clicks: "10.5" }],
    ["letters", { clicks: "abc" }],
    ["hex", { clicks: "0x10" }],
    ["a plus sign", { clicks: "+10" }],
  ])("rejects %s", (_name, patch) => {
    expect(schema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("explains the thousands-separator mistake instead of silently accepting it", () => {
    expect(messageFor({ ...valid, spend: "150.000" })).toMatch(/tanpa titik\/koma pemisah ribuan/);
  });

  it("rejects values above the same caps the database CHECK constraints use", () => {
    expect(MANUAL_METRIC_LIMITS.maxMoney).toBe(100_000_000_000);
    expect(schema.safeParse({ ...valid, spend: "100000000001" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, spend: "100000000000" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, impressions: "10000000001" }).success).toBe(false);
  });

  it("rejects clicks above impressions, conversions above clicks, and revenue without conversions", () => {
    expect(messageFor({ ...valid, impressions: "100", clicks: "101" })).toMatch(/Klik tidak boleh lebih besar/);
    expect(messageFor({ ...valid, clicks: "10", conversions: "11" })).toMatch(/Konversi tidak boleh lebih besar/);
    expect(messageFor({ ...valid, conversions: "0", revenue: "1" })).toMatch(/Omzet hanya boleh diisi/);
  });

  it("rejects a bad channel campaign id", () => {
    expect(schema.safeParse({ ...valid, channelCampaignId: "nope" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, channelCampaignId: undefined }).success).toBe(false);
  });
});

describe("manual ad metrics — dates", () => {
  it("parses real calendar dates only", () => {
    expect(parseCalendarDate("2026-02-28")).not.toBeNull();
    expect(parseCalendarDate("2026-02-30")).toBeNull();
    expect(parseCalendarDate("2026-13-01")).toBeNull();
    expect(parseCalendarDate("26-10-18")).toBeNull();
    expect(parseCalendarDate("2026-10-18T00:00:00Z")).toBeNull();
    expect(parseCalendarDate("")).toBeNull();
  });

  it("accepts today and tomorrow (timezones ahead of UTC) but not the day after", () => {
    expect(validateMetricDate("2026-10-18", NOW)).toBeNull();
    expect(validateMetricDate("2026-10-19", NOW)).toBeNull();
    expect(validateMetricDate("2026-10-20", NOW)).toMatch(/masa depan/);
  });

  it("accepts up to the maximum days back and rejects older", () => {
    const edge = new Date(Date.UTC(2026, 9, 18) - MANUAL_METRIC_LIMITS.maxDaysBack * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const tooOld = new Date(Date.UTC(2026, 9, 18) - (MANUAL_METRIC_LIMITS.maxDaysBack + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(validateMetricDate(edge, NOW)).toBeNull();
    expect(validateMetricDate(tooOld, NOW)).toMatch(/terlalu lama/);
  });

  it("rejects an impossible date through the schema", () => {
    expect(messageFor({ ...valid, metricDate: "2026-02-30" })).toMatch(/Tanggal tidak valid/);
    expect(messageFor({ ...valid, metricDate: "2030-01-01" })).toMatch(/masa depan/);
  });
});

describe("manual ad metrics — edit schema (metrics only)", () => {
  it("validates the same rules and has no date/channel/currency fields", () => {
    const ok = manualMetricValuesSchema.safeParse({
      spend: "1000",
      impressions: "100",
      clicks: "10",
      conversions: "1",
      revenue: "5000",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(Object.keys(ok.data).sort()).toEqual(["clicks", "conversions", "impressions", "revenue", "spend"]);
    expect(
      manualMetricValuesSchema.safeParse({ spend: "1", impressions: "1", clicks: "2", conversions: "0", revenue: "0" })
        .success,
    ).toBe(false);
  });
});

describe("manual ad metrics — limits match the migration's CHECK constraints", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261018160000_prompter_manual_ad_metrics.sql"),
    "utf-8",
  );
  it("money and impression caps are identical in code and SQL", () => {
    expect(sql).toContain(`spend <= ${MANUAL_METRIC_LIMITS.maxMoney}`);
    expect(sql).toContain(`revenue <= ${MANUAL_METRIC_LIMITS.maxMoney}`);
    expect(sql).toContain(`impressions <= ${MANUAL_METRIC_LIMITS.maxImpressions}`);
  });
});
