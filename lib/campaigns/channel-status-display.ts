import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import { campaignStatusLabel, campaignStatusVariant } from "@/lib/utils/format";

/**
 * Honest display of a channel campaign's status (PR #37 / A1 + A2).
 *
 * Pure presentation logic: nothing here reads or writes the database, and
 * the stored status values are never changed.
 *
 * Why this exists: the Meta connector creates every object (campaign, ad
 * set, ad) with `status: "PAUSED"` and nothing in this app ever activates
 * them. LINOE's own `ACTIVE` therefore only means "all objects were created
 * at Meta", NOT "ads are running". Showing "Aktif" with a green badge made
 * that look like live delivery.
 */

/** Label for a Meta channel recorded ACTIVE: created, paused, not delivering. */
export const META_CREATED_PAUSED_LABEL = "Dibuat — dijeda, belum tayang";

/** Shown with that label: this is LINOE's last known state, not Meta's live state. */
export const LAST_KNOWN_STATUS_NOTE =
  "Status terakhir yang diketahui LINOE. Perubahan langsung di Meta Ads Manager mungkin belum tercermin.";

export function isMetaChannel(channel: string): boolean {
  return (CHANNEL_TO_CONNECTOR as Record<string, string | undefined>)[channel] === "META";
}

export interface ChannelStatusDisplay {
  label: string;
  variant: "neutral" | "warning" | "brand" | "success" | "danger";
  /** Extra explanation to show next to the badge, or null. */
  note: string | null;
}

export function channelCampaignStatusDisplay(channel: string, status: string): ChannelStatusDisplay {
  if (isMetaChannel(channel) && status === "ACTIVE") {
    // Warning, never the green success badge: nothing proves the ad delivers.
    return { label: META_CREATED_PAUSED_LABEL, variant: "warning", note: LAST_KNOWN_STATUS_NOTE };
  }
  // TikTok / X / every other status keep their existing label and colour.
  return { label: campaignStatusLabel(status), variant: campaignStatusVariant(status), note: null };
}

/**
 * A Meta channel campaign in FAILED needs a person to look in Meta Ads
 * Manager. FAILED is also the launch claim's holding state, so the object
 * may be partly created, and the exclusive claim only accepts SCHEDULED:
 * a "retry" can never succeed and is not offered.
 */
export function requiresManualCheck(channel: string, status: string): boolean {
  return isMetaChannel(channel) && status === "FAILED";
}

/** Whether the "Luncurkan" control may be rendered for this row at all. */
export function canOfferLaunch(masterStatus: string, channel: string, channelStatus: string): boolean {
  return masterStatus === "SCHEDULED" && channelStatus !== "ACTIVE" && !requiresManualCheck(channel, channelStatus);
}
