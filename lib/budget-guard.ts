import type { Database } from "@/types/database";
import { formatCurrency } from "@/lib/utils/format";

type BudgetPolicy = Database["public"]["Tables"]["prompter_budget_policies"]["Row"];

export interface BudgetCheckInput {
  dailyBudget: number | null;
  totalBudget: number | null;
  /**
   * Actual spend already recorded this calendar month for the tenant
   * (sum of prompter_marketing_metrics.spend since the 1st), so the
   * monthly check is a hard-stop against real cumulative spend, not just
   * the shape of one campaign's budget. Omit (or 0) when unknown — the
   * monthly check then only projects the new campaign's own contribution,
   * which is still strictly safer than skipping the check.
   */
  monthToDateSpend?: number;
  /** Injectable for tests; defaults to the real current date. */
  referenceDate?: Date;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason: string | null;
}

/**
 * The hard block described in the product spec's "Budget Guard rejection"
 * scenario: a campaign whose budget exceeds a configured limit is rejected
 * outright — it never reaches the Approval Center as a request that would
 * just get rejected there instead.
 *
 * Pure function, no Supabase/env dependency — kept out of
 * services/budget-guard.ts (which is `server-only`) so it's directly unit
 * testable. See tests/unit/lib/budget-guard.test.ts.
 */
export function checkBudgetGuard(policy: BudgetPolicy, input: BudgetCheckInput): BudgetCheckResult {
  if (policy.daily_limit != null && input.dailyBudget != null && input.dailyBudget > policy.daily_limit) {
    return {
      allowed: false,
      reason: `Budget harian ${formatCurrency(input.dailyBudget, policy.currency)} melebihi batas kebijakan ${formatCurrency(policy.daily_limit, policy.currency)}.`,
    };
  }

  if (policy.campaign_limit != null && input.totalBudget != null && input.totalBudget > policy.campaign_limit) {
    return {
      allowed: false,
      reason: `Budget total campaign ${formatCurrency(input.totalBudget, policy.currency)} melebihi batas per-campaign ${formatCurrency(policy.campaign_limit, policy.currency)}.`,
    };
  }

  if (policy.monthly_limit != null) {
    const spendSoFar = input.monthToDateSpend ?? 0;
    const now = input.referenceDate ?? new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - now.getDate() + 1;
    // Projects this campaign's remaining-month contribution on top of what
    // the tenant has already actually spent — a recurring daily budget is
    // multiplied out to month-end; a one-off total budget is added as-is.
    const projectedAdditional = input.dailyBudget != null ? input.dailyBudget * daysRemaining : (input.totalBudget ?? 0);
    const projectedTotal = spendSoFar + projectedAdditional;

    if (projectedTotal > policy.monthly_limit) {
      return {
        allowed: false,
        reason: `Proyeksi pengeluaran bulan ini ${formatCurrency(projectedTotal, policy.currency)} (sudah terpakai ${formatCurrency(spendSoFar, policy.currency)}) melebihi batas bulanan ${formatCurrency(policy.monthly_limit, policy.currency)}.`,
      };
    }
  }

  return { allowed: true, reason: null };
}
