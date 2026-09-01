import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export { checkBudgetGuard, type BudgetCheckInput, type BudgetCheckResult } from "@/lib/budget-guard";

type BudgetPolicy = Database["public"]["Tables"]["prompter_budget_policies"]["Row"];

const DEFAULT_POLICY: Omit<BudgetPolicy, "tenant_id"> = {
  daily_limit: null,
  monthly_limit: null,
  campaign_limit: null,
  currency: "IDR",
  require_approval_above: null,
  autopilot_limit: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

/**
 * Loads the tenant's budget policy, creating a default (no limits) row on
 * first access if none exists. The insert only succeeds for an `owner`
 * (RLS) — for any other role, or if the insert otherwise fails, this falls
 * back to an in-memory "no limits configured" object rather than throwing,
 * so a missing policy never blocks the caller.
 */
export async function getOrCreateBudgetPolicy(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<BudgetPolicy> {
  const { data: existing } = await supabase
    .from("prompter_budget_policies")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created } = await supabase
    .from("prompter_budget_policies")
    .insert({ tenant_id: tenantId })
    .select("*")
    .single();

  return created ?? { tenant_id: tenantId, ...DEFAULT_POLICY };
}

/**
 * Sums real recorded spend (prompter_marketing_metrics.spend — only ever
 * written by a connector syncing actual platform data, never fabricated)
 * for the tenant since the 1st of the current calendar month. Feeds
 * checkBudgetGuard()'s monthly hard-stop so it's checked against actual
 * cumulative spend, not just the shape of the campaign being submitted.
 * Returns 0 (never throws) on a query error — the monthly check then
 * degrades to "this campaign's own projected contribution only", which is
 * still strictly safer than skipping the check entirely.
 */
export async function getMonthToDateSpend(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  referenceDate: Date = new Date(),
): Promise<number> {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("prompter_marketing_metrics")
    .select("spend")
    .eq("tenant_id", tenantId)
    .gte("date", monthStart);

  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + Number(row.spend ?? 0), 0);
}
