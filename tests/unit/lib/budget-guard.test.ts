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
    const result = checkBudgetGuard(makePolicy(), {
      dailyBudget: 10_000_000,
      totalBudget: 100_000_000,
      campaignCurrency: "IDR",
    });
    expect(result.allowed).toBe(true);
  });

  it("rejects when daily budget exceeds the daily limit", () => {
    const result = checkBudgetGuard(makePolicy({ daily_limit: 50_000 }), {
      dailyBudget: 100_000,
      totalBudget: null,
      campaignCurrency: "IDR",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/harian/i);
  });

  it("rejects when total budget exceeds the campaign limit", () => {
    const result = checkBudgetGuard(makePolicy({ campaign_limit: 1_000_000 }), {
      dailyBudget: null,
      totalBudget: 5_000_000,
      campaignCurrency: "IDR",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/campaign/i);
  });

  it("allows a budget exactly at the limit", () => {
    const result = checkBudgetGuard(makePolicy({ daily_limit: 50_000, campaign_limit: 1_000_000 }), {
      dailyBudget: 50_000,
      totalBudget: 1_000_000,
      campaignCurrency: "IDR",
    });
    expect(result.allowed).toBe(true);
  });

  it("rejects when month-to-date spend plus this campaign's projected remaining-month cost exceeds the monthly limit", () => {
    // Reference date: 2026-06-25 — 6 days remain in June (25,26,27,28,29,30).
    const referenceDate = new Date(Date.UTC(2026, 5, 25));
    const result = checkBudgetGuard(makePolicy({ monthly_limit: 1_000_000 }), {
      dailyBudget: 200_000,
      totalBudget: null,
      monthToDateSpend: 500_000,
      referenceDate,
      campaignCurrency: "IDR",
    });
    // 500_000 already spent + 200_000 * 6 remaining days = 1_700_000 > 1_000_000.
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/bulanan/i);
  });

  it("allows when month-to-date spend plus projected remaining-month cost stays within the monthly limit", () => {
    const referenceDate = new Date(Date.UTC(2026, 5, 25));
    const result = checkBudgetGuard(makePolicy({ monthly_limit: 5_000_000 }), {
      dailyBudget: 200_000,
      totalBudget: null,
      monthToDateSpend: 500_000,
      referenceDate,
      campaignCurrency: "IDR",
    });
    expect(result.allowed).toBe(true);
  });

  it("treats an omitted month-to-date spend as zero rather than skipping the check", () => {
    const referenceDate = new Date(Date.UTC(2026, 5, 30));
    const result = checkBudgetGuard(makePolicy({ monthly_limit: 100_000 }), {
      dailyBudget: null,
      totalBudget: 200_000,
      referenceDate,
      campaignCurrency: "IDR",
    });
    expect(result.allowed).toBe(false);
  });

  it("rejects outright when the campaign's currency differs from the policy's currency, even with no limits configured", () => {
    const result = checkBudgetGuard(makePolicy({ currency: "IDR" }), {
      dailyBudget: 10,
      totalBudget: 10,
      campaignCurrency: "USD",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/mata uang/i);
  });

  it("never compares a USD campaign's raw numbers against an IDR limit as if they were the same unit", () => {
    // Without the currency guard this would incorrectly pass: 400 < 50_000.
    const result = checkBudgetGuard(makePolicy({ currency: "IDR", daily_limit: 50_000 }), {
      dailyBudget: 400,
      totalBudget: null,
      campaignCurrency: "USD",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/mata uang/i);
  });

  it("allows normal limit checks to proceed once the campaign currency matches the policy currency", () => {
    const result = checkBudgetGuard(makePolicy({ currency: "USD", daily_limit: 500 }), {
      dailyBudget: 400,
      totalBudget: null,
      campaignCurrency: "USD",
    });
    expect(result.allowed).toBe(true);
  });
});
