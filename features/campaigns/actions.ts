"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import {
  CampaignProposalSchema,
  withPrimaryCandidate,
  withRecommendedChannels,
  selectCandidate,
  type CampaignProposal,
} from "@/schemas/ai/campaign-proposal";
import { buildSystemPreamble, buildCampaignProposalPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import { syncChannelCampaigns, setChannelCampaignsStatus } from "@/services/channel-campaigns";
import { getTenantChannelPerformance } from "@/services/channel-performance";
import { getOrCreateBudgetPolicy, getMonthToDateSpend, checkBudgetGuard } from "@/services/budget-guard";
import { parseLocalDateTimeInZone } from "@/lib/scheduling/recommend-time";
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

  const channelPerformanceHistory = await getTenantChannelPerformance(supabase, session.tenantId);

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
    channelPerformanceHistory,
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

  const proposal = withRecommendedChannels(withPrimaryCandidate(result.data));

  const { error: updateError } = await supabase
    .from("prompter_master_campaigns")
    .update({ ai_proposal: proposal, ai_job_id: result.jobId })
    .eq("id", campaignId);

  if (updateError) {
    return { error: "AI berhasil membuat proposal baru tapi gagal menyimpannya." };
  }

  // Regenerate keeps the campaign's existing channel set (campaign.channels)
  // — it refreshes copy/reasoning/budget-split within that set, same as
  // before Batch B2. Only Quick Promote's own generation lets the AI's
  // channel choice determine the campaign's channels.
  await syncChannelCampaigns(
    supabase,
    session.tenantId,
    campaignId,
    campaign.channels,
    proposal.budget_allocation,
  );

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null };
}

/**
 * "Gunakan Ini" (Batch B1 correction #1) — the Owner picks a different
 * already-generated candidate as the active recommendation. Reuses the
 * candidate data the same AI call already produced; never calls the AI
 * again and never creates a second campaign. selectCandidate() swaps the
 * chosen candidate into the primary position and moves hook/headline/cta/
 * primary_text together, so the ad copy never ends up describing one
 * angle while the headline promises another.
 */
export async function selectCampaignCandidateAction(
  campaignId: string,
  candidateIndex: number,
): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

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

  const currentProposal = campaign.ai_proposal as CampaignProposal | null;
  if (!currentProposal || !Array.isArray(currentProposal.candidates) || currentProposal.candidates.length < 2) {
    return { error: "Belum ada kandidat alternatif untuk campaign ini." };
  }

  const updatedProposal = selectCandidate(currentProposal, candidateIndex);

  const { error: updateError } = await supabase
    .from("prompter_master_campaigns")
    .update({ ai_proposal: updatedProposal as unknown as Json })
    .eq("id", campaignId);

  if (updateError) {
    return { error: "Gagal menyimpan pilihan kandidat." };
  }

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null };
}

/**
 * Batch B4 — Media Workflow. "Gunakan"/"Ganti" on the campaign's own
 * Materi Promosi section (Review & Setujui step). Reuses
 * prompter_product_media as-is — no campaign-media table, no new upload
 * path — this only records which already-uploaded product media this
 * campaign wants as its promotional creative. `mediaId` must belong to
 * the same tenant AND the same product as the campaign, otherwise a user
 * could point one campaign at another product's (or tenant's) media.
 * Restricted to DRAFT, same rule every other campaign edit here follows.
 */
export async function selectCampaignMediaAction(
  campaignId: string,
  mediaId: string,
): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: campaign, error: fetchError } = await supabase
    .from("prompter_master_campaigns")
    .select("status, product_id")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (fetchError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa diedit." };
  }

  const { data: media, error: mediaError } = await supabase
    .from("prompter_product_media")
    .select("id")
    .eq("id", mediaId)
    .eq("tenant_id", session.tenantId)
    .eq("product_id", campaign.product_id ?? "")
    .maybeSingle();

  if (mediaError || !media) {
    return { error: "Media tidak ditemukan untuk produk ini." };
  }

  const { error: updateError } = await supabase
    .from("prompter_master_campaigns")
    .update({ selected_media_id: mediaId })
    .eq("id", campaignId);

  if (updateError) {
    return { error: "Gagal menyimpan pilihan media." };
  }

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
  const hook = formData.get("hook");

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
    hook: typeof hook === "string" ? hook : currentProposal.hook,
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

/**
 * Batch B3 — Smart Scheduling, on the Golden Path's own Review Campaign
 * step (not a separate menu). Sets or clears a single channel's schedule
 * on the same `prompter_channel_campaigns` row B2 already uses for
 * per-channel selection/budget — no parallel table. Restricted to DRAFT
 * campaigns, same as `updateCampaignCopyAction`: once submitted for
 * approval, the reviewed schedule shouldn't shift under the Owner mid-review.
 *
 * `scheduledAt` is a naive `datetime-local` wall-clock string, interpreted
 * as the tenant's own configured timezone
 * (`prompter_brand_profiles.default_timezone`) before being converted to
 * the real UTC instant stored — same rule `scheduleContentAction` follows
 * for content items.
 */
export async function scheduleChannelCampaignAction(
  channelCampaignId: string,
  _prevState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const scheduledAtRaw = formData.get("scheduledAt");
  const localValue = typeof scheduledAtRaw === "string" ? scheduledAtRaw.trim() : "";

  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: channelCampaign, error: fetchError } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, master_campaign_id")
    .eq("id", channelCampaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (fetchError || !channelCampaign) {
    return { error: "Channel campaign tidak ditemukan." };
  }

  const { data: masterCampaign } = await supabase
    .from("prompter_master_campaigns")
    .select("status")
    .eq("id", channelCampaign.master_campaign_id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (!masterCampaign || masterCampaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa diedit." };
  }

  let scheduledAt: string | null = null;
  if (localValue) {
    const { data: brandProfile } = await supabase
      .from("prompter_brand_profiles")
      .select("default_timezone")
      .eq("tenant_id", session.tenantId)
      .maybeSingle();
    const timeZone = brandProfile?.default_timezone ?? "Asia/Jakarta";

    const parsed = parseLocalDateTimeInZone(localValue, timeZone);
    if (!parsed) {
      return { error: "Format tanggal/jam tidak valid." };
    }
    scheduledAt = parsed.toISOString();
  }

  const { error: updateError } = await supabase
    .from("prompter_channel_campaigns")
    .update({ scheduled_at: scheduledAt })
    .eq("id", channelCampaignId);

  if (updateError) {
    return { error: "Gagal menyimpan jadwal channel." };
  }

  revalidatePath(`/campaigns/${channelCampaign.master_campaign_id}`);
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
