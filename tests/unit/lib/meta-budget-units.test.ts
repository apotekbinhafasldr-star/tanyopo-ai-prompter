import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { META_CURRENCY_BUDGET_UNITS, resolveMetaBudgetMinorUnits } from "@/lib/campaigns/meta-budget-units";
import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";

const ok = { wholeAmount: 50_000, campaignCurrency: "IDR", accountCurrency: "IDR" };

describe("Meta budget units — IDR is NOT assumed", () => {
  it("lists IDR as unverified with no factor, and the table is frozen", () => {
    expect(META_CURRENCY_BUDGET_UNITS.IDR).toEqual({ minorUnitsPerUnit: null, verified: false });
    expect(Object.isFrozen(META_CURRENCY_BUDGET_UNITS)).toBe(true);
    expect(Object.isFrozen(META_CURRENCY_BUDGET_UNITS.IDR)).toBe(true);
    for (const [currency, unit] of Object.entries(META_CURRENCY_BUDGET_UNITS)) expect(unit.verified, currency).toBe(false);
  });

  it("a perfectly valid IDR budget is still refused: the unit is unverified (never treated as 1)", () => {
    expect(resolveMetaBudgetMinorUnits(ok)).toMatchObject({ ok: false, code: "UNIT_UNVERIFIED" });
  });
});

describe("Meta budget units — validation order and failures", () => {
  it.each([0, -1, 1.5, "50000", Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, null, undefined])(
    "amount %j is AMOUNT_INVALID",
    (wholeAmount) => {
      expect(resolveMetaBudgetMinorUnits({ ...ok, wholeAmount })).toMatchObject({ ok: false, code: "AMOUNT_INVALID" });
    },
  );

  it.each([null, undefined, "", 5])("an unknown account currency %j is CURRENCY_UNVERIFIED", (accountCurrency) => {
    expect(resolveMetaBudgetMinorUnits({ ...ok, accountCurrency })).toMatchObject({ ok: false, code: "CURRENCY_UNVERIFIED" });
  });

  it.each([
    ["USD", "IDR"],
    ["IDR", "USD"],
    ["idr", "IDR"],
    [null, "IDR"],
    [undefined, "IDR"],
  ])("campaign %j vs account %j is CURRENCY_MISMATCH", (campaignCurrency, accountCurrency) => {
    expect(resolveMetaBudgetMinorUnits({ ...ok, campaignCurrency, accountCurrency })).toMatchObject({ ok: false, code: "CURRENCY_MISMATCH" });
  });

  it.each(["EUR", "constructor", "__proto__", "toString"])("a currency without an entry (%s) is CURRENCY_UNSUPPORTED", (currency) => {
    expect(resolveMetaBudgetMinorUnits({ wholeAmount: 10, campaignCurrency: currency, accountCurrency: currency })).toMatchObject({
      ok: false,
      code: "CURRENCY_UNSUPPORTED",
    });
  });

  it("never echoes an input value", () => {
    const r = resolveMetaBudgetMinorUnits({ wholeAmount: 7, campaignCurrency: "SECRET-CUR", accountCurrency: "SECRET-CUR" });
    expect(JSON.stringify(r)).not.toContain("SECRET-CUR");
  });
});

describe("Meta budget units — conversion only for an explicitly verified unit (injected table)", () => {
  const table = { TST: { minorUnitsPerUnit: 100, verified: true } };

  it("multiplies by the verified factor", () => {
    expect(resolveMetaBudgetMinorUnits({ wholeAmount: 5000, campaignCurrency: "TST", accountCurrency: "TST" }, table)).toEqual({
      ok: true,
      minorUnits: 500_000,
    });
  });

  it("refuses a verified flag without a usable factor, and a factor without the verified flag", () => {
    const input = { wholeAmount: 5, campaignCurrency: "TST", accountCurrency: "TST" };
    for (const bad of [
      { minorUnitsPerUnit: null, verified: true },
      { minorUnitsPerUnit: 0, verified: true },
      { minorUnitsPerUnit: 1.5, verified: true },
      { minorUnitsPerUnit: 100, verified: false },
    ]) {
      expect(resolveMetaBudgetMinorUnits(input, { TST: bad }), JSON.stringify(bad)).toMatchObject({ ok: false, code: "UNIT_UNVERIFIED" });
    }
  });

  it("refuses a result that would not be a safe integer", () => {
    expect(
      resolveMetaBudgetMinorUnits({ wholeAmount: 1e12, campaignCurrency: "TST", accountCurrency: "TST" }, { TST: { minorUnitsPerUnit: 1e6, verified: true } }),
    ).toMatchObject({ ok: false, code: "AMOUNT_TOO_LARGE" });
  });
});

describe("tripwire — the launch path must convert units before the Budget Gate can open for META", () => {
  it("while the gate allowlist is empty nothing launches; if META is ever added, launch-actions must call the converter", () => {
    const launch = readFileSync("features/campaigns/launch-actions.ts", "utf8");
    if ((BUDGET_WRITE_ENABLED_PLATFORMS as readonly string[]).includes("META")) {
      expect(launch).toContain("resolveMetaLaunchBudget");
    } else {
      expect(BUDGET_WRITE_ENABLED_PLATFORMS).toHaveLength(0);
    }
  });

  it("the module is pure", () => {
    const src = readFileSync("lib/campaigns/meta-budget-units.ts", "utf8");
    expect(src).not.toMatch(/^import /m);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\(|process\.env|server-only|graph\.facebook/);
  });
});
