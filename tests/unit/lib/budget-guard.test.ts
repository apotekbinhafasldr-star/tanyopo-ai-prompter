import { describe, expect, it } from "vitest";
import { checkBudgetGuard } from "@/lib/budget-guard";
import type { Database } from "@/types/database";

type BudgetPolicy = Database["public"]["Tables"]["prompter_budget_policies"]["Row"];

function makePolicy(overrides: Partial<BudgetPolicy> = {}): BudgetPolicy {
  return {
    tenant_id: "tenant-1",
    daily_limit: null,
    monthly_limit: null,
    campaign_limit: null,
    currency: "IDR",
    require_approval_above: null,
    autopilot_limit: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("checkBudgetGuard", () => {
  it("allows any budget when no limits are configured", () => {
    const result = checkBudgetGuard(makePolicy(), { dailyBudget: 10_000_000, totalBudget: 100_000_000 });
    expect(result.allowed).toBe(true);
  });

  it("rejects when daily budget exceeds the daily limit", () => {
    const result = checkBudgetGuard(makePolicy({ daily_limit: 50_000 }), {
      dailyBudget: 100_000,
      totalBudget: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/harian/i);
  });

  it("rejects when total budget exceeds the campaign limit", () => {
    const result = checkBudgetGuard(makePolicy({ campaign_limit: 1_000_000 }), {
      dailyBudget: null,
      totalBudget: 5_000_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/campaign/i);
  });

  it("allows a budget exactly at the limit", () => {
    const result = checkBudgetGuard(makePolicy({ daily_limit: 50_000, campaign_limit: 1_000_000 }), {
      dailyBudget: 50_000,
      totalBudget: 1_000_000,
    });
    expect(result.allowed).toBe(true);
  });
});
