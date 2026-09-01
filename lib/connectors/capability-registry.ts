import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CapabilityStatus, ConnectorCapability, ConnectorPlatform } from "@/types/database";

export interface CapabilityRow {
  capability: ConnectorCapability;
  enabled: boolean;
  status: CapabilityStatus;
  requiresOauth: boolean;
  requiresApproval: boolean;
  apiVersion: string | null;
  notes: string | null;
  /** '' means this row applies globally (no region-specific override exists for it). */
  countryCode: string;
}

/**
 * Reads the global, read-only prompter_platform_capabilities registry
 * (product spec §11, §31) for one platform, optionally resolved for a
 * specific market. This table has a SELECT policy open to any
 * authenticated user (it's reference data, not tenant data), so the
 * caller's normal session-scoped client is enough — no service role
 * needed.
 *
 * A capability can have both a global row (country_code = '') and a
 * region-specific override (country_code = e.g. 'MY') sharing the same
 * (platform, capability) — when countryCode is given, the region-specific
 * row wins if one exists; otherwise the global row is used. No
 * region-specific row is seeded anywhere in this app yet (that would
 * require verified per-region platform documentation this app doesn't
 * have), so today this always resolves to the global row — the
 * resolution logic exists so a future migration can add real overrides
 * without any caller changing.
 *
 * UI and connector code must gate every capability-driven action through
 * this, never hard-code "Meta supports X" — see docs/INTEGRATIONS.md.
 */
export async function getCapabilities(
  supabase: SupabaseClient<Database>,
  platform: ConnectorPlatform,
  countryCode?: string,
): Promise<CapabilityRow[]> {
  const { data, error } = await supabase
    .from("prompter_platform_capabilities")
    .select("capability, enabled, status, requires_oauth, requires_approval, api_version, notes, country_code")
    .eq("platform", platform);

  if (error || !data) return [];

  const rows = data.map((row) => ({
    capability: row.capability,
    enabled: row.enabled,
    status: row.status,
    requiresOauth: row.requires_oauth,
    requiresApproval: row.requires_approval,
    apiVersion: row.api_version,
    notes: row.notes,
    countryCode: row.country_code,
  }));

  const byCapability = new Map<ConnectorCapability, CapabilityRow>();
  for (const row of rows) {
    // Global rows first, then let a matching region-specific row (if any)
    // overwrite it — Map.set keeps the last write, so processing order
    // controls precedence without a second pass.
    if (row.countryCode === "") {
      byCapability.set(row.capability, row);
    }
  }
  if (countryCode) {
    for (const row of rows) {
      if (row.countryCode === countryCode) {
        byCapability.set(row.capability, row);
      }
    }
  }

  return Array.from(byCapability.values());
}

export function isCapabilityEnabled(
  capabilities: CapabilityRow[],
  capability: ConnectorCapability,
): boolean {
  return capabilities.some((c) => c.capability === capability && c.enabled);
}
