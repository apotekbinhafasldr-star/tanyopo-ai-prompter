/**
 * Who may CHANGE a campaign's strategy and copy (regenerate with AI, edit copy, pick a candidate, edit destination).
 * One source of truth for the server actions (features/campaigns/actions.ts); the same two roles are the ones the
 * RLS policy "Owner/marketing kelola campaign" lets write. The server checks this itself: it never relies on the UI
 * hiding a button or on RLS alone.
 */
export const CAMPAIGN_EDIT_ROLES = ["owner", "marketing"] as const;

export function canEditCampaign(role: string | null | undefined): boolean {
  return typeof role === "string" && (CAMPAIGN_EDIT_ROLES as readonly string[]).includes(role);
}

export const CAMPAIGN_EDIT_FORBIDDEN_MESSAGE = "Hanya Owner atau Marketing yang dapat mengubah strategi dan teks iklan campaign.";

export const CAMPAIGN_SUBMIT_FORBIDDEN_MESSAGE = "Hanya Owner atau Marketing yang dapat mengajukan campaign untuk persetujuan.";
export const CAMPAIGN_MEDIA_FORBIDDEN_MESSAGE = "Hanya Owner atau Marketing yang dapat memilih media campaign.";
export const CAMPAIGN_SCHEDULE_FORBIDDEN_MESSAGE = "Hanya Owner atau Marketing yang dapat mengatur jadwal channel campaign.";

/**
 * Who may DELETE a draft campaign: the Owner only. Deleting is irreversible (it cascades to the channel rows and
 * recommendations), so it is stricter than editing. RLS ("Owner/marketing kelola campaign") would also let
 * marketing delete; the server action is the stricter fence and must not rely on RLS.
 */
export const CAMPAIGN_DELETE_ROLES = ["owner"] as const;

export function canDeleteCampaign(role: string | null | undefined): boolean {
  return typeof role === "string" && (CAMPAIGN_DELETE_ROLES as readonly string[]).includes(role);
}

export const CAMPAIGN_DELETE_FORBIDDEN_MESSAGE = "Hanya Owner yang dapat menghapus draft campaign.";
