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
