"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { promoteWizardSchema } from "@/schemas/campaign";
import { CampaignProposalSchema } from "@/schemas/ai/campaign-proposal";
import { getAIProvider } from "@/lib/ai/get-provider";
import { buildSystemPreamble, buildCampaignProposalPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import type { Channel, PrimaryGoal } from "@/types/database";

export interface PromoteActionState {
  error: string | null;
}

export async function generateCampaignDraftAction(
  _prevState: PromoteActionState,
  formData: FormData,
): Promise<PromoteActionState> {
  const parsed = promoteWizardSchema.safeParse({
    productId: formData.get("productId"),
    objective: formData.get("objective"),
    channels: formData.getAll("channels"),
    targetCountry: formData.get("targetCountry"),
    targetRegion: formData.get("targetRegion"),
    targetCity: formData.get("targetCity"),
    audienceNotes: formData.get("audienceNotes"),
    dailyBudget: formData.get("dailyBudget") || undefined,
    totalBudget: formData.get("totalBudget") || undefined,
    durationDays: formData.get("durationDays") || undefined,
    startDate: formData.get("startDate"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const supabase = await createClient();

  const provider = getAIProvider();
  if (!provider) {
    return { error: "AI belum dikonfigurasi. Tambahkan AI_PROVIDER_API_KEY untuk mengaktifkan fitur ini." };
  }

  const { data: product, error: productError } = await supabase
    .from("prompter_products")
    .select("*")
    .eq("id", parsed.data.productId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (productError || !product) {
    return { error: "Produk tidak ditemukan." };
  }

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  const inputs = {
    objective: parsed.data.objective,
    channels: parsed.data.channels,
    targetCountry: parsed.data.targetCountry || null,
    targetRegion: parsed.data.targetRegion || null,
    targetCity: parsed.data.targetCity || null,
    audienceNotes: parsed.data.audienceNotes || null,
    dailyBudget: parsed.data.dailyBudget ?? null,
    totalBudget: parsed.data.totalBudget ?? null,
    currency: product.currency,
  };

  const result = await runAiJob({
    supabase,
    provider,
    tenantId: session.tenantId,
    jobType: "CAMPAIGN_PROPOSAL",
    schema: CampaignProposalSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildCampaignProposalPrompt(product, inputs),
    inputReference: { product_id: product.id, ...inputs },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .insert({
      tenant_id: session.tenantId,
      product_id: product.id,
      name: `Promosi ${product.name}`,
      objective: parsed.data.objective as PrimaryGoal,
      channels: parsed.data.channels as Channel[],
      target_country: inputs.targetCountry,
      target_region: inputs.targetRegion,
      target_city: inputs.targetCity,
      audience_notes: inputs.audienceNotes,
      daily_budget: inputs.dailyBudget,
      total_budget: inputs.totalBudget,
      currency: product.currency,
      duration_days: parsed.data.durationDays,
      start_date: parsed.data.startDate || null,
      ai_proposal: result.data,
      ai_job_id: result.jobId,
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    return { error: "AI berhasil membuat proposal tapi gagal menyimpan campaign. Silakan coba lagi." };
  }

  redirect(`/campaigns/${campaign.id}`);
}
