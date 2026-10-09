import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AutomationSettings = Database["public"]["Tables"]["prompter_automation_settings"]["Row"];

const DEFAULT_SETTINGS: Omit<AutomationSettings, "tenant_id"> = {
  automation_mode: "manual",
  autopilot_daily_limit: null,
  emergency_stop_active: false,
  emergency_stop_activated_at: null,
  emergency_stop_activated_by: null,
  emergency_stop_reason: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

/**
 * Loads the tenant's automation settings, creating the safest-possible
 * default row (manual mode, emergency stop inactive) on first access if
 * none exists — same lazy-create pattern as
 * services/budget-guard.ts#getOrCreateBudgetPolicy(). A missing row never
 * falls back to autopilot; it falls back to the same "off" state a new
 * tenant starts in per the Phase 0 migration default.
 */
export async function getOrCreateAutomationSettings(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<AutomationSettings> {
  const { data: existing } = await supabase
    .from("prompter_automation_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created } = await supabase
    .from("prompter_automation_settings")
    .insert({ tenant_id: tenantId })
    .select("*")
    .single();

  return created ?? { tenant_id: tenantId, ...DEFAULT_SETTINGS };
}

/**
 * Reads the Emergency Stop flag read-only and FAIL CLOSED, for the external
 * budget safety gate: `null` means "could not be verified" (query error,
 * thrown error, or a non-boolean value) and the gate treats it as a denial.
 * A tenant with no settings row has never toggled Emergency Stop, which is
 * the same inactive state a new tenant starts in (see
 * getOrCreateAutomationSettings), so a missing row reads as `false`. Unlike
 * getOrCreateAutomationSettings this never inserts a row.
 */
export async function readEmergencyStopStrict(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from("prompter_automation_settings")
      .select("emergency_stop_active")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) return null;
    if (!data) return false;
    return typeof data.emergency_stop_active === "boolean" ? data.emergency_stop_active : null;
  } catch {
    return null;
  }
}
