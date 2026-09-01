/**
 * FX conversion abstraction (product spec §5, §13): "Do not invent live
 * FX rates. If currency conversion is not backed by a configured FX
 * provider, mark conversion NOT_CONFIGURED." No FX provider is
 * integrated in this pass, so this always returns NOT_CONFIGURED — the
 * point of having the type now is that a real provider (e.g. an
 * exchangerate API) can implement FxRateProvider later and every caller
 * (analytics aggregation, cross-currency reporting) already knows how to
 * render the NOT_CONFIGURED case instead of silently summing mismatched
 * currencies.
 */

export interface FxConversionResult {
  status: "CONVERTED" | "NOT_CONFIGURED" | "SAME_CURRENCY";
  amount: number | null;
  rate: number | null;
}

export interface FxRateProvider {
  readonly name: string;
  isConfigured(): boolean;
  getRate(from: string, to: string): Promise<number>;
}

class NullFxRateProvider implements FxRateProvider {
  readonly name = "none";
  isConfigured(): boolean {
    return false;
  }
  async getRate(): Promise<number> {
    throw new Error("Belum ada FX provider yang dikonfigurasi.");
  }
}

const fxProvider: FxRateProvider = new NullFxRateProvider();

export function getFxProvider(): FxRateProvider {
  return fxProvider;
}

/**
 * Converts `amount` from `fromCurrency` to `toCurrency` if (and only if)
 * a real FX provider is configured. Same-currency amounts are returned
 * as-is without needing a provider at all. Never fabricates a rate.
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
): Promise<FxConversionResult> {
  if (fromCurrency === toCurrency) {
    return { status: "SAME_CURRENCY", amount, rate: 1 };
  }

  if (!fxProvider.isConfigured()) {
    return { status: "NOT_CONFIGURED", amount: null, rate: null };
  }

  const rate = await fxProvider.getRate(fromCurrency, toCurrency);
  return { status: "CONVERTED", amount: amount * rate, rate };
}

/**
 * Groups a list of currency-bearing values by their native currency —
 * the safe default whenever no FX provider is configured (product spec
 * §13: "preserve source currency ... do not aggregate converted totals
 * unless an FX conversion source is configured and auditable ... clearly
 * distinguish native currency metrics from converted/reporting currency
 * metrics"). Never sums across currencies.
 */
export function sumByCurrency<T>(
  rows: T[],
  getCurrency: (row: T) => string,
  getValue: (row: T) => number | null | undefined,
): { currency: string; total: number }[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const currency = getCurrency(row);
    const value = getValue(row) ?? 0;
    totals.set(currency, (totals.get(currency) ?? 0) + value);
  }

  return Array.from(totals.entries()).map(([currency, total]) => ({ currency, total }));
}
