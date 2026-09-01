import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel, CampaignStatus, Database } from "@/types/database";

interface BudgetAllocationEntry {
  channel: string;
  percentage: number;
}

/**
 * Materializes/refreshes the per-channel rows (product spec §20) under a
 * master campaign from its selected channels and the AI proposal's budget
 * allocation. Called on campaign creation and on regenerate — upsert keeps
 * this idempotent rather than duplicating rows each time.
 */
export async function syncChannelCampaigns(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
  channels: Channel[],
  budgetAllocation: BudgetAllocationEntry[],
): Promise<void> {
  const percentageByChannel = new Map(budgetAllocation.map((b) => [b.channel, b.percentage]));

  const rows = channels.map((channel) => ({
    tenant_id: tenantId,
    master_campaign_id: masterCampaignId,
    channel,
    budget_percentage: percentageByChannel.get(channel) ?? null,
  }));

  if (rows.length === 0) return;

  await supabase
    .from("prompter_channel_campaigns")
    .upsert(rows, { onConflict: "master_campaign_id,channel" });
}

/** Keeps channel_campaigns.status mirroring the parent master campaign. */
export async function setChannelCampaignsStatus(
  supabase: SupabaseClient<Database>,
  masterCampaignId: string,
  status: CampaignStatus,
): Promise<void> {
  await supabase
    .from("prompter_channel_campaigns")
    .update({ status })
    .eq("master_campaign_id", masterCampaignId);
}
