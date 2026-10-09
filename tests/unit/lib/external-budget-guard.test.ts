import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluateWithPlatforms } from "@/lib/campaigns/external-budget-guard-core";
import {
  BUDGET_WRITE_ENABLED_PLATFORMS,
  evaluateExternalBudgetWrite,
  isBudgetWritePlatformEnabled,
  type ExternalBudgetWriteRequest,
} from "@/lib/campaigns/external-budget-guard";
import type { ConnectorPlatform } from "@/types/database";

const PLATFORMS: ConnectorPlatform[] = ["META", "TIKTOK", "X"];

function fullyVerified(overrides: Partial<ExternalBudgetWriteRequest> = {}): ExternalBudgetWriteRequest {
  return {
    operation: "INCREASE_BUDGET",
    platform: "META",
    emergencyStopActive: false,
    masterCurrency: "IDR",
    accountCurrency: "IDR",
    proposedDailyBudget: 60000,
    currentExternalDailyBudget: 50000,
    otherPaidChannelsDailyTotal: 40000,
    masterDailyBudget: 100000,
    budgetGuard: { allowed: true },
    ...overrides,
  };
}

const ENABLED_ALL = PLATFORMS;

describe("external budget guard — default deny", () => {
  it("ships with NO platform enabled (tripwire: enabling a platform must update this test)", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toEqual([]);
  });

  it.each(PLATFORMS)("denies %s by default, even with every piece of evidence verified", (platform) => {
    for (const operation of ["LAUNCH", "INCREASE_BUDGET", "DECREASE_BUDGET"] as const) {
      const result = evaluateExternalBudgetWrite(fullyVerified({ platform, operation }));
      expect(result).toMatchObject({ allowed: false, code: "PLATFORM_DISABLED" });
      expect(isBudgetWritePlatformEnabled(platform)).toBe(false);
    }
  });

  it.each(["lib/campaigns/external-budget-guard.ts", "lib/campaigns/external-budget-guard-core.ts"])(
    "%s has no env, session or role dependency (no runtime bypass)",
    (file) => {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/lib\/env/);
      expect(source).not.toMatch(/requireSessionContext|services\/session/);
      expect(source).not.toMatch(/\.role\b/);
      expect(source).not.toMatch(/supabase/i);
    },
  );
});

describe("P2-2 immutable platform list", () => {
  it("is frozen and empty", () => {
    expect(Object.isFrozen(BUDGET_WRITE_ENABLED_PLATFORMS)).toBe(true);
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toEqual([]);
  });

  it("cannot be mutated at runtime, and a failed mutation enables nothing", () => {
    const list = BUDGET_WRITE_ENABLED_PLATFORMS as unknown as string[];
    expect(() => list.push("META")).toThrow();
    expect(() => {
      list[0] = "META";
    }).toThrow();
    expect(() => {
      list.length = 1;
    }).toThrow();
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toEqual([]);
    for (const platform of PLATFORMS) {
      expect(isBudgetWritePlatformEnabled(platform)).toBe(false);
      expect(evaluateExternalBudgetWrite(fullyVerified({ platform }))).toMatchObject({ code: "PLATFORM_DISABLED" });
    }
  });
});

describe("P2-3 no gate injection through the production API", () => {
  it("exposes no platform-list parameter", () => {
    expect(evaluateExternalBudgetWrite.length).toBe(1);
    expect(isBudgetWritePlatformEnabled.length).toBe(1);
  });

  it("ignores an extra platform list passed at runtime (JS callers / casts)", () => {
    const evaluate = evaluateExternalBudgetWrite as unknown as (r: ExternalBudgetWriteRequest, l: unknown) => unknown;
    const isEnabled = isBudgetWritePlatformEnabled as unknown as (p: ConnectorPlatform, l: unknown) => boolean;
    expect(evaluate(fullyVerified(), PLATFORMS)).toMatchObject({ allowed: false, code: "PLATFORM_DISABLED" });
    expect(evaluate(fullyVerified(), ["META"])).toMatchObject({ allowed: false, code: "PLATFORM_DISABLED" });
    expect(isEnabled("META", PLATFORMS)).toBe(false);
  });

  it("the public module does not export the internal evaluator", async () => {
    const mod = await import("@/lib/campaigns/external-budget-guard");
    expect(Object.keys(mod).sort()).toEqual([
      "BUDGET_WRITE_DISABLED_MESSAGE",
      "BUDGET_WRITE_ENABLED_PLATFORMS",
      "evaluateExternalBudgetWrite",
      "isBudgetWritePlatformEnabled",
    ]);
  });
});

describe("external budget guard — evidence checks (platform explicitly enabled, unit-test only)", () => {
  const run = (request: ExternalBudgetWriteRequest) => evaluateWithPlatforms(request, ENABLED_ALL);

  it("allows only when every precondition is verified", () => {
    expect(run(fullyVerified())).toEqual({ allowed: true });
    expect(run(fullyVerified({ operation: "DECREASE_BUDGET", proposedDailyBudget: 40000 }))).toEqual({ allowed: true });
    expect(run(fullyVerified({ operation: "LAUNCH", currentExternalDailyBudget: null, otherPaidChannelsDailyTotal: null }))).toEqual({
      allowed: true,
    });
  });

  it("denies when Emergency Stop is active", () => {
    expect(run(fullyVerified({ emergencyStopActive: true }))).toMatchObject({ code: "EMERGENCY_STOP_ACTIVE" });
  });

  it("denies when Emergency Stop could not be read (fail closed)", () => {
    expect(run(fullyVerified({ emergencyStopActive: null }))).toMatchObject({ code: "EMERGENCY_STOP_UNKNOWN" });
  });

  it("P2-1: only boolean false proceeds; undefined and invalid values are denied", () => {
    const withValue = (value: unknown) =>
      run(fullyVerified({ emergencyStopActive: value as unknown as boolean | null }));
    expect(withValue(false)).toEqual({ allowed: true });
    expect(withValue(true)).toMatchObject({ allowed: false, code: "EMERGENCY_STOP_ACTIVE" });
    expect(withValue(null)).toMatchObject({ allowed: false, code: "EMERGENCY_STOP_UNKNOWN" });
    expect(withValue(undefined)).toMatchObject({ allowed: false, code: "EMERGENCY_STOP_UNKNOWN" });
    for (const invalid of ["false", "true", "no", "", 0, 1, Number.NaN, {}, [], () => false]) {
      expect(withValue(invalid), String(invalid)).toMatchObject({ allowed: false, code: "EMERGENCY_STOP_UNKNOWN" });
    }
  });

  it("P2-1: a request that omits emergencyStopActive entirely is denied", () => {
    const { emergencyStopActive: _omitted, ...rest } = fullyVerified();
    void _omitted;
    expect(run(rest as unknown as ExternalBudgetWriteRequest)).toMatchObject({ code: "EMERGENCY_STOP_UNKNOWN" });
  });

  it.each([null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    "denies invalid budget %s",
    (value) => {
      expect(run(fullyVerified({ proposedDailyBudget: value }))).toMatchObject({ code: "BUDGET_INVALID" });
    },
  );

  it("denies an unverified account currency, for every operation", () => {
    for (const operation of ["LAUNCH", "INCREASE_BUDGET", "DECREASE_BUDGET"] as const) {
      expect(run(fullyVerified({ operation, accountCurrency: null }))).toMatchObject({ code: "CURRENCY_UNVERIFIED" });
    }
  });

  it.each(["USD", "idr", "EUR", ""])("denies a non-IDR account currency %j", (currency) => {
    expect(run(fullyVerified({ accountCurrency: currency }))).toMatchObject({ code: "CURRENCY_NOT_IDR" });
  });

  it("denies when master currency differs from the account currency", () => {
    expect(run(fullyVerified({ masterCurrency: "USD" }))).toMatchObject({ code: "CURRENCY_MISMATCH" });
    expect(run(fullyVerified({ masterCurrency: null }))).toMatchObject({ code: "CURRENCY_MISMATCH" });
  });

  it("denies autopilot when the current external budget is unverified", () => {
    for (const operation of ["INCREASE_BUDGET", "DECREASE_BUDGET"] as const) {
      expect(run(fullyVerified({ operation, currentExternalDailyBudget: null }))).toMatchObject({
        code: "CURRENT_BUDGET_UNVERIFIED",
      });
    }
  });

  it("denies a wrong direction, including a no-op", () => {
    expect(run(fullyVerified({ operation: "INCREASE_BUDGET", proposedDailyBudget: 40000 }))).toMatchObject({ code: "DIRECTION_INVALID" });
    expect(run(fullyVerified({ operation: "INCREASE_BUDGET", proposedDailyBudget: 50000 }))).toMatchObject({ code: "DIRECTION_INVALID" });
    expect(run(fullyVerified({ operation: "DECREASE_BUDGET", proposedDailyBudget: 60000 }))).toMatchObject({ code: "DIRECTION_INVALID" });
    expect(run(fullyVerified({ operation: "DECREASE_BUDGET", proposedDailyBudget: 50000 }))).toMatchObject({ code: "DIRECTION_INVALID" });
  });

  it("denies when the master total cannot be verified or would be exceeded", () => {
    expect(run(fullyVerified({ otherPaidChannelsDailyTotal: null }))).toMatchObject({ code: "MASTER_TOTAL_UNVERIFIED" });
    expect(run(fullyVerified({ masterDailyBudget: null }))).toMatchObject({ code: "MASTER_TOTAL_UNVERIFIED" });
    expect(run(fullyVerified({ otherPaidChannelsDailyTotal: 40001 }))).toMatchObject({ code: "MASTER_TOTAL_EXCEEDED" });
    expect(run(fullyVerified({ otherPaidChannelsDailyTotal: 40000 }))).toEqual({ allowed: true });
  });

  it("denies when Budget Guard is unavailable or rejects", () => {
    expect(run(fullyVerified({ budgetGuard: { unavailable: true } }))).toMatchObject({ code: "BUDGET_GUARD_UNAVAILABLE" });
    expect(run(fullyVerified({ budgetGuard: { allowed: false } }))).toMatchObject({ code: "BUDGET_GUARD_REJECTED" });
  });

  it("returns the first failing check deterministically (platform > emergency stop > budget > currency)", () => {
    const worst = fullyVerified({
      emergencyStopActive: true,
      proposedDailyBudget: 0,
      accountCurrency: null,
      currentExternalDailyBudget: null,
      budgetGuard: { unavailable: true },
    });
    expect(evaluateWithPlatforms(worst, [])).toMatchObject({ code: "PLATFORM_DISABLED" });
    expect(run(worst)).toMatchObject({ code: "EMERGENCY_STOP_ACTIVE" });
    expect(run({ ...worst, emergencyStopActive: false })).toMatchObject({ code: "BUDGET_INVALID" });
    expect(run({ ...worst, emergencyStopActive: false, proposedDailyBudget: 1000 })).toMatchObject({ code: "CURRENCY_UNVERIFIED" });
  });

  it("denial messages never contain secrets or identifiers", () => {
    const result = run(fullyVerified({ accountCurrency: null }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).not.toMatch(/token|secret|act_|@/i);
  });
});
