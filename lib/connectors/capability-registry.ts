import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ConnectorCapability, ConnectorPlatform } from "@/types/database";

export interface CapabilityRow {
  capability: ConnectorCapability;
  enabled: boolean;
  requiresOauth: boolean;
  requiresApproval: boolean;
  apiVersion: string | null;
  notes: string | null;
}

/**
 * Reads the global, read-only prompter_platform_capabilities registry
 * (product spec §31) for one platform. This table has a SELECT policy
 * open to any authenticated user (it's reference data, not tenant data),
 * so the caller's normal session-scoped client is enough — no service
 * role needed.
 *
 * UI and connector code must gate every capability-driven action through
 * this, never hard-code "Meta supports X" — see docs/INTEGRATIONS.md.
 */
export async function getCapabilities(
  supabase: SupabaseClient<Database>,
  platform: ConnectorPlatform,
): Promise<CapabilityRow[]> {
  const { data, error } = await supabase
    .from("prompter_platform_capabilities")
    .select("capability, enabled, requires_oauth, requires_approval, api_version, notes")
    .eq("platform", platform);

  if (error || !data) return [];

  return data.map((row) => ({
    capability: row.capability,
    enabled: row.enabled,
    requiresOauth: row.requires_oauth,
    requiresApproval: row.requires_approval,
    apiVersion: row.api_version,
    notes: row.notes,
  }));
}

export function isCapabilityEnabled(
  capabilities: CapabilityRow[],
  capability: ConnectorCapability,
): boolean {
  return capabilities.some((c) => c.capability === capability && c.enabled);
}
