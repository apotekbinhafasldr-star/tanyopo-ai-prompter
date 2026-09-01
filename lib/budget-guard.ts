import type { Database } from "@/types/database";
import { formatCurrency } from "@/lib/utils/format";

type BudgetPolicy = Database["public"]["Tables"]["prompter_budget_policies"]["Row"];

export interface BudgetCheckInput {
  dailyBudget: number | null;
  totalBudget: number | null;
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

  return { allowed: true, reason: null };
}
