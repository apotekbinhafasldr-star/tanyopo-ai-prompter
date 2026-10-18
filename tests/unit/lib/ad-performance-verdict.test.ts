import { describe, expect, it } from "vitest";
import {
  evaluateAdPerformance,
  VERDICT_DISCLAIMER,
  VERDICT_LABELS,
  VERDICT_THRESHOLDS,
  type AdPerformanceInput,
} from "@/lib/ad-performance-verdict";

// Product: price 22_000, HPP 9_500 → contribution 12_500, margin ≈ 56.82 %,
// break-even ROAS = 22_000 / 12_500 = 1.76, break-even CPA = 12_500.
const BASE: AdPerformanceInput = {
  spend: 160_000,
  impressions: 12_000,
  clicks: 310,
  conversions: 14,
  revenue: 308_000,
  hpp: 9_500,
  unitPrice: 22_000,
  daysObserved: 4,
};
const with_ = (o: Partial<AdPerformanceInput>): AdPerformanceInput => ({ ...BASE, ...o });

describe("metrics", () => {
  it("computes ROAS, CPA, CTR and break-even", () => {
    const { metrics } = evaluateAdPerformance(BASE);
    expect(metrics.roas).toBeCloseTo(308_000 / 160_000, 10);
    expect(metrics.cpa).toBeCloseTo(160_000 / 14, 10);
    expect(metrics.ctr).toBeCloseTo(310 / 12_000, 10);
    expect(metrics.breakEvenRoas).toBeCloseTo(1.76, 10);
    expect(metrics.breakEvenCpa).toBe(12_500);
    expect(metrics.marginRatio).toBeCloseTo(12_500 / 22_000, 10);
  });

  it("falls back to average order value when unitPrice is absent", () => {
    const { metrics } = evaluateAdPerformance(with_({ unitPrice: undefined }));
    expect(metrics.price).toBe(22_000);
    expect(metrics.breakEvenRoas).toBeCloseTo(1.76, 10);
  });

  it("has no CPA with zero conversions and never divides by zero", () => {
    const r = evaluateAdPerformance(with_({ conversions: 0, revenue: 0 }));
    expect(r.metrics.cpa).toBeNull();
    for (const v of Object.values(r.metrics)) {
      if (v !== null) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("empty, invalid and small samples → DATA_BELUM_CUKUP", () => {
  it("handles all-null / empty input", () => {
    const r = evaluateAdPerformance({ spend: null, impressions: undefined, clicks: null, conversions: null, revenue: null });
    expect(r.verdict).toBe("DATA_BELUM_CUKUP");
    expect(r.metrics.roas).toBeNull();
  });

  it.each([
    ["NaN spend", { spend: Number.NaN }],
    ["Infinity impressions", { impressions: Number.POSITIVE_INFINITY }],
    ["negative clicks", { clicks: -5 }],
    ["negative conversions", { conversions: -1 }],
  ])("rejects %s", (_n, override) => {
    const r = evaluateAdPerformance(with_(override));
    expect(r.verdict).toBe("DATA_BELUM_CUKUP");
    expect(r.reasons.join(" ")).toMatch(/tidak valid/);
  });

  it("rejects clicks greater than impressions", () => {
    const r = evaluateAdPerformance(with_({ clicks: 20_000 }));
    expect(r.verdict).toBe("DATA_BELUM_CUKUP");
    expect(r.reasons.join(" ")).toMatch(/tidak konsisten/);
  });

  it("does not treat a high ROAS from a tiny sample as a win", () => {
    const r = evaluateAdPerformance(
      with_({ impressions: 420, clicks: 14, conversions: 3, spend: 20_000, revenue: 66_000 }),
    );
    expect(r.metrics.roas).toBe(3.3);
    expect(r.verdict).toBe("DATA_BELUM_CUKUP");
  });

  it("requires spend, impressions and clicks thresholds individually", () => {
    expect(evaluateAdPerformance(with_({ spend: 0 })).verdict).toBe("DATA_BELUM_CUKUP");
    expect(evaluateAdPerformance(with_({ impressions: VERDICT_THRESHOLDS.MIN_IMPRESSIONS - 1, clicks: 100 })).verdict).toBe(
      "DATA_BELUM_CUKUP",
    );
    expect(evaluateAdPerformance(with_({ clicks: VERDICT_THRESHOLDS.MIN_CLICKS - 1 })).verdict).toBe("DATA_BELUM_CUKUP");
  });

  it("passes the gate exactly at the thresholds", () => {
    const r = evaluateAdPerformance(with_({ impressions: 1000, clicks: 100 }));
    expect(r.verdict).not.toBe("DATA_BELUM_CUKUP");
  });
});

describe("spend without conversions", () => {
  it("is a stop-loss risk once clicks and spend are meaningful", () => {
    const r = evaluateAdPerformance(with_({ conversions: 0, revenue: 0, clicks: 250, spend: 200_000 }));
    expect(r.verdict).toBe("STOP_LOSS");
  });

  it("keeps testing when spend is still below 3x break-even CPA", () => {
    const r = evaluateAdPerformance(with_({ conversions: 0, revenue: 0, clicks: 250, spend: 30_000 }));
    expect(r.verdict).toBe("LANJUT_UJI");
  });

  it("keeps testing when clicks are below the zero-conversion threshold", () => {
    const r = evaluateAdPerformance(with_({ conversions: 0, revenue: 0, clicks: 150, spend: 200_000 }));
    expect(r.verdict).toBe("LANJUT_UJI");
  });

  it("applies the clicks rule when HPP is unknown", () => {
    const r = evaluateAdPerformance(with_({ conversions: 0, revenue: 0, clicks: 250, hpp: null, unitPrice: null }));
    expect(r.verdict).toBe("STOP_LOSS");
  });
});

describe("invalid or missing HPP / margin", () => {
  it("missing HPP: profitability not assessable, never a winner", () => {
    const r = evaluateAdPerformance(with_({ hpp: null, conversions: 80, revenue: 1_760_000, spend: 400_000 }));
    expect(r.verdict).toBe("LANJUT_UJI");
    expect(r.metrics.breakEvenRoas).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/HPP produk belum diisi/);
  });

  it("negative / NaN HPP is treated as invalid, not as zero cost", () => {
    for (const hpp of [-1, Number.NaN]) {
      const r = evaluateAdPerformance(with_({ hpp, conversions: 80, revenue: 1_760_000, spend: 400_000 }));
      expect(r.verdict).toBe("LANJUT_UJI");
      expect(r.metrics.breakEvenRoas).toBeNull();
      expect(r.reasons.join(" ")).toMatch(/HPP tidak valid/);
    }
  });

  it("unknown price (no unitPrice, no conversions) cannot give a break-even", () => {
    const r = evaluateAdPerformance(with_({ unitPrice: null, conversions: 0, revenue: 0, clicks: 150 }));
    expect(r.metrics.breakEvenRoas).toBeNull();
    expect(r.verdict).toBe("LANJUT_UJI");
  });

  it("HPP at or above the price is a stop-loss (no ROAS can be profitable)", () => {
    for (const hpp of [22_000, 30_000]) {
      const r = evaluateAdPerformance(with_({ hpp }));
      expect(r.verdict).toBe("STOP_LOSS");
      expect(r.metrics.breakEvenRoas).toBeNull();
    }
  });

  it("unavailable revenue means ROAS is null and the verdict stays LANJUT_UJI", () => {
    const r = evaluateAdPerformance(with_({ revenue: null }));
    expect(r.metrics.roas).toBeNull();
    expect(r.verdict).toBe("LANJUT_UJI");
  });
});

describe("verdict rules with a valid break-even", () => {
  it("LANJUT_UJI: above break-even by a thin margin", () => {
    const r = evaluateAdPerformance(BASE); // ROAS 1.925 vs 1.76 → 1.09x
    expect(r.verdict).toBe("LANJUT_UJI");
  });

  it("LANJUT_UJI: below break-even but close", () => {
    const r = evaluateAdPerformance(with_({ spend: 220_000 })); // ROAS 1.4 → 0.795x
    expect(r.verdict).toBe("LANJUT_UJI");
  });

  it("LANJUT_UJI: losing but spend below the 3x break-even CPA floor", () => {
    const r = evaluateAdPerformance(with_({ spend: 30_000, conversions: 1, revenue: 22_000 }));
    expect(r.verdict).toBe("LANJUT_UJI");
  });

  it("PEMENANG_AWAL: ≥1.2x break-even with ≥10 conversions", () => {
    const r = evaluateAdPerformance(with_({ spend: 140_000, conversions: 14, revenue: 308_000 })); // 2.2 → 1.25x
    expect(r.verdict).toBe("PEMENANG_AWAL");
  });

  it("does not call a winner with fewer than 10 conversions", () => {
    const r = evaluateAdPerformance(with_({ spend: 100_000, conversions: 9, revenue: 198_000 })); // ROAS 1.98 → 1.125x… still not enough
    expect(r.verdict).toBe("LANJUT_UJI");
    const strong = evaluateAdPerformance(with_({ spend: 50_000, conversions: 9, revenue: 198_000 })); // 3.96 → 2.25x
    expect(strong.verdict).toBe("LANJUT_UJI");
  });

  it("KANDIDAT_SCALING: ≥1.5x, ≥30 conversions, ≥3 days", () => {
    const r = evaluateAdPerformance(with_({ spend: 200_000, conversions: 40, revenue: 880_000, clicks: 600 })); // 4.4 → 2.5x
    expect(r.verdict).toBe("KANDIDAT_SCALING");
    expect(r.reasons.join(" ")).toMatch(/kandidat, belum terbukti/);
  });

  it("strong result without enough days stays PEMENANG_AWAL", () => {
    for (const daysObserved of [1, 2, undefined, null]) {
      const r = evaluateAdPerformance(
        with_({ spend: 200_000, conversions: 40, revenue: 880_000, clicks: 600, daysObserved }),
      );
      expect(r.verdict).toBe("PEMENANG_AWAL");
    }
  });

  it("strong ROAS with <30 conversions stays PEMENANG_AWAL", () => {
    const r = evaluateAdPerformance(with_({ spend: 100_000, conversions: 20, revenue: 440_000 })); // 4.4
    expect(r.verdict).toBe("PEMENANG_AWAL");
  });

  it("STOP_LOSS: far below break-even after meaningful spend", () => {
    const r = evaluateAdPerformance(
      with_({ spend: 520_000, conversions: 6, revenue: 132_000, impressions: 30_000, clicks: 640 }),
    );
    expect(r.verdict).toBe("STOP_LOSS");
  });

  it("sits on the right side of the 0.7x stop-loss and 1.2x winner boundaries", () => {
    const be = 22_000 / 12_500; // 1.76
    const at = (ratio: number, conversions: number) =>
      evaluateAdPerformance(with_({ spend: 100_000, conversions, revenue: 100_000 * be * ratio })).verdict;
    expect(at(0.69, 8)).toBe("STOP_LOSS");
    expect(at(0.71, 8)).toBe("LANJUT_UJI");
    expect(at(1.19, 10)).toBe("LANJUT_UJI");
    expect(at(1.21, 10)).toBe("PEMENANG_AWAL");
    expect(at(1.21, 9)).toBe("LANJUT_UJI");
  });
});

describe("output contract", () => {
  it("always carries label, recommendation, assumptions and the no-guarantee disclaimer", () => {
    for (const input of [BASE, with_({ spend: 0 }), with_({ hpp: 30_000 })]) {
      const r = evaluateAdPerformance(input);
      expect(r.label).toBe(VERDICT_LABELS[r.verdict]);
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.recommendation.length).toBeGreaterThan(0);
      expect(r.assumptions.length).toBeGreaterThan(0);
      expect(r.disclaimer).toBe(VERDICT_DISCLAIMER);
    }
    expect(VERDICT_DISCLAIMER).toMatch(/bukan jaminan/);
    expect(VERDICT_DISCLAIMER).toMatch(/bukan uji statistik/);
  });

  it("recommendations never describe an automatic action and never promise results", () => {
    const all = (["DATA_BELUM_CUKUP", "LANJUT_UJI", "PEMENANG_AWAL", "STOP_LOSS", "KANDIDAT_SCALING"] as const).map(
      (v) => {
        const sample: Record<string, Partial<AdPerformanceInput>> = {
          DATA_BELUM_CUKUP: { spend: 0 },
          LANJUT_UJI: {},
          PEMENANG_AWAL: { spend: 140_000 },
          STOP_LOSS: { hpp: 30_000 },
          KANDIDAT_SCALING: { spend: 200_000, conversions: 40, revenue: 880_000, clicks: 600 },
        };
        return evaluateAdPerformance(with_(sample[v]));
      },
    );
    expect(new Set(all.map((r) => r.verdict)).size).toBe(5);
    for (const r of all) {
      expect(r.recommendation).not.toMatch(/pasti (menang|untung)|dijamin|tanpa risiko/i);
      expect(r.recommendation).not.toMatch(/otomatis (menaikkan|dijeda|dihentikan|diajukan)/i);
    }
  });

  it("is pure: the same input gives the same output and the input is not mutated", () => {
    const input = { ...BASE };
    const a = evaluateAdPerformance(input);
    const b = evaluateAdPerformance(input);
    expect(a).toEqual(b);
    expect(input).toEqual(BASE);
  });
});
