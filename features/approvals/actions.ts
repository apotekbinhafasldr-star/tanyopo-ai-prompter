"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { setChannelCampaignsStatus } from "@/services/channel-campaigns";

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
    .select("id, approval_type, status, resource_type, resource_id")
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

  revalidatePath("/approvals");
  return { error: null };
}
