"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { CampaignProposalSchema } from "@/schemas/ai/campaign-proposal";
import { buildSystemPreamble, buildCampaignProposalPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import { syncChannelCampaigns, setChannelCampaignsStatus } from "@/services/channel-campaigns";
import { getOrCreateBudgetPolicy, getMonthToDateSpend, checkBudgetGuard } from "@/services/budget-guard";
import type { Json } from "@/types/database";

export interface CampaignActionState {
  error: string | null;
}

export async function regenerateCampaignProposalAction(campaignId: string): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (campaignError || !campaign || !campaign.product_id) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa dibuat ulang. Batalkan pengajuan terlebih dahulu." };
  }

  const { data: product, error: productError } = await supabase
    .from("prompter_products")
    .select("*")
    .eq("id", campaign.product_id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (productError || !product) {
    return { error: "Produk terkait campaign ini tidak ditemukan." };
  }

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  const inputs = {
    objective: campaign.objective,
    channels: campaign.channels,
    targetCountry: campaign.target_country,
    targetRegion: campaign.target_region,
    targetCity: campaign.target_city,
    audienceNotes: campaign.audience_notes,
    dailyBudget: campaign.daily_budget,
    totalBudget: campaign.total_budget,
    currency: campaign.currency,
  };

  const result = await runAiJob({
    supabase,
    tenantId: session.tenantId,
    actorUserId: session.userId,
    jobType: "CAMPAIGN_PROPOSAL",
    schema: CampaignProposalSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildCampaignProposalPrompt(product, inputs),
    inputReference: { product_id: product.id, campaign_id: campaignId, ...inputs },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const { error: updateError } = await supabase
    .from("prompter_master_campaigns")
    .update({ ai_proposal: result.data, ai_job_id: result.jobId })
    .eq("id", campaignId);

  if (updateError) {
    return { error: "AI berhasil membuat proposal baru tapi gagal menyimpannya." };
  }

  await syncChannelCampaigns(
    supabase,
    session.tenantId,
    campaignId,
    campaign.channels,
    result.data.budget_allocation,
  );

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null };
}

export async function updateCampaignCopyAction(
  campaignId: string,
  _prevState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const headline = formData.get("headline");
  const primaryText = formData.get("primaryText");
  const cta = formData.get("cta");

  const { data: campaign, error: fetchError } = await supabase
    .from("prompter_master_campaigns")
    .select("ai_proposal, status")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (fetchError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa diedit." };
  }

  const currentProposal = (campaign.ai_proposal ?? {}) as Record<string, Json>;

  const updatedProposal: Record<string, Json> = {
    ...currentProposal,
    headline: typeof headline === "string" ? headline : currentProposal.headline,
    primary_text: typeof primaryText === "string" ? primaryText : currentProposal.primary_text,
    cta: typeof cta === "string" ? cta : currentProposal.cta,
  };

  const { error: updateError } = await supabase
    .from("prompter_master_campaigns")
    .update({ ai_proposal: updatedProposal })
    .eq("id", campaignId);

  if (updateError) {
    return { error: "Gagal menyimpan perubahan." };
  }

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null };
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  const session = await requireSessionContext();
  const supabase = await createClient();

  await supabase
    .from("prompter_master_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "DRAFT");

  revalidatePath("/campaigns");
  redirect("/campaigns");
}

/**
 * Budget Guard gate + Approval Center handoff (product spec §15 step 9,
 * §38-39). A campaign whose budget exceeds the tenant's policy is rejected
 * outright — see services/budget-guard.ts. Otherwise a CAMPAIGN_LAUNCH
 * approval request is created and the campaign moves to
 * AWAITING_APPROVAL. Nothing here ever sets status to ACTIVE — that only
 * happens once a real connector (Phase 3+) confirms the campaign is live.
 */
export async function submitForApprovalAction(campaignId: string): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, status, daily_budget, total_budget, currency")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (campaignError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign ini sudah diajukan sebelumnya." };
  }

  const policy = await getOrCreateBudgetPolicy(supabase, session.tenantId);
  const monthToDateSpend = await getMonthToDateSpend(supabase, session.tenantId);
  const guardResult = checkBudgetGuard(policy, {
    dailyBudget: campaign.daily_budget,
    totalBudget: campaign.total_budget,
    campaignCurrency: campaign.currency,
    monthToDateSpend,
  });

  if (!guardResult.allowed) {
    return { error: guardResult.reason };
  }

  const { error: approvalError } = await supabase.from("prompter_approvals").insert({
    tenant_id: session.tenantId,
    approval_type: "CAMPAIGN_LAUNCH",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    requested_by: session.userId,
    context: { daily_budget: campaign.daily_budget, total_budget: campaign.total_budget },
  });

  if (approvalError) {
    return { error: "Gagal mengajukan campaign untuk persetujuan." };
  }

  await supabase
    .from("prompter_master_campaigns")
    .update({ status: "AWAITING_APPROVAL" })
    .eq("id", campaignId);
  await setChannelCampaignsStatus(supabase, campaignId, "AWAITING_APPROVAL");

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "campaign.submitted_for_approval",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    context: { daily_budget: campaign.daily_budget, total_budget: campaign.total_budget },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/approvals");
  return { error: null };
}

/** Reverts a not-yet-decided submission back to DRAFT and expires the request. */
export async function cancelSubmissionAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("prompter_master_campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "AWAITING_APPROVAL")
    .maybeSingle();

  if (!campaign) {
    return;
  }

  await supabase
    .from("prompter_master_campaigns")
    .update({ status: "DRAFT" })
    .eq("id", campaignId);
  await setChannelCampaignsStatus(supabase, campaignId, "DRAFT");

  await supabase
    .from("prompter_approvals")
    .update({ status: "EXPIRED" })
    .eq("resource_type", "prompter_master_campaigns")
    .eq("resource_id", campaignId)
    .eq("status", "PENDING");

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/approvals");
}
