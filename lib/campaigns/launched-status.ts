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

/**
 * Statuses of a channel campaign whose object already exists on the platform,
 * so a READ-ONLY insight sync (`getInsights`) is meaningful. Meta launches are
 * recorded PAUSED (nothing activates them yet), so PAUSED must be included or
 * Meta insights can never be synced. DRAFT / AWAITING_APPROVAL / SCHEDULED /
 * COMPLETED / FAILED are deliberately excluded: they have no (or no live)
 * object on the platform.
 */
const INSIGHT_SYNCABLE_STATUSES: ReadonlySet<string> = new Set(["ACTIVE", "PAUSED"]);

export function canSyncInsights(status: string, externalCampaignId: string | null | undefined): boolean {
  return INSIGHT_SYNCABLE_STATUSES.has(status) && Boolean(externalCampaignId);
}
