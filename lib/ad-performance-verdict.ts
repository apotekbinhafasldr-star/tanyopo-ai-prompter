/**
 * Ad Performance Verdict (Winning Ads Intelligence, Phase 2A).
 *
 * A pure, deterministic, Supabase-free and network-free calculation: it
 * takes aggregated ad numbers that the caller already has (today only the
 * simulated demo dataset) and returns ROAS / CPA / CTR / break-even ROAS
 * plus a conservative verdict. It never writes anywhere, never calls an
 * ad platform and never submits anything for approval: the result is a
 * recommendation to *display*, and every decision stays with the user.
 *
 * ## What the verdict is — and is not
 * - It is a rule-of-thumb reading of the numbers it was given. It is NOT a
 *   statistical test and reports no confidence percentage: with a single
 *   aggregate per ad there is no honest way to compute one.
 * - `PEMENANG_AWAL` / `KANDIDAT_SCALING` mean "a candidate", never a
 *   proven winner, and never a promise of future results.
 *
 * ## Definitions
 * - ROAS = revenue / spend.            CPA = spend / conversions.
 * - CTR  = clicks / impressions.
 * - price = `unitPrice` when valid, otherwise average order value
 *   (revenue / conversions) when conversions > 0.
 * - contribution per order = price − hpp.
 * - margin ratio = contribution per order / price.
 * - break-even ROAS = 1 / margin ratio = price / contribution per order:
 *   the ROAS at which revenue after product cost exactly pays for ad
 *   spend (a contribution of zero; other operating costs are not known
 *   to the app, same limitation as lib/profit-estimate.ts).
 * - break-even CPA = contribution per order.
 *
 * ## Thresholds (all in VERDICT_THRESHOLDS, covered by unit tests)
 * Data sufficiency gate — below any of these the verdict is always
 * `DATA_BELUM_CUKUP`, however good the ROAS looks:
 *   impressions >= 1000, clicks >= 100, spend > 0.
 *
 * After the gate, rules run in this order (first match wins):
 *  1. Margin not positive (hpp >= price) → `STOP_LOSS`: no ROAS can be
 *     profitable.
 *  2. Zero conversions → `STOP_LOSS` only when clicks >= 200 and (the
 *     spend is >= 3 × break-even CPA, or break-even CPA is unknown);
 *     otherwise `LANJUT_UJI`.
 *  3. Profitability not assessable (no/invalid hpp, no price, no revenue)
 *     → `LANJUT_UJI`. Without a break-even there is never a winner or a
 *     scaling verdict.
 *  4. ROAS < 0.7 × break-even ROAS and spend >= 3 × break-even CPA →
 *     `STOP_LOSS`. (The spend floor keeps one unlucky day from condemning
 *     an ad.)
 *  5. ROAS >= 1.5 × break-even, conversions >= 30 and daysObserved >= 3 →
 *     `KANDIDAT_SCALING`. daysObserved missing counts as "not enough".
 *  6. ROAS >= 1.2 × break-even and conversions >= 10 → `PEMENANG_AWAL`.
 *  7. Everything else → `LANJUT_UJI`.
 *
 * The multipliers (0.7 / 1.2 / 1.5 / 3 / 10 / 30 / 200 / 1000 / 100 / 3
 * days) are conservative product heuristics chosen for this phase, not
 * statistically derived values; they should be revisited against real
 * (non-simulated) data before being presented as anything more.
 */

export type AdVerdict =
  | "DATA_BELUM_CUKUP"
  | "LANJUT_UJI"
  | "PEMENANG_AWAL"
  | "STOP_LOSS"
  | "KANDIDAT_SCALING";

export const VERDICT_THRESHOLDS = Object.freeze({
  MIN_IMPRESSIONS: 1000,
  MIN_CLICKS: 100,
  /** Clicks needed before zero conversions alone is treated as a stop-loss risk. */
  MIN_CLICKS_ZERO_CONVERSION_STOP: 200,
  /** Spend must reach this multiple of break-even CPA before a loss is called. */
  STOP_LOSS_SPEND_MULTIPLE: 3,
  /** ROAS below this share of break-even ROAS (with enough spend) is a stop-loss risk. */
  STOP_LOSS_ROAS_RATIO: 0.7,
  EARLY_WINNER_ROAS_RATIO: 1.2,
  EARLY_WINNER_MIN_CONVERSIONS: 10,
  SCALING_ROAS_RATIO: 1.5,
  SCALING_MIN_CONVERSIONS: 30,
  SCALING_MIN_DAYS: 3,
});

export const VERDICT_LABELS: Record<AdVerdict, string> = {
  DATA_BELUM_CUKUP: "Data belum cukup",
  LANJUT_UJI: "Lanjut uji",
  PEMENANG_AWAL: "Kandidat pemenang awal",
  STOP_LOSS: "Risiko stop-loss",
  KANDIDAT_SCALING: "Kandidat scaling",
};

export const VERDICT_DISCLAIMER =
  "Ini pembacaan aturan sederhana dari angka yang tercatat, bukan uji statistik dan bukan jaminan hasil iklan. Keputusan tetap di tangan Anda.";

export interface AdPerformanceInput {
  spend: number | null | undefined;
  impressions: number | null | undefined;
  clicks: number | null | undefined;
  conversions: number | null | undefined;
  revenue: number | null | undefined;
  /** Product cost (HPP) per unit. */
  hpp?: number | null;
  /** Selling price per unit; when absent, average order value is used. */
  unitPrice?: number | null;
  /** Number of days the numbers cover; required to ever reach KANDIDAT_SCALING. */
  daysObserved?: number | null;
}

export interface AdPerformanceMetrics {
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  /** price used for the margin (unitPrice, or average order value). */
  price: number | null;
  marginRatio: number | null;
  breakEvenRoas: number | null;
  /** Break-even CPA = contribution per order. */
  breakEvenCpa: number | null;
}

export interface AdPerformanceVerdict {
  verdict: AdVerdict;
  label: string;
  /** Plain-language reasons, in Indonesian, safe to display. */
  reasons: string[];
  /** Advice for the user to consider; never an executed action. */
  recommendation: string;
  metrics: AdPerformanceMetrics;
  /** Assumptions behind the numbers, shown next to the verdict. */
  assumptions: string[];
  disclaimer: string;
}

const T = VERDICT_THRESHOLDS;

function isValidAmount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function safeDiv(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

const EMPTY_METRICS: AdPerformanceMetrics = {
  roas: null,
  cpa: null,
  ctr: null,
  price: null,
  marginRatio: null,
  breakEvenRoas: null,
  breakEvenCpa: null,
};

const RECOMMENDATIONS: Record<AdVerdict, string> = {
  DATA_BELUM_CUKUP: "Biarkan iklan terkumpul datanya dulu sebelum menilai. Jangan menyimpulkan menang atau kalah dari angka sekecil ini.",
  LANJUT_UJI: "Lanjutkan pengujian dan kumpulkan lebih banyak data sebelum mengubah budget.",
  PEMENANG_AWAL:
    "Iklan ini menjanjikan, tetapi belum terbukti. Pertimbangkan melanjutkan dan memverifikasi hasilnya beberapa hari lagi sebelum menambah budget.",
  STOP_LOSS:
    "Pertimbangkan menjeda atau meninjau ulang iklan ini (creative, audiens, atau harga) agar kerugian tidak bertambah. Tidak ada tindakan yang dijalankan otomatis.",
  KANDIDAT_SCALING:
    "Iklan ini layak dipertimbangkan untuk dinaikkan budgetnya secara bertahap sambil dipantau. Keputusan dan persetujuan ada pada Anda; tidak ada perubahan otomatis.",
};

export function evaluateAdPerformance(input: AdPerformanceInput): AdPerformanceVerdict {
  const assumptions: string[] = [
    "ROAS = pendapatan ÷ biaya iklan; CPA = biaya iklan ÷ konversi; CTR = klik ÷ tayangan.",
    "Break-even ROAS dihitung dari harga dan HPP per unit; biaya operasional lain tidak diperhitungkan.",
  ];

  const finish = (
    verdict: AdVerdict,
    reasons: string[],
    metrics: AdPerformanceMetrics,
  ): AdPerformanceVerdict => ({
    verdict,
    label: VERDICT_LABELS[verdict],
    reasons,
    recommendation: RECOMMENDATIONS[verdict],
    metrics,
    assumptions,
    disclaimer: VERDICT_DISCLAIMER,
  });

  // --- Input validation: required numbers must be present, finite, >= 0. ---
  const required = {
    "biaya iklan": input.spend,
    tayangan: input.impressions,
    klik: input.clicks,
    konversi: input.conversions,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !isValidAmount(v))
    .map(([k]) => k);
  if (missing.length > 0) {
    return finish(
      "DATA_BELUM_CUKUP",
      [`Data tidak tersedia atau tidak valid: ${missing.join(", ")}.`],
      EMPTY_METRICS,
    );
  }
  const spend = input.spend as number;
  const impressions = input.impressions as number;
  const clicks = input.clicks as number;
  const conversions = input.conversions as number;
  if (clicks > impressions) {
    return finish("DATA_BELUM_CUKUP", ["Data tidak konsisten: jumlah klik melebihi tayangan."], EMPTY_METRICS);
  }

  // Revenue is optional-but-needed for ROAS; an invalid value is treated as unavailable.
  const revenue = isValidAmount(input.revenue) ? input.revenue : null;

  // --- Metrics. ---
  const ctr = safeDiv(clicks, impressions);
  const cpa = safeDiv(spend, conversions);
  const roas = revenue !== null ? safeDiv(revenue, spend) : null;

  // --- Margin / break-even. ---
  const hppValid = isValidAmount(input.hpp);
  let price: number | null = null;
  if (isValidAmount(input.unitPrice) && input.unitPrice > 0) {
    price = input.unitPrice;
  } else if (revenue !== null && conversions > 0) {
    price = safeDiv(revenue, conversions);
  }

  let marginRatio: number | null = null;
  let breakEvenRoas: number | null = null;
  let breakEvenCpa: number | null = null;
  let nonPositiveMargin = false;
  let marginNote: string | null = null;

  if (!hppValid) {
    marginNote =
      input.hpp === null || input.hpp === undefined
        ? "HPP produk belum diisi, jadi break-even tidak dapat dihitung."
        : "HPP tidak valid, jadi break-even tidak dapat dihitung.";
  } else if (price === null || price <= 0) {
    marginNote = "Harga jual per unit tidak diketahui, jadi break-even tidak dapat dihitung.";
  } else {
    const contribution = price - (input.hpp as number);
    if (contribution <= 0) {
      nonPositiveMargin = true;
    } else {
      marginRatio = contribution / price;
      breakEvenRoas = price / contribution;
      breakEvenCpa = contribution;
    }
  }

  const metrics: AdPerformanceMetrics = { roas, cpa, ctr, price, marginRatio, breakEvenRoas, breakEvenCpa };

  // --- Sufficiency gate. ---
  const shortfalls: string[] = [];
  if (spend <= 0) shortfalls.push("belum ada biaya iklan");
  if (impressions < T.MIN_IMPRESSIONS) shortfalls.push(`tayangan < ${T.MIN_IMPRESSIONS}`);
  if (clicks < T.MIN_CLICKS) shortfalls.push(`klik < ${T.MIN_CLICKS}`);
  if (shortfalls.length > 0) {
    return finish(
      "DATA_BELUM_CUKUP",
      [`Sampel masih terlalu kecil untuk dinilai (${shortfalls.join(", ")}). ROAS dari sampel sekecil ini tidak dapat dipercaya.`],
      metrics,
    );
  }

  const spendFloor = breakEvenCpa !== null ? T.STOP_LOSS_SPEND_MULTIPLE * breakEvenCpa : null;
  const spendReachedFloor = spendFloor !== null && spend >= spendFloor;

  // 1. Margin not positive.
  if (nonPositiveMargin) {
    return finish(
      "STOP_LOSS",
      ["HPP sama dengan atau lebih tinggi dari harga jual, sehingga setiap penjualan tidak menghasilkan kontribusi sebelum biaya iklan."],
      metrics,
    );
  }

  // 2. Zero conversions.
  if (conversions === 0) {
    if (clicks >= T.MIN_CLICKS_ZERO_CONVERSION_STOP && (spendFloor === null || spendReachedFloor)) {
      return finish(
        "STOP_LOSS",
        [`Sudah ${clicks} klik dan biaya tercatat, tetapi belum ada satu pun konversi.`],
        metrics,
      );
    }
    return finish(
      "LANJUT_UJI",
      ["Belum ada konversi, tetapi biaya atau klik belum cukup untuk menyimpulkan iklan ini gagal."],
      metrics,
    );
  }

  // 3. Profitability not assessable.
  if (breakEvenRoas === null || roas === null) {
    const why = marginNote ?? "Pendapatan tidak tersedia, jadi ROAS tidak dapat dihitung.";
    return finish(
      "LANJUT_UJI",
      [`${why} Tanpa break-even, iklan tidak dapat dinilai menang atau kalah.`],
      metrics,
    );
  }

  const ratio = roas / breakEvenRoas;

  // 4. Clear loss.
  if (ratio < T.STOP_LOSS_ROAS_RATIO && spendReachedFloor) {
    return finish(
      "STOP_LOSS",
      [`ROAS ${roas.toFixed(2)}x jauh di bawah break-even ${breakEvenRoas.toFixed(2)}x setelah biaya iklan cukup besar.`],
      metrics,
    );
  }

  // 5. Scaling candidate.
  const days = isValidAmount(input.daysObserved) ? input.daysObserved : null;
  if (ratio >= T.SCALING_ROAS_RATIO && conversions >= T.SCALING_MIN_CONVERSIONS && days !== null && days >= T.SCALING_MIN_DAYS) {
    return finish(
      "KANDIDAT_SCALING",
      [
        `ROAS ${roas.toFixed(2)}x, ${ratio.toFixed(2)} kali break-even ${breakEvenRoas.toFixed(2)}x.`,
        `${conversions} konversi selama ${days} hari. Ini kandidat, belum terbukti.`,
      ],
      metrics,
    );
  }

  // 6. Early winner.
  if (ratio >= T.EARLY_WINNER_ROAS_RATIO && conversions >= T.EARLY_WINNER_MIN_CONVERSIONS) {
    const reasons = [
      `ROAS ${roas.toFixed(2)}x, ${ratio.toFixed(2)} kali break-even ${breakEvenRoas.toFixed(2)}x, dari ${conversions} konversi.`,
    ];
    if (ratio >= T.SCALING_ROAS_RATIO && (days === null || days < T.SCALING_MIN_DAYS)) {
      reasons.push(`Hasil kuat, tetapi belum teramati minimal ${T.SCALING_MIN_DAYS} hari, jadi belum menjadi kandidat scaling.`);
    } else if (ratio >= T.SCALING_ROAS_RATIO) {
      reasons.push(`Konversi belum mencapai ${T.SCALING_MIN_CONVERSIONS} untuk menjadi kandidat scaling.`);
    }
    return finish("PEMENANG_AWAL", reasons, metrics);
  }

  // 7. Keep testing.
  let reason: string;
  if (ratio >= 1) {
    reason = `ROAS ${roas.toFixed(2)}x sudah di atas break-even ${breakEvenRoas.toFixed(2)}x, tetapi selisihnya tipis atau konversinya (${conversions}) masih sedikit.`;
  } else if (ratio >= T.STOP_LOSS_ROAS_RATIO) {
    reason = `ROAS ${roas.toFixed(2)}x di bawah break-even ${breakEvenRoas.toFixed(2)}x, tetapi masih mendekati; belum cukup untuk menyimpulkan rugi.`;
  } else {
    reason = `ROAS ${roas.toFixed(2)}x di bawah break-even ${breakEvenRoas.toFixed(2)}x, tetapi biaya iklan belum cukup besar untuk menyimpulkan rugi.`;
  }
  return finish("LANJUT_UJI", [reason], metrics);
}
