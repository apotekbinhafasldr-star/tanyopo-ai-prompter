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

/** Statuses owned by the launch/pause flows: never a source or a target of an ordinary transition. */
export const LOCKED_CHANNEL_STATUSES: readonly CampaignStatus[] = Object.freeze(["FAILED", "ACTIVE", "PAUSED", "COMPLETED"] as const);

/**
 * Outcome of a master transition. The three cases are deliberately distinct:
 *  - "moved":    the database confirmed exactly one row changed;
 *  - "conflict": the database answered and NO row matched (another request
 *                changed the master first, or it is not in the source status);
 *  - "error":    a database error, an exception, or an ambiguous row count.
 *                Whether the write happened is UNKNOWN: callers must not
 *                continue and must not report success.
 */
export type MasterTransitionOutcome = "moved" | "conflict" | "error";

/**
 * Moves the master campaign along one ordinary transition. ONE conditional
 * UPDATE, scoped by id AND tenant AND the allowed source status.
 */
export async function transitionMasterCampaign(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
  transition: StatusTransition,
): Promise<MasterTransitionOutcome> {
  const { from, to } = STATUS_TRANSITIONS[transition];
  try {
    const { data, error } = await supabase
      .from("prompter_master_campaigns")
      .update({ status: to })
      .eq("id", masterCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", from)
      .select("id");
    if (error || !Array.isArray(data)) return "error";
    if (data.length === 1) return "moved";
    return data.length === 0 ? "conflict" : "error";
  } catch {
    return "error";
  }
}

export interface ChannelStateCheck {
  /** The database answered every read. False means the state is unknown: treat as not confirmed. */
  ok: boolean;
  /** Every channel row is in an acceptable or locked status AND every channel the master selected has a row. */
  consistent: boolean;
}

/**
 * Read-only check that the channel rows of a master agree with a transition.
 *
 *  phase "before": rows may still be in the source status or already in the
 *                  target status (a pre-flight before anything is written);
 *  phase "after":  rows must be in the target status.
 *
 * Locked statuses (FAILED/ACTIVE/PAUSED/COMPLETED) are always acceptable: they
 * are left alone on purpose. Anything else (e.g. a DRAFT row under an approved
 * master) is inconsistent, and so is a selected channel with no row at all.
 * "Zero rows updated" is therefore only fine when this check agrees.
 */
export async function checkChannelCampaignState(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
  transition: StatusTransition,
  phase: "before" | "after",
): Promise<ChannelStateCheck> {
  const { from, to } = STATUS_TRANSITIONS[transition];
  const accepted: readonly string[] = phase === "before" ? [from, to] : [to];
  try {
    const [master, rows] = await Promise.all([
      supabase
        .from("prompter_master_campaigns")
        .select("channels")
        .eq("id", masterCampaignId)
        .eq("tenant_id", tenantId)
        .single(),
      supabase
        .from("prompter_channel_campaigns")
        .select("channel, status")
        .eq("master_campaign_id", masterCampaignId)
        .eq("tenant_id", tenantId),
    ]);
    if (master.error || !master.data || rows.error || !Array.isArray(rows.data)) {
      return { ok: false, consistent: false };
    }
    const channelRows: ReadonlyArray<{ channel: string; status: string }> = rows.data;
    const locked: readonly string[] = LOCKED_CHANNEL_STATUSES;
    const present = new Set(channelRows.map((r) => r.channel));
    const expected: readonly string[] = Array.isArray(master.data.channels) ? master.data.channels : [];
    const missing = expected.some((c) => !present.has(c));
    const badStatus = channelRows.some((r) => !accepted.includes(r.status) && !locked.includes(r.status));
    return { ok: true, consistent: !missing && !badStatus };
  } catch {
    return { ok: false, consistent: false };
  }
}

export interface MirrorResult {
  /** The update AND the verification read both got a database answer. False means the outcome is unknown. */
  ok: boolean;
  /** Number of channel rows actually moved. */
  updated: number;
  /** After the update every channel row agrees with the transition (see checkChannelCampaignState). */
  consistent: boolean;
}

/** A mirror is only confirmed when the database answered AND the resulting state is consistent. */
export function isMirrorConfirmed(result: MirrorResult): boolean {
  return result.ok && result.consistent;
}

/**
 * Mirrors a master transition onto its channel rows. Tenant-scoped and limited
 * to rows still in the transition's source status: a channel that is FAILED
 * (claimed/failed launch), ACTIVE, PAUSED or COMPLETED is simply not matched
 * and stays exactly as it is. The number of rows moved is NOT taken as proof:
 * a read-back (checkChannelCampaignState, phase "after") must agree. Never
 * retried, never rolled back.
 */
export async function mirrorChannelCampaignStatus(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
  transition: StatusTransition,
): Promise<MirrorResult> {
  const { from, to } = STATUS_TRANSITIONS[transition];
  let updated = 0;
  try {
    const { data, error } = await supabase
      .from("prompter_channel_campaigns")
      .update({ status: to })
      .eq("master_campaign_id", masterCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", from)
      .select("id");
    if (error || !Array.isArray(data)) return { ok: false, updated: 0, consistent: false };
    updated = data.length;
  } catch {
    return { ok: false, updated: 0, consistent: false };
  }
  const check = await checkChannelCampaignState(supabase, tenantId, masterCampaignId, transition, "after");
  return { ok: check.ok, updated, consistent: check.consistent };
}

// ---------------------------------------------------------------------------
// Recovery of a blocked SCHEDULED campaign back to DRAFT
//
// Deliberately NOT part of STATUS_TRANSITIONS: it is only reachable through
// recoverBlockedScheduledCampaignAction, which first proves the campaign has
// never launched (every channel still SCHEDULED, no external id, no metrics).
// Channels move FIRST: the exclusive launch claim is also a conditional
// UPDATE on `status = 'SCHEDULED'` of the same rows, so per row exactly one
// of {recovery, claim} wins; a launch can therefore never start on a channel
// that recovery already moved, and recovery never touches a claimed one.
// ---------------------------------------------------------------------------

export interface RecoveryChannelRow {
  id: string;
  status: string;
  external_campaign_id: string | null;
}

/** Tenant-scoped, read-only list of the channel rows of a master. `ok:false` means the state is unknown. */
export async function readChannelRowsForRecovery(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
): Promise<{ ok: boolean; rows: RecoveryChannelRow[] }> {
  try {
    const { data, error } = await supabase
      .from("prompter_channel_campaigns")
      .select("id, status, external_campaign_id")
      .eq("master_campaign_id", masterCampaignId)
      .eq("tenant_id", tenantId);
    if (error || !Array.isArray(data)) return { ok: false, rows: [] };
    return { ok: true, rows: data as RecoveryChannelRow[] };
  } catch {
    return { ok: false, rows: [] };
  }
}

/** SCHEDULED -> DRAFT for never-claimed channel rows only. Returns the ids actually moved. */
export async function moveChannelCampaignsScheduledToDraft(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
): Promise<{ ok: boolean; ids: string[] }> {
  try {
    const { data, error } = await supabase
      .from("prompter_channel_campaigns")
      .update({ status: "DRAFT" })
      .eq("master_campaign_id", masterCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", "SCHEDULED")
      .is("external_campaign_id", null)
      .select("id");
    if (error || !Array.isArray(data)) return { ok: false, ids: [] };
    return { ok: true, ids: data.map((r) => r.id) };
  } catch {
    return { ok: false, ids: [] };
  }
}

/** Undo of the step above for exactly the ids it moved (only rows still DRAFT). */
export async function restoreChannelCampaignsToScheduled(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
  ids: readonly string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    const { data, error } = await supabase
      .from("prompter_channel_campaigns")
      .update({ status: "SCHEDULED" })
      .in("id", [...ids])
      .eq("master_campaign_id", masterCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", "DRAFT")
      .select("id");
    return !error && Array.isArray(data) && data.length === ids.length;
  } catch {
    return false;
  }
}

/** SCHEDULED -> DRAFT on the master: one conditional UPDATE scoped by id, tenant and source status. */
export async function transitionMasterScheduledToDraft(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  masterCampaignId: string,
): Promise<MasterTransitionOutcome> {
  try {
    const { data, error } = await supabase
      .from("prompter_master_campaigns")
      .update({ status: "DRAFT" })
      .eq("id", masterCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", "SCHEDULED")
      .select("id");
    if (error || !Array.isArray(data)) return "error";
    if (data.length === 1) return "moved";
    return data.length === 0 ? "conflict" : "error";
  } catch {
    return "error";
  }
}
