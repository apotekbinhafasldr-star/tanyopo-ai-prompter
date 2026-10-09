import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
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

  it("module source has no env, session or role dependency (no runtime bypass)", () => {
    const source = readFileSync(path.resolve(process.cwd(), "lib/campaigns/external-budget-guard.ts"), "utf8");
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/lib\/env/);
    expect(source).not.toMatch(/requireSessionContext|services\/session/);
    expect(source).not.toMatch(/\.role\b/);
    expect(source).not.toMatch(/supabase/i);
  });
});

describe("external budget guard — evidence checks (platform explicitly enabled, unit-test only)", () => {
  const run = (request: ExternalBudgetWriteRequest) => evaluateExternalBudgetWrite(request, ENABLED_ALL);

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
    expect(evaluateExternalBudgetWrite(worst, [])).toMatchObject({ code: "PLATFORM_DISABLED" });
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
