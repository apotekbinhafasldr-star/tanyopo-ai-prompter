import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];

const DEFAULT_SUBSCRIPTION: Omit<Subscription, "tenant_id"> = {
  plan: "FREE",
  status: "ACTIVE",
  billing_provider: null,
  success_fee_rate_bps: null,
  current_period_start: null,
  current_period_end: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

/**
 * Loads the tenant's subscription, creating a FREE-plan row on first
 * access if none exists — same lazy-create pattern as
 * services/budget-guard.ts#getOrCreateBudgetPolicy() and
 * services/automation-settings.ts#getOrCreateAutomationSettings(). A
 * missing row never falls back to a paid plan; it falls back to the
 * safest state (Free, no processor, no fee).
 */
export async function getOrCreateSubscription(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<Subscription> {
  const { data: existing } = await supabase
    .from("prompter_subscriptions")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created } = await supabase
    .from("prompter_subscriptions")
    .insert({ tenant_id: tenantId })
    .select("*")
    .single();

  return created ?? { tenant_id: tenantId, ...DEFAULT_SUBSCRIPTION };
}

/**
 * Real AI usage this calendar month, from prompter_ai_jobs (already
 * written by every AI generation via services/ai-jobs.ts#runAiJob()) —
 * never a fabricated or estimated count.
 */
export async function getMonthlyAiJobCount(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  referenceDate: Date = new Date(),
): Promise<number> {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const { count } = await supabase
    .from("prompter_ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", monthStart);

  return count ?? 0;
}

/**
 * Sum of prompter_attributions.attributed_value where
 * attribution_model = 'UMKMPRO_VERIFIED' for the tenant this calendar
 * month — the only conversions the product spec allows a success fee to
 * be calculated from. Manual self-reported conversions and total
 * business revenue are never included.
 */
export async function getVerifiedAttributedValueThisMonth(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  referenceDate: Date = new Date(),
): Promise<number> {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1).toISOString();

  const { data, error } = await supabase
    .from("prompter_attributions")
    .select("attributed_value")
    .eq("tenant_id", tenantId)
    .eq("attribution_model", "UMKMPRO_VERIFIED")
    .gte("created_at", monthStart);

  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + Number(row.attributed_value ?? 0), 0);
}
