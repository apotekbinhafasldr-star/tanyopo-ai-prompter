import { describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
  MoneyError,
  add,
  canonicalJson,
  floorFraction,
  idempotencyKey,
  money,
  mulBps,
  parseAmount,
  registerOnce,
  taxPortionOfInclusive,
} from "@/lib/finance";
import { d, idr } from "./helpers";

describe("money — exact decimal arithmetic", () => {
  it("0.10 + 0.20 is exactly 0.30 (no floating point)", () => {
    expect(d(add(idr("0.10"), idr("0.20")))).toBe("0.30");
  });

  it("rejects more than two decimals, exponent notation and garbage instead of rounding silently", () => {
    expect(() => parseAmount("1.005")).toThrow(MoneyError);
    expect(() => parseAmount(1e21)).toThrow(MoneyError);
    expect(() => parseAmount("abc")).toThrow(MoneyError);
    expect(() => parseAmount(Number.NaN)).toThrow(MoneyError);
  });

  it("refuses to add two currencies", () => {
    expect(() => add(money("1", "IDR"), money("1", "USD"))).toThrow(MoneyError);
  });

  it("rounds a rate half away from zero, in integer arithmetic", () => {
    expect(d(mulBps(idr("0.05"), 5000))).toBe("0.03");
    expect(d(mulBps(idr("-0.05"), 5000))).toBe("-0.03");
    expect(d(mulBps(idr("1000000"), 50))).toBe("5000.00");
  });

  it("extracts the tax portion of a tax-inclusive amount", () => {
    // 111,000 inclusive at 11.00% => 11,000 tax (test fixture rate, not a product default)
    expect(d(taxPortionOfInclusive(idr("111000"), 1100))).toBe("11000.00");
  });

  it("straight-line allocation never drifts: the cumulative schedule lands exactly on the amount", () => {
    const total = idr("100000.01");
    let previous = floorFraction(total, 0, 7);
    for (let day = 1; day <= 7; day += 1) {
      const cumulative = floorFraction(total, day, 7);
      expect(cumulative.minor >= previous.minor).toBe(true);
      previous = cumulative;
    }
    expect(d(previous)).toBe("100000.01");
  });
});

describe("idempotency primitives", () => {
  it("builds deterministic keys and rejects ambiguous parts", () => {
    expect(idempotencyKey("payment", "midtrans", "p1")).toBe("payment|midtrans|p1");
    expect(() => idempotencyKey("payment", "mid|trans", "p1")).toThrow();
    expect(() => idempotencyKey("payment", "")).toThrow();
  });

  it("canonical JSON ignores key order and renders bigint", () => {
    expect(canonicalJson({ b: BigInt(1), a: 2 })).toBe(canonicalJson({ a: 2, b: BigInt(1) }));
  });

  it("keeps the first value on a duplicate and throws on a conflicting one", () => {
    const store = new Map<string, { v: number }>();
    expect(registerOnce(store, "k", { v: 1 })).toBe("APPLIED");
    expect(registerOnce(store, "k", { v: 1 })).toBe("DUPLICATE");
    expect(() => registerOnce(store, "k", { v: 2 })).toThrow(IdempotencyConflictError);
    expect(store.get("k")).toEqual({ v: 1 });
  });
});
