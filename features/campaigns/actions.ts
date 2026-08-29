"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { CampaignProposalSchema } from "@/schemas/ai/campaign-proposal";
import { getAIProvider } from "@/lib/ai/get-provider";
import { buildSystemPreamble, buildCampaignProposalPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import type { Json } from "@/types/database";

export interface CampaignActionState {
  error: string | null;
}

export async function regenerateCampaignProposalAction(campaignId: string): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const provider = getAIProvider();
  if (!provider) {
    return { error: "AI belum dikonfigurasi. Tambahkan AI_PROVIDER_API_KEY untuk mengaktifkan fitur ini." };
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (campaignError || !campaign || !campaign.product_id) {
    return { error: "Campaign tidak ditemukan." };
  }

  const { data: product, error: productError } = await supabase
    .from("prompter_products")
    .select("*")
    .eq("id", campaign.product_id)
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
    provider,
    tenantId: session.tenantId,
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
    .select("ai_proposal")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (fetchError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
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
