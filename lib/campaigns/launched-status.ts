import type { ConnectorPlatform } from "@/types/database";

/**
 * The LINOE status to record after ALL objects of a launch were created.
 *
 * Meta: the connector creates every object (campaign, ad set, ad) with
 * `status: "PAUSED"` and nothing in LINOE activates them yet, so the honest
 * recorded status is PAUSED, never ACTIVE. ACTIVE must only be written by a
 * future, explicitly approved step that confirms activation on Meta.
 * TikTok / X keep their existing behaviour (ACTIVE) unchanged.
 *
 * PAUSED already exists in the database check constraint
 * (prompter_channel_campaigns.status), so no migration is involved.
 */
export function statusAfterSuccessfulLaunch(platform: ConnectorPlatform): "ACTIVE" | "PAUSED" {
  return platform === "META" ? "PAUSED" : "ACTIVE";
}
