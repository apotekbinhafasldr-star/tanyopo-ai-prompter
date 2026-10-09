import type { ConnectorPlatform } from "@/types/database";
import {
  BUDGET_WRITE_DISABLED_MESSAGE,
  evaluateWithPlatforms,
  type BudgetGateResult,
  type ExternalBudgetWriteRequest,
} from "@/lib/campaigns/external-budget-guard-core";

export { BUDGET_WRITE_DISABLED_MESSAGE };
export type {
  BudgetGateCode,
  BudgetGateResult,
  BudgetWriteOperation,
  ExternalBudgetWriteRequest,
} from "@/lib/campaigns/external-budget-guard-core";

/**
 * External Budget Safety Gate (S1) — DEFAULT DENY.
 *
 * Every code path that writes a budget to an external ad platform
 * (`createCampaign` / `createAdSet` on launch, `updateBudget` from an
 * approved autopilot action) must pass `evaluateExternalBudgetWrite` first.
 * The gate is a pure function of server-derived evidence: it reads no
 * environment, no session, no database, and accepts nothing from the client.
 * Nobody, including an account owner, can open it at runtime.
 *
 * Two independent locks, both closed today:
 *  1. `BUDGET_WRITE_ENABLED_PLATFORMS` is empty — a platform must be added
 *     here in code (a reviewed change) before it can write a budget.
 *  2. Even then, the evidence (ad-account currency, the current external
 *     budget) must be verified, and no code produces that evidence yet.
 *     Unverified (`null`) evidence is always a denial.
 *
 * Which checks run, in order (first failure wins, so results are
 * deterministic):
 *  platform → emergency stop → budget value → account currency →
 *  current external budget → direction → master total → Budget Guard.
 *
 * tests/unit/lib/budget-write-callsites.test.ts asserts that only the two
 * known call sites reach the connector budget methods and that each calls
 * this gate first.
 */

/**
 * Platforms allowed to write a budget externally. EMPTY BY DEFAULT: every
 * platform is denied. FROZEN: it cannot be mutated at runtime. Changing it
 * is a code change that needs review, and the evidence checks still apply.
 */
export const BUDGET_WRITE_ENABLED_PLATFORMS: readonly ConnectorPlatform[] = Object.freeze<ConnectorPlatform[]>([]);

export function isBudgetWritePlatformEnabled(platform: ConnectorPlatform): boolean {
  return BUDGET_WRITE_ENABLED_PLATFORMS.includes(platform);
}

/**
 * The only production entry point. It takes NO platform list: the allowlist
 * is read exclusively from the frozen constant above, so no caller can swap
 * it. Only the boolean `false` for `emergencyStopActive` lets a request
 * proceed; `true`, `null`, `undefined` and any other value are denied.
 */
export function evaluateExternalBudgetWrite(request: ExternalBudgetWriteRequest): BudgetGateResult {
  return evaluateWithPlatforms(request, BUDGET_WRITE_ENABLED_PLATFORMS);
}
