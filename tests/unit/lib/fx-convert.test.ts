import { describe, expect, it } from "vitest";
import { convertCurrency, sumByCurrency, getFxProvider } from "@/lib/fx/convert";

describe("getFxProvider", () => {
  it("reports NOT_CONFIGURED (no real provider is integrated)", () => {
    expect(getFxProvider().isConfigured()).toBe(false);
  });
});

describe("convertCurrency", () => {
  it("returns the amount as-is for same-currency conversion, no provider needed", async () => {
    const result = await convertCurrency(1000, "IDR", "IDR");
    expect(result).toEqual({ status: "SAME_CURRENCY", amount: 1000, rate: 1 });
  });

  it("returns NOT_CONFIGURED rather than fabricating a rate for cross-currency conversion", async () => {
    const result = await convertCurrency(1000, "IDR", "USD");
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.amount).toBeNull();
    expect(result.rate).toBeNull();
  });
});

describe("sumByCurrency", () => {
  it("never sums across different currencies", () => {
    const rows = [
      { value: 100, currency: "IDR" },
      { value: 200, currency: "IDR" },
      { value: 50, currency: "USD" },
    ];

    const result = sumByCurrency(
      rows,
      (r) => r.currency,
      (r) => r.value,
    );

    expect(result).toEqual(
      expect.arrayContaining([
        { currency: "IDR", total: 300 },
        { currency: "USD", total: 50 },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it("treats a null/undefined value as zero rather than throwing", () => {
    const rows = [{ value: null, currency: "IDR" }, { value: 100, currency: "IDR" }];
    const result = sumByCurrency(
      rows,
      (r) => r.currency,
      (r) => r.value,
    );
    expect(result).toEqual([{ currency: "IDR", total: 100 }]);
  });
});
