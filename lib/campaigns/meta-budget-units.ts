/**
 * Meta budget units (Phase 1B). Meta takes a budget in the account currency's
 * smallest unit; how many such units one whole unit of a currency has is a
 * property of that currency on Meta, NOT something this code may assume. In
 * particular the unit for IDR is NOT assumed to be 1.
 *
 * The table below therefore lists IDR with `verified: false` and no factor.
 * `resolveMetaBudgetMinorUnits` fails closed for it until the factor is
 * confirmed against Meta's documentation or a controlled test on a Meta test
 * ad account (separate Founder approval) and BOTH fields are changed in a
 * reviewed code change.
 *
 * Pure: no network, database, environment or connector access.
 *
 * Wired into the launch path through lib/campaigns/meta-launch-budget.ts
 * (Phase 1C-A). The ad account's currency is not yet verifiable from the
 * launch path, so every launch is refused, and the External Budget Safety Gate
 * is closed as well. A tripwire test fails if the gate is ever opened for META
 * while the launch code does not use the launch-budget validator.
 *
 * Evidence on the IDR unit (Meta developer docs, read in Phase 1C-A):
 *  - Budgets page: "The amount you set for bid and budget is at ad account
 *    currencies minimum denomination level, such as cents for USD."
 *  - Currencies page: IDR is listed with offset 1, and "If a currency has an
 *    offset of 1, then the minimum bid equals one base currency unit." That
 *    page speaks of BIDS, not budgets.
 *  Together they suggest 1 rupiah = 1 budget unit, but no page states the IDR
 *  budget unit explicitly. That is an inference, not a proof, so IDR stays
 *  `verified: false`. Verification needs a controlled check on a Meta test ad
 *  account (separate Founder approval) and a reviewed change of BOTH fields.
 */

export interface MetaCurrencyBudgetUnit {
  /** Smallest units per whole currency unit; `null` = unknown. */
  readonly minorUnitsPerUnit: number | null;
  readonly verified: boolean;
}

export const META_CURRENCY_BUDGET_UNITS: Readonly<Record<string, MetaCurrencyBudgetUnit>> = Object.freeze({
  IDR: Object.freeze({ minorUnitsPerUnit: null, verified: false }),
});

export type MetaBudgetUnitFailureCode =
  | "AMOUNT_INVALID"
  | "CURRENCY_UNVERIFIED"
  | "CURRENCY_MISMATCH"
  | "CURRENCY_UNSUPPORTED"
  | "UNIT_UNVERIFIED"
  | "AMOUNT_TOO_LARGE";

export type MetaBudgetUnitResult =
  | { ok: true; minorUnits: number }
  | { ok: false; code: MetaBudgetUnitFailureCode; message: string };

const MESSAGES: Record<MetaBudgetUnitFailureCode, string> = {
  AMOUNT_INVALID: "Nilai budget tidak valid (harus bilangan bulat positif). Budget tidak dikirim ke Meta.",
  CURRENCY_UNVERIFIED: "Mata uang akun iklan Meta belum terverifikasi. Budget tidak dikirim ke Meta.",
  CURRENCY_MISMATCH: "Mata uang akun iklan berbeda dari mata uang campaign. Budget tidak dikirim ke Meta.",
  CURRENCY_UNSUPPORTED: "Mata uang ini belum didukung untuk budget Meta. Budget tidak dikirim ke Meta.",
  UNIT_UNVERIFIED: "Satuan budget Meta untuk mata uang ini belum terverifikasi. Budget tidak dikirim ke Meta.",
  AMOUNT_TOO_LARGE: "Nilai budget terlalu besar untuk dikonversi dengan aman. Budget tidak dikirim ke Meta.",
};

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function fail(code: MetaBudgetUnitFailureCode): MetaBudgetUnitResult {
  return { ok: false, code, message: MESSAGES[code] };
}

/** First failing check wins. Never echoes an input value. `table` is injectable for tests only. */
export function resolveMetaBudgetMinorUnits(
  input: { wholeAmount: unknown; campaignCurrency: unknown; accountCurrency: unknown },
  table: Readonly<Record<string, MetaCurrencyBudgetUnit>> = META_CURRENCY_BUDGET_UNITS,
): MetaBudgetUnitResult {
  const { wholeAmount, campaignCurrency, accountCurrency } = input;
  if (typeof wholeAmount !== "number" || !Number.isSafeInteger(wholeAmount) || wholeAmount < 1) return fail("AMOUNT_INVALID");
  if (typeof accountCurrency !== "string" || accountCurrency.length === 0) return fail("CURRENCY_UNVERIFIED");
  if (typeof campaignCurrency !== "string" || campaignCurrency !== accountCurrency) return fail("CURRENCY_MISMATCH");
  if (!has(table, accountCurrency)) return fail("CURRENCY_UNSUPPORTED");

  const unit = table[accountCurrency];
  const factor = unit.minorUnitsPerUnit;
  if (!unit.verified || typeof factor !== "number" || !Number.isSafeInteger(factor) || factor < 1) {
    return fail("UNIT_UNVERIFIED");
  }
  const minorUnits = wholeAmount * factor;
  if (!Number.isSafeInteger(minorUnits)) return fail("AMOUNT_TOO_LARGE");
  return { ok: true, minorUnits };
}
