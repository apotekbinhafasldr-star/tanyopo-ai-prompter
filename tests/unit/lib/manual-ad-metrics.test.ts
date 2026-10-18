import { describe, expect, it } from "vitest";
import {
  MANUAL_ASSUMPTION_NOTE,
  MANUAL_DATA_LABEL,
  isManualMetricsTableMissing,
  summarizeManualMetrics,
  type ManualMetricRow,
} from "@/lib/manual-ad-metrics";

const row = (over: Partial<ManualMetricRow> = {}): ManualMetricRow => ({
  metric_date: "2026-10-10",
  spend: 100000,
  impressions: 5000,
  clicks: 120,
  conversions: 6,
  revenue: 150000,
  currency: "IDR",
  ...over,
});

const product = { hpp: 9500, price: 22000, currency: "IDR" };
const ctx = { campaignCurrency: "IDR", product };

describe("summarizeManualMetrics — totals and days observed", () => {
  it("sums rows and counts DISTINCT entered dates, not the calendar span", () => {
    const s = summarizeManualMetrics(
      [row({ metric_date: "2026-10-01" }), row({ metric_date: "2026-10-09" }), row({ metric_date: "2026-10-30" })],
      ctx,
    );
    expect(s.totals).toEqual({ spend: 300000, impressions: 15000, clicks: 360, conversions: 18, revenue: 450000 });
    expect(s.daysObserved).toBe(3);
  });

  it("accepts numeric strings (PostgREST numeric) and sums them", () => {
    const s = summarizeManualMetrics([row({ spend: "100000.50", revenue: "150000.25" })], ctx);
    expect(s.totals.spend).toBe(100000.5);
    expect(s.verdict).not.toBeNull();
  });

  it("returns NO_DATA with no verdict for an empty set", () => {
    const s = summarizeManualMetrics([], ctx);
    expect(s.verdict).toBeNull();
    expect(s.blockedReason).toBe("NO_DATA");
    expect(s.daysObserved).toBe(0);
  });
});

describe("summarizeManualMetrics — integration with the Phase 2A verdict engine", () => {
  it("under-sampled data gives DATA_BELUM_CUKUP", () => {
    const s = summarizeManualMetrics([row({ impressions: 200, clicks: 5, conversions: 0, revenue: 0, spend: 20000 })], ctx);
    expect(s.verdict?.verdict).toBe("DATA_BELUM_CUKUP");
  });

  it("passes HPP, price and daysObserved to the engine: a profitable multi-day set can reach a positive verdict", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      row({ metric_date: `2026-10-0${i + 1}`, spend: 100000, impressions: 5000, clicks: 100, conversions: 10, revenue: 400000 }),
    );
    const s = summarizeManualMetrics(rows, ctx);
    expect(s.daysObserved).toBe(4);
    expect(s.verdict?.metrics.roas).toBe(4);
    expect(["PEMENANG_AWAL", "KANDIDAT_SCALING"]).toContain(s.verdict?.verdict);
  });

  it("KANDIDAT_SCALING needs at least 3 distinct days: the same numbers on 1 day cannot scale", () => {
    const one = summarizeManualMetrics(
      [row({ spend: 400000, impressions: 20000, clicks: 400, conversions: 40, revenue: 1_600_000 })],
      ctx,
    );
    expect(one.verdict?.verdict).not.toBe("KANDIDAT_SCALING");
  });

  it("HPP at or above price gives MARGIN_TIDAK_SEHAT regardless of ROAS", () => {
    const s = summarizeManualMetrics([row()], { campaignCurrency: "IDR", product: { hpp: 25000, price: 22000, currency: "IDR" } });
    expect(s.verdict?.verdict).toBe("MARGIN_TIDAK_SEHAT");
  });

  it("is purely advisory: the result carries no action, approval or write field", () => {
    const s = summarizeManualMetrics([row()], ctx);
    expect(Object.keys(s).sort()).toEqual(
      ["blockedMessage", "blockedReason", "currency", "daysObserved", "totals", "verdict", "warnings"].sort(),
    );
  });
});

describe("summarizeManualMetrics — missing HPP / product", () => {
  it("empty HPP never yields a winner/scale verdict and warns the user", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      row({ metric_date: `2026-10-0${i + 1}`, spend: 100000, impressions: 5000, clicks: 100, conversions: 10, revenue: 400000 }),
    );
    const s = summarizeManualMetrics(rows, { campaignCurrency: "IDR", product: { hpp: null, price: 22000, currency: "IDR" } });
    expect(s.verdict?.verdict).toBe("LANJUT_UJI");
    expect(s.warnings.join(" ")).toMatch(/HPP produk belum diisi/);
  });

  it("no product at all behaves the same and says so", () => {
    const s = summarizeManualMetrics([row()], { campaignCurrency: "IDR", product: null });
    expect(s.verdict?.verdict).not.toBe("PEMENANG_AWAL");
    expect(s.verdict?.verdict).not.toBe("KANDIDAT_SCALING");
    expect(s.warnings.join(" ")).toMatch(/tidak terhubung ke produk/);
  });
});

describe("summarizeManualMetrics — currency handling", () => {
  it("withholds the verdict when the product currency differs from the campaign", () => {
    const s = summarizeManualMetrics([row()], { campaignCurrency: "IDR", product: { hpp: 9500, price: 22000, currency: "USD" } });
    expect(s.verdict).toBeNull();
    expect(s.blockedReason).toBe("CURRENCY_MISMATCH");
    expect(s.blockedMessage).toMatch(/Mata uang/);
  });

  it("withholds the verdict when a stored row currency differs from the campaign currency", () => {
    const s = summarizeManualMetrics([row(), row({ metric_date: "2026-10-11", currency: "USD" })], ctx);
    expect(s.verdict).toBeNull();
    expect(s.blockedReason).toBe("CURRENCY_MISMATCH");
  });

  it("is case-insensitive about currency codes and reports the single currency", () => {
    const s = summarizeManualMetrics([row({ currency: "idr" })], { campaignCurrency: "IDR", product: { hpp: 9500, price: 22000, currency: "idr" } });
    expect(s.verdict).not.toBeNull();
    expect(s.currency).toBe("IDR");
  });

  it("withholds the verdict when the campaign currency is unknown", () => {
    const s = summarizeManualMetrics([row()], { campaignCurrency: null, product });
    expect(s.verdict).toBeNull();
  });
});

describe("summarizeManualMetrics — corrupt stored data", () => {
  it.each([
    ["negative spend", { spend: -5 }],
    ["NaN impressions", { impressions: Number.NaN }],
    ["non-numeric clicks", { clicks: "abc" }],
    ["null revenue", { revenue: null }],
    ["empty date", { metric_date: "" }],
    ["empty currency", { currency: "" }],
  ])("%s -> INVALID_DATA and no verdict", (_n, patch) => {
    const s = summarizeManualMetrics([row(patch as Partial<ManualMetricRow>)], ctx);
    expect(s.verdict).toBeNull();
    expect(s.blockedReason).toBe("INVALID_DATA");
  });
});

describe("labels and table-missing detection", () => {
  it("exports the exact label required by the Founder", () => {
    expect(MANUAL_DATA_LABEL).toBe("Data input manual, belum diverifikasi platform");
  });

  it("states the one-conversion-one-unit assumption", () => {
    expect(MANUAL_ASSUMPTION_NOTE).toMatch(/1 konversi = 1 unit/);
  });

  it("recognises a missing table across Postgres and PostgREST error shapes", () => {
    expect(isManualMetricsTableMissing({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isManualMetricsTableMissing({ code: "PGRST205", message: "x" })).toBe(true);
    expect(
      isManualMetricsTableMissing({ message: "Could not find the table 'public.prompter_manual_ad_metrics' in the schema cache" }),
    ).toBe(true);
  });

  it("does not mistake other errors for a missing table", () => {
    expect(isManualMetricsTableMissing(null)).toBe(false);
    expect(isManualMetricsTableMissing({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isManualMetricsTableMissing({ code: "42501", message: "permission denied" })).toBe(false);
  });
});
