import type { FinanceSnapshot } from "./book";
import { localDate, monthKey, WIB_OFFSET_MINUTES, yearKey } from "./dates";
import { add, compare, mulBps, sub, taxPortionOfInclusive, zero, type Money } from "./money";
import { analyzeRefunds } from "./refunds";

/**
 * Tax turnover recap.
 *
 * This module NEVER assumes a tax rate or the company's tax status. Every rate
 * comes from a `TaxConfig` row that a human has marked as verified (who and
 * when). Without verified config, turnover is still reported, but the tax
 * figures are `null` with an explicit reason, never a guess.
 *
 * It produces a recap to hand to the accountant. It is not a tax return.
 */

export type PkpStatus = "UNVERIFIED" | "PKP" | "NON_PKP";

export interface TaxConfig {
  readonly pkpStatus: PkpStatus;
  /** PPN rate in basis points (1% = 100). `null` = not configured. */
  readonly ppnRateBps: number | null;
  /** Whether recorded customer prices already include PPN. `null` = not configured. */
  readonly pricesIncludePpn: boolean | null;
  /** Final income tax rate on turnover in basis points. `null` = not configured. */
  readonly finalTaxRateBps: number | null;
  /** Optional annual turnover threshold to watch, from the accountant. `null` = none. */
  readonly annualThreshold: Money | null;
  /** Who confirmed this configuration, and when. Both required for it to count as verified. */
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}

export const UNVERIFIED_TAX_CONFIG: TaxConfig = {
  pkpStatus: "UNVERIFIED",
  ppnRateBps: null,
  pricesIncludePpn: null,
  finalTaxRateBps: null,
  annualThreshold: null,
  verifiedBy: null,
  verifiedAt: null,
};

export function isTaxConfigVerified(config: TaxConfig): boolean {
  return Boolean(config.verifiedBy && config.verifiedAt) && config.pkpStatus !== "UNVERIFIED";
}

function validBps(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0 && value <= 10000;
}

export type TaxFigure =
  | { readonly status: "COMPUTED"; readonly amount: Money }
  | { readonly status: "NOT_APPLICABLE"; readonly reason: string }
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string };

export interface TurnoverMonth {
  readonly month: string;
  /** Verified payments received in the month. */
  readonly grossReceived: Money;
  /** Processed refunds (applied) in the month. */
  readonly refunds: Money;
  /** grossReceived - refunds. Can be negative in a month with more refunds than receipts. */
  readonly netTurnover: Money;
  readonly ppn: TaxFigure;
  readonly finalTax: TaxFigure;
}

export interface TurnoverRecap {
  readonly currency: string;
  readonly year: string;
  readonly configVerified: boolean;
  readonly months: readonly TurnoverMonth[];
  readonly yearTurnover: Money;
  readonly thresholdReached: boolean | null;
  readonly warnings: readonly string[];
}

function ppnFigure(config: TaxConfig, verified: boolean, netTurnover: Money): TaxFigure {
  if (!verified) {
    return { status: "NOT_CONFIGURED", reason: "Tax status is not verified by the accountant" };
  }
  if (config.pkpStatus === "NON_PKP") {
    return { status: "NOT_APPLICABLE", reason: "Company is configured as non-PKP" };
  }
  if (!validBps(config.ppnRateBps)) {
    return { status: "NOT_CONFIGURED", reason: "PPN rate is not configured" };
  }
  if (config.pricesIncludePpn === null) {
    return { status: "NOT_CONFIGURED", reason: "It is not configured whether prices include PPN" };
  }
  const amount = config.pricesIncludePpn
    ? taxPortionOfInclusive(netTurnover, config.ppnRateBps)
    : mulBps(netTurnover, config.ppnRateBps);
  return { status: "COMPUTED", amount };
}

function finalTaxFigure(config: TaxConfig, verified: boolean, netTurnover: Money): TaxFigure {
  if (!verified) {
    return { status: "NOT_CONFIGURED", reason: "Tax status is not verified by the accountant" };
  }
  if (!validBps(config.finalTaxRateBps)) {
    return { status: "NOT_CONFIGURED", reason: "Final tax rate is not configured" };
  }
  // The final-tax base is turnover excluding PPN when prices include it.
  const base =
    config.pkpStatus === "PKP" && config.pricesIncludePpn === true && validBps(config.ppnRateBps)
      ? sub(netTurnover, taxPortionOfInclusive(netTurnover, config.ppnRateBps))
      : netTurnover;
  return { status: "COMPUTED", amount: mulBps(base, config.finalTaxRateBps) };
}

/**
 * Monthly turnover recap for one calendar year (local time). Turnover here is
 * cash-basis (verified payments received less processed refunds), because that
 * is what most turnover-based taxes are reported on; confirm with the accountant.
 */
export function turnoverRecap(
  snapshot: FinanceSnapshot,
  year: string,
  config: TaxConfig = UNVERIFIED_TAX_CONFIG,
  offsetMinutes: number = WIB_OFFSET_MINUTES,
): TurnoverRecap {
  if (!/^\d{4}$/.test(year)) throw new Error("year must be YYYY");
  const cur = snapshot.currency;
  const verified = isTaxConfigVerified(config);
  const warnings: string[] = [];
  if (!verified) {
    warnings.push("Tax configuration is not verified; tax amounts are not computed.");
  }

  const received = new Map<string, Money>();
  const refunded = new Map<string, Money>();
  for (const p of snapshot.payments) {
    const d = localDate(p.paidAt, offsetMinutes);
    if (yearKey(d) !== year) continue;
    const m = monthKey(d);
    received.set(m, add(received.get(m) ?? zero(cur), p.amount));
  }
  for (const r of analyzeRefunds(snapshot, offsetMinutes).applied) {
    if (yearKey(r.effectiveDate) !== year) continue;
    const m = monthKey(r.effectiveDate);
    refunded.set(m, add(refunded.get(m) ?? zero(cur), r.applied));
  }

  const monthKeys = [...new Set([...received.keys(), ...refunded.keys()])].sort();
  const months: TurnoverMonth[] = [];
  let yearTurnover = zero(cur);
  for (const month of monthKeys) {
    const grossReceived = received.get(month) ?? zero(cur);
    const refunds = refunded.get(month) ?? zero(cur);
    const netTurnover = sub(grossReceived, refunds);
    yearTurnover = add(yearTurnover, netTurnover);
    months.push({
      month,
      grossReceived,
      refunds,
      netTurnover,
      ppn: ppnFigure(config, verified, netTurnover),
      finalTax: finalTaxFigure(config, verified, netTurnover),
    });
  }

  let thresholdReached: boolean | null = null;
  if (config.annualThreshold) {
    thresholdReached = compare(yearTurnover, config.annualThreshold) >= 0;
  } else {
    warnings.push("No annual turnover threshold configured.");
  }

  return { currency: cur, year, configVerified: verified, months, yearTurnover, thresholdReached, warnings };
}
