import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { resolveMetaLaunchBudget } from "@/lib/campaigns/meta-launch-budget";
import { META_CURRENCY_BUDGET_UNITS } from "@/lib/campaigns/meta-budget-units";
import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";

const approval = { daily_budget: 100_000, total_budget: null };
const base = { approvalContext: approval, masterDailyBudget: 100_000, allocatedDailyBudget: 50_000, masterCurrency: "IDR", accountCurrency: "IDR" };
// Test-only table: a unit that is explicitly verified. The shipped table has none.
const verified = { IDR: { minorUnitsPerUnit: 1, verified: true }, TST: { minorUnitsPerUnit: 100, verified: true } };

afterEach(() => vi.unstubAllGlobals());

describe("Meta launch budget — the shipped state refuses (IDR unit is unverified)", () => {
  it("refuses a perfectly valid IDR launch with UNIT_UNVERIFIED", () => {
    expect(resolveMetaLaunchBudget(base)).toMatchObject({ ok: false, code: "UNIT_UNVERIFIED" });
  });
  it("refuses without ad-account currency evidence (what the launch path supplies today)", () => {
    expect(resolveMetaLaunchBudget({ ...base, accountCurrency: null })).toMatchObject({ ok: false, code: "CURRENCY_UNVERIFIED" });
  });
  it("the shipped unit table has no verified currency", () => {
    for (const [currency, unit] of Object.entries(META_CURRENCY_BUDGET_UNITS)) expect(unit.verified, currency).toBe(false);
  });
});

describe("Meta launch budget — currency", () => {
  it.each([null, undefined, "", 5])("unknown account currency %j", (accountCurrency) => {
    expect(resolveMetaLaunchBudget({ ...base, accountCurrency }, verified)).toMatchObject({ ok: false, code: "CURRENCY_UNVERIFIED" });
  });
  it.each([["IDR", "USD"], ["USD", "IDR"], ["idr", "IDR"]])("campaign %s vs account %s is a mismatch", (masterCurrency, accountCurrency) => {
    expect(resolveMetaLaunchBudget({ ...base, masterCurrency, accountCurrency }, verified)).toMatchObject({ ok: false, code: "CURRENCY_MISMATCH" });
  });
  it("a currency with no table entry is unsupported", () => {
    expect(resolveMetaLaunchBudget({ ...base, masterCurrency: "EUR", accountCurrency: "EUR" }, verified)).toMatchObject({ ok: false, code: "CURRENCY_UNSUPPORTED" });
  });
});

describe("Meta launch budget — unit", () => {
  it("an unknown unit (no factor, or not verified) is refused", () => {
    for (const unit of [{ minorUnitsPerUnit: null, verified: false }, { minorUnitsPerUnit: 1, verified: false }, { minorUnitsPerUnit: null, verified: true }]) {
      expect(resolveMetaLaunchBudget(base, { IDR: unit })).toMatchObject({ ok: false, code: "UNIT_UNVERIFIED" });
    }
  });
  it("a verified unit converts with integer arithmetic only", () => {
    expect(resolveMetaLaunchBudget(base, verified)).toEqual({ ok: true, value: { minorUnits: 50_000, wholeAmount: 50_000 } });
    expect(resolveMetaLaunchBudget({ ...base, masterCurrency: "TST", accountCurrency: "TST" }, verified)).toEqual({
      ok: true,
      value: { minorUnits: 5_000_000, wholeAmount: 50_000 },
    });
  });
  it("refuses a result that is not a safe integer instead of rounding", () => {
    const huge = { approvalContext: { daily_budget: 2 ** 52 }, masterDailyBudget: 2 ** 52, allocatedDailyBudget: 2 ** 52, masterCurrency: "TST", accountCurrency: "TST" };
    expect(resolveMetaLaunchBudget(huge, verified)).toMatchObject({ ok: false, code: "AMOUNT_TOO_LARGE" });
  });
});

describe("Meta launch budget — invalid amounts", () => {
  it.each([0, -1, -50_000, 1.5, 50_000.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "50000", null, undefined])(
    "allocated %j is refused",
    (allocatedDailyBudget) => {
      expect(resolveMetaLaunchBudget({ ...base, allocatedDailyBudget }, verified)).toMatchObject({ ok: false });
    },
  );
  it.each([0, -1, 1.5, Number.NaN, "100000", null])("master daily budget %j is refused", (masterDailyBudget) => {
    expect(resolveMetaLaunchBudget({ ...base, masterDailyBudget }, verified)).toMatchObject({ ok: false, code: "BUDGET_EXCEEDS_APPROVAL" });
  });
});

describe("Meta launch budget — never above what the Owner approved", () => {
  it("accepts a budget equal to or below the approved value", () => {
    expect(resolveMetaLaunchBudget(base, verified)).toMatchObject({ ok: true });
    expect(resolveMetaLaunchBudget({ ...base, masterDailyBudget: 80_000, allocatedDailyBudget: 40_000 }, verified)).toMatchObject({ ok: true });
  });
  it("refuses a campaign budget raised after approval", () => {
    expect(resolveMetaLaunchBudget({ ...base, masterDailyBudget: 100_001 }, verified)).toMatchObject({ ok: false, code: "BUDGET_EXCEEDS_APPROVAL" });
  });
  it("refuses a channel share above the campaign budget", () => {
    expect(resolveMetaLaunchBudget({ ...base, allocatedDailyBudget: 100_001 }, verified)).toMatchObject({ ok: false, code: "ALLOCATION_INVALID" });
  });
  it.each([
    ["no context", null],
    ["not an object", "x"],
    ["an array", [100_000]],
    ["no daily_budget", { total_budget: 5 }],
    ["daily_budget null", { daily_budget: null }],
    ["daily_budget zero", { daily_budget: 0 }],
    ["daily_budget a string", { daily_budget: "100000" }],
    ["daily_budget fractional", { daily_budget: 99_999.5 }],
  ])("an unreadable approved ceiling (%s) is refused", (_label, approvalContext) => {
    expect(resolveMetaLaunchBudget({ ...base, approvalContext }, verified)).toMatchObject({ ok: false, code: "APPROVAL_BUDGET_UNREADABLE" });
  });
  it("messages never echo an amount or a currency", () => {
    const result = resolveMetaLaunchBudget({ ...base, masterDailyBudget: 123_456_789, masterCurrency: "SECRETCUR", accountCurrency: "SECRETCUR" }, verified);
    expect(JSON.stringify(result)).not.toMatch(/123456789|SECRETCUR/);
  });
});

describe("Meta launch budget — isolation and wiring", () => {
  it("makes no network call", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    resolveMetaLaunchBudget(base);
    resolveMetaLaunchBudget(base, verified);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("is pure: no database, tenant, environment or network access in the module", () => {
    const src = readFileSync("lib/campaigns/meta-launch-budget.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/supabase|tenant|process\.env|fetch\(|server-only|graph\.facebook/i);
    expect(code.match(/^import .*$/gm)).toEqual(['import { resolveMetaBudgetMinorUnits, type MetaCurrencyBudgetUnit } from "@/lib/campaigns/meta-budget-units";']);
  });
  it("the launch action converts the budget for META only, BEFORE the claim, and has no bare whole-IDR assignment", () => {
    const launch = readFileSync("features/campaigns/launch-actions.ts", "utf8");
    const call = launch.indexOf("resolveMetaLaunchBudget({");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(launch.indexOf("claimChannelCampaignLaunch(supabase"));
    expect(call).toBeGreaterThan(launch.lastIndexOf("evaluateExternalBudgetWrite({"));
    expect(launch).toContain("const dailyBudgetMinorUnits = launchDailyBudgetMinorUnits;");
    expect(launch).not.toContain("?? allocatedDailyBudget");
    expect(launch).not.toMatch(/const dailyBudgetMinorUnits = allocatedDailyBudget;/);
    expect(launch).toMatch(/connectorPlatform === "META"\) \{\s*const metaBudget = resolveMetaLaunchBudget/);
    expect(launch).toContain("accountCurrency,\n    });\n    if (!metaBudget.ok)");
  });
  it("the Budget Gate stays closed", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toHaveLength(0);
    const guard = readFileSync("lib/campaigns/external-budget-guard.ts", "utf8");
    expect(guard).toContain("Object.freeze<ConnectorPlatform[]>([])");
  });
});
