/**
 * Exact money arithmetic for the LINOE finance domain.
 *
 * Amounts are held as a signed `bigint` count of the smallest unit at a fixed
 * scale of 2 decimal places ("centi-units"), never as a JS `number`. Nothing in
 * this module (or in lib/finance) performs floating-point arithmetic on money.
 *
 * The only place a JS `number` is accepted is at the parsing boundary
 * (`parseAmount`), and only when its shortest round-trip decimal representation
 * has at most two decimals. A value such as `0.1 + 0.2` (0.30000000000000004)
 * is therefore rejected loudly instead of being silently rounded.
 *
 * NOTE: BigInt literals (`100n`) are deliberately avoided; tsconfig targets
 * ES2017, so `BigInt(100)` is used instead.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const SCALE_FACTOR = BigInt(100);
const BPS_DENOMINATOR = BigInt(10000);

export interface Money {
  /** Signed amount in 1/100 of the currency's major unit. */
  readonly minor: bigint;
  /** Upper-case ISO-4217 style code, e.g. "IDR". */
  readonly currency: string;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

function assertCurrency(currency: string): string {
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new MoneyError(`Invalid currency code: ${JSON.stringify(currency)}`);
  }
  return currency;
}

/**
 * Parses a decimal amount. Accepts a decimal string ("150000", "150000.5",
 * "-12.34") or a finite JS number whose shortest decimal form has <= 2 decimals.
 * Anything else (exponent notation, > 2 decimals, NaN, Infinity) throws.
 */
export function parseAmount(raw: string | number): bigint {
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new MoneyError("Amount must be a finite number");
    }
    text = String(raw);
    if (/e/i.test(text)) {
      throw new MoneyError(`Amount ${text} uses exponent notation; pass a decimal string`);
    }
  } else if (typeof raw === "string") {
    text = raw.trim();
  } else {
    throw new MoneyError("Amount must be a string or number");
  }

  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new MoneyError(`Invalid or inexact amount: ${JSON.stringify(text)} (max 2 decimals)`);
  }

  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  const value = whole * SCALE_FACTOR + fraction;
  return match[1] ? -value : value;
}

export function money(amount: string | number, currency: string): Money {
  return { minor: parseAmount(amount), currency: assertCurrency(currency) };
}

export function fromMinor(minor: bigint, currency: string): Money {
  return { minor, currency: assertCurrency(currency) };
}

export function zero(currency: string): Money {
  return fromMinor(ZERO, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function negate(a: Money): Money {
  return { minor: -a.minor, currency: a.currency };
}

export function sum(items: readonly Money[], currency: string): Money {
  let total = ZERO;
  for (const item of items) {
    if (item.currency !== currency) {
      throw new MoneyError(`Currency mismatch: ${item.currency} vs ${currency}`);
    }
    total += item.minor;
  }
  return fromMinor(total, currency);
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export function isZero(a: Money): boolean {
  return a.minor === ZERO;
}

export function isNegative(a: Money): boolean {
  return a.minor < ZERO;
}

export function isPositive(a: Money): boolean {
  return a.minor > ZERO;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

/** Integer division rounding half away from zero. `den` must be > 0. */
function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= ZERO) {
    throw new MoneyError("Denominator must be positive");
  }
  const negative = numerator < ZERO;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * TWO >= denominator ? quotient + ONE : quotient;
  return negative ? -rounded : rounded;
}

function assertBps(bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new MoneyError(`Rate must be an integer number of basis points between 0 and 10000, got ${bps}`);
  }
  return BigInt(bps);
}

/** `amount * bps / 10_000`, rounded half away from zero to the 2-decimal scale. */
export function mulBps(amount: Money, bps: number): Money {
  const rate = assertBps(bps);
  return fromMinor(divideRoundHalfAwayFromZero(amount.minor * rate, BPS_DENOMINATOR), amount.currency);
}

/**
 * Tax contained in a tax-INCLUSIVE gross amount: `gross * rate / (10_000 + rate)`.
 */
export function taxPortionOfInclusive(gross: Money, bps: number): Money {
  const rate = assertBps(bps);
  return fromMinor(divideRoundHalfAwayFromZero(gross.minor * rate, BPS_DENOMINATOR + rate), gross.currency);
}

/**
 * `floor(amount * numerator / denominator)` for a non-negative amount, used for
 * cumulative straight-line allocation (the final step always lands exactly on
 * the full amount, so nothing drifts or is lost to rounding).
 */
export function floorFraction(amount: Money, numerator: number, denominator: number): Money {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0 || numerator < 0) {
    throw new MoneyError("Invalid fraction");
  }
  if (isNegative(amount)) {
    throw new MoneyError("floorFraction requires a non-negative amount");
  }
  return fromMinor((amount.minor * BigInt(numerator)) / BigInt(denominator), amount.currency);
}

/** Canonical plain-decimal string with exactly two decimals, e.g. "150000.00". */
export function toDecimalString(a: Money): string {
  const negative = a.minor < ZERO;
  const abs = negative ? -a.minor : a.minor;
  const whole = abs / SCALE_FACTOR;
  const fraction = (abs % SCALE_FACTOR).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}
