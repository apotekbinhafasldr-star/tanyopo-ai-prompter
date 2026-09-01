import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, FeatureFlagKey } from "@/types/database";

/**
 * Per-tenant Global Edition feature flags (product spec §21). A missing
 * row means OFF — no existing tenant is ever auto-enrolled into a flag
 * it never explicitly set, so disabling one (or never enabling it)
 * cannot destabilize a tenant that never opted in.
 */
export async function isFeatureEnabled(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  flagKey: FeatureFlagKey,
): Promise<boolean> {
  const { data } = await supabase
    .from("prompter_feature_flags")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .eq("flag_key", flagKey)
    .maybeSingle();

  return data?.enabled ?? false;
}

export async function getFeatureFlags(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<Record<FeatureFlagKey, boolean>> {
  const { data } = await supabase
    .from("prompter_feature_flags")
    .select("flag_key, enabled")
    .eq("tenant_id", tenantId);

  const flags: Record<FeatureFlagKey, boolean> = {
    global_onboarding: false,
    multi_currency: false,
    market_targeting: false,
    english_ui: false,
    regional_capabilities: false,
    global_billing: false,
    global_analytics_dimensions: false,
  };

  for (const row of data ?? []) {
    flags[row.flag_key] = row.enabled;
  }

  return flags;
}
