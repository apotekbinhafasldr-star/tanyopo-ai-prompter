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

/**
 * The ONLY ordinary (non-launch) status transitions of a master campaign and
 * of its channel rows (H1 / PR #39). Every transition names its single
 * allowed source status; nothing else is ever rewritten by these flows.
 *
 *   SUBMIT   DRAFT              -> AWAITING_APPROVAL
 *   CANCEL   AWAITING_APPROVAL  -> DRAFT
 *   APPROVE  AWAITING_APPROVAL  -> SCHEDULED
 *   REJECT   AWAITING_APPROVAL  -> DRAFT
 *
 * FAILED, ACTIVE, PAUSED and COMPLETED are owned by the launch/pause flows
 * (the exclusive claim, the progress writes, markChannelCampaignPaused). They
 * are never a source status here, so an approval, a cancellation or a late or
 * duplicated decision can never turn a claimed or launched channel back into
 * SCHEDULED/DRAFT (the way a second launch -> duplicate Meta objects).
 */
export type StatusTransition = "SUBMIT" | "CANCEL" | "APPROVE" | "REJECT";

export const STATUS_TRANSITIONS: Readonly<Record<StatusTransition, { readonly from: CampaignStatus; readonly to: CampaignStatus }>> =
  Object.freeze({
    SUBMIT: Object.freeze({ from: "DRAFT", to: "AWAITING_APPROVAL" }),
    CANCEL: Object.freeze({ from: "AWAITING_APPROVAL", to: "DRAFT" }),
    APPROVE: Object.freeze({ from: "AWAITING_APPROVAL", to: "SCHEDULED" }),
    REJECT: Object.freeze({ from: "AWAITING_APPROVAL", to: "DRAFT" }),
  });

/**
 * Moves the master campaign along one ordinary transition. ONE conditional
 * UPDATE, scoped by id AND tenant AND the allowed source status; true only when
 * the database confirms that exactly one row changed. False (lost a race,
 * wrong state, other tenant, database error) means: change nothing else.
 */
export async function transitionMasterCampaign(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
  transition: StatusTransition,
): Promise<boolean> {
  const { from, to } = STATUS_TRANSITIONS[transition];
  try {
    const { data, error } = await supabase
      .from("prompter_master_campaigns")
      .update({ status: to })
      .eq("id", masterCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", from)
      .select("id");
    return !error && Array.isArray(data) && data.length === 1;
  } catch {
    return false;
  }
}

export interface MirrorResult {
  /** The database answered. False means the outcome is unknown: treat as not applied. */
  ok: boolean;
  /** Number of channel rows actually moved. */
  updated: number;
}

/**
 * Mirrors a master transition onto its channel rows. Tenant-scoped and limited
 * to rows still in the transition's source status: a channel that is FAILED
 * (claimed/failed launch), ACTIVE, PAUSED or COMPLETED is simply not matched
 * and stays exactly as it is. Never retried.
 */
export async function mirrorChannelCampaignStatus(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
  transition: StatusTransition,
): Promise<MirrorResult> {
  const { from, to } = STATUS_TRANSITIONS[transition];
  try {
    const { data, error } = await supabase
      .from("prompter_channel_campaigns")
      .update({ status: to })
      .eq("master_campaign_id", masterCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", from)
      .select("id");
    if (error || !Array.isArray(data)) return { ok: false, updated: 0 };
    return { ok: true, updated: data.length };
  } catch {
    return { ok: false, updated: 0 };
  }
}
