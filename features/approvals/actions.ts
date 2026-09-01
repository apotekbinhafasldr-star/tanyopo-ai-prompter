"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { setChannelCampaignsStatus } from "@/services/channel-campaigns";
import { getConnector } from "@/lib/connectors/get-connector";
import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { ConnectorPlatform, OptimizationActionType } from "@/types/database";

export interface ApprovalActionState {
  error: string | null;
}

/**
 * Owner-only decision on a pending approval (RLS enforces this too — see
 * the Phase 2 migration's "Owner memutuskan approval" policy). Approving a
 * CAMPAIGN_LAUNCH moves the campaign to SCHEDULED — "ready, will actually
 * launch once a real channel connection exists (Phase 3+)" — never
 * ACTIVE, which this app only sets once an external platform confirms.
 */
export async function decideApprovalAction(
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
  reason: string | null,
): Promise<ApprovalActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat memutuskan approval." };
  }

  const supabase = await createClient();

  const { data: approval, error: approvalError } = await supabase
    .from("prompter_approvals")
    .select("id, approval_type, status, resource_type, resource_id, context")
    .eq("id", approvalId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (approvalError || !approval) {
    return { error: "Approval tidak ditemukan." };
  }

  if (approval.status !== "PENDING") {
    return { error: "Approval ini sudah diputuskan sebelumnya." };
  }

  const { error: updateApprovalError } = await supabase
    .from("prompter_approvals")
    .update({
      status: decision,
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
      reason,
    })
    .eq("id", approvalId);

  if (updateApprovalError) {
    return { error: "Gagal menyimpan keputusan." };
  }

  if (approval.approval_type === "CAMPAIGN_LAUNCH" && approval.resource_type === "prompter_master_campaigns") {
    const newStatus = decision === "APPROVED" ? "SCHEDULED" : "DRAFT";

    await supabase
      .from("prompter_master_campaigns")
      .update({ status: newStatus })
      .eq("id", approval.resource_id);
    await setChannelCampaignsStatus(supabase, approval.resource_id, newStatus);

    await supabase.from("prompter_audit_logs").insert({
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      action: decision === "APPROVED" ? "campaign.approved" : "campaign.launch_rejected",
      resource_type: "prompter_master_campaigns",
      resource_id: approval.resource_id,
      context: reason ? { reason } : {},
    });

    revalidatePath(`/campaigns/${approval.resource_id}`);
    revalidatePath("/campaigns");
  }

  if (
    approval.approval_type === "AUTOPILOT_ACTION" &&
    approval.resource_type === "prompter_channel_campaigns" &&
    decision === "APPROVED"
  ) {
    const executionNote = await executeAutopilotAction(
      supabase,
      session.tenantId,
      session.userId,
      approval.resource_id,
      approval.context,
    );
    if (executionNote) {
      const combinedReason = reason ? `${reason} | ${executionNote}` : executionNote;
      await supabase.from("prompter_approvals").update({ reason: combinedReason }).eq("id", approvalId);
    }
    revalidatePath("/campaigns");
  }

  revalidatePath("/approvals");
  return { error: null };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Executes one APPROVED AUTOPILOT_ACTION recommendation against the real
 * connected platform — the human approval this function is only ever
 * called from is the boundary the product spec requires ("Autopilot must
 * never bypass ... Approval policies"). Two more boundaries are checked
 * here, at execution time, not just when the recommendation was
 * generated: Emergency Stop (re-checked fresh — it could have been
 * activated after this approval was submitted) and that the platform
 * connector is actually configured and connected (never execute against
 * an unconfigured connector). Returns a short human-readable note on
 * anything other than clean success, which the caller appends to the
 * approval's `reason` so the outcome is visible in the Approval Center —
 * approving something never silently fails.
 */
async function executeAutopilotAction(
  supabase: SupabaseServerClient,
  tenantId: string,
  actorUserId: string,
  channelCampaignId: string,
  context: unknown,
): Promise<string | null> {
  const ctx = context as {
    action_type?: OptimizationActionType;
    suggested_daily_budget?: number | null;
  } | null;
  const actionType = ctx?.action_type;

  if (!actionType || actionType === "NO_ACTION") {
    return null;
  }

  const { data: automationSettings } = await supabase
    .from("prompter_automation_settings")
    .select("emergency_stop_active")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (automationSettings?.emergency_stop_active) {
    await supabase.from("prompter_audit_logs").insert({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      action: "autopilot_action.blocked_emergency_stop",
      resource_type: "prompter_channel_campaigns",
      resource_id: channelCampaignId,
      context: { action_type: actionType },
    });
    return "Eksekusi dibatalkan: Emergency Stop aktif untuk tenant ini.";
  }

  const { data: channelCampaign } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, channel, status, external_campaign_id")
    .eq("id", channelCampaignId)
    .eq("tenant_id", tenantId)
    .single();

  if (!channelCampaign || channelCampaign.status !== "ACTIVE" || !channelCampaign.external_campaign_id) {
    return "Eksekusi dibatalkan: channel campaign tidak lagi Aktif di platform.";
  }

  const connectorPlatform: ConnectorPlatform | undefined = CHANNEL_TO_CONNECTOR[channelCampaign.channel];
  if (!connectorPlatform) {
    return `Eksekusi dibatalkan: ${channelCampaign.channel} tidak punya connector.`;
  }

  const { data: connectedAccount } = await supabase
    .from("prompter_connected_accounts")
    .select("id, external_account_id, status")
    .eq("tenant_id", tenantId)
    .eq("platform", connectorPlatform)
    .maybeSingle();

  if (!connectedAccount || connectedAccount.status !== "CONNECTED") {
    return `Eksekusi dibatalkan: ${connectorPlatform} tidak terhubung.`;
  }

  const connector = getConnector(connectorPlatform);
  if (!connector || !connector.isConfigured()) {
    return `Eksekusi dibatalkan: connector ${connectorPlatform} belum dikonfigurasi.`;
  }

  const admin = createAdminClient();
  if (!admin) {
    return "Eksekusi dibatalkan: server belum dikonfigurasi (SUPABASE_SECRET_KEY kosong).";
  }

  const { data: credentials } = await admin
    .from("prompter_oauth_credentials")
    .select("encrypted_access_token")
    .eq("connected_account_id", connectedAccount.id)
    .maybeSingle();

  if (!credentials) {
    return "Eksekusi dibatalkan: kredensial koneksi tidak ditemukan.";
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(credentials.encrypted_access_token);
  } catch {
    return "Eksekusi dibatalkan: gagal membaca kredensial.";
  }

  try {
    if (actionType === "PAUSE_CHANNEL") {
      await connector.pauseCampaign(accessToken, connectedAccount.external_account_id, channelCampaign.external_campaign_id);
      await supabase.from("prompter_channel_campaigns").update({ status: "PAUSED" }).eq("id", channelCampaignId);
    } else if (
      (actionType === "INCREASE_BUDGET" || actionType === "DECREASE_BUDGET") &&
      typeof ctx?.suggested_daily_budget === "number"
    ) {
      await connector.updateBudget(
        accessToken,
        connectedAccount.external_account_id,
        channelCampaign.external_campaign_id,
        Math.round(ctx.suggested_daily_budget),
      );
    } else {
      return "Eksekusi dibatalkan: data tindakan tidak lengkap.";
    }

    await supabase.from("prompter_audit_logs").insert({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      action: "autopilot_action.executed",
      resource_type: "prompter_channel_campaigns",
      resource_id: channelCampaignId,
      context: { platform: connectorPlatform, action_type: actionType },
    });

    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mengeksekusi tindakan di platform.";

    await supabase.from("prompter_audit_logs").insert({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      action: "autopilot_action.execution_failed",
      resource_type: "prompter_channel_campaigns",
      resource_id: channelCampaignId,
      context: { platform: connectorPlatform, action_type: actionType, error: message },
    });

    return `Eksekusi gagal: ${message}`;
  }
}
