"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { promoteWizardSchema, quickPromoteSchema, channelOptions } from "@/schemas/campaign";
import { CampaignProposalSchema, withPrimaryCandidate, withRecommendedChannels } from "@/schemas/ai/campaign-proposal";
import { buildSystemPreamble, buildCampaignProposalPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import { syncChannelCampaigns } from "@/services/channel-campaigns";
import { getTenantChannelPerformance } from "@/services/channel-performance";
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

  const channelPerformanceHistory = await getTenantChannelPerformance(supabase, session.tenantId);

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
    inputReference: { product_id: product.id, ...inputs },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const proposal = withRecommendedChannels(withPrimaryCandidate(result.data));

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
      // Target market language/currency (product spec §8, §10) — derived
      // automatically rather than adding another wizard step: the
      // campaign targets whatever currency the product itself is priced
      // in, and the tenant's own business language, unless a future
      // enhancement lets a user override either explicitly.
      target_language: brandProfile?.default_language ?? null,
      target_currency: product.currency,
      audience_notes: inputs.audienceNotes,
      daily_budget: inputs.dailyBudget,
      total_budget: inputs.totalBudget,
      currency: product.currency,
      duration_days: parsed.data.durationDays,
      start_date: parsed.data.startDate || null,
      ai_proposal: proposal,
      ai_job_id: result.jobId,
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    return { error: "AI berhasil membuat proposal tapi gagal menyimpan campaign. Silakan coba lagi." };
  }

  // Advanced Wizard: the campaign always runs on the channels the user
  // explicitly picked (parsed.data.channels) — Smart Channel Selection
  // here only affects how the AI splits budget/reasoning within that
  // fixed set, never which channels the campaign targets. Quick Promote
  // is where the AI's own channel choice actually determines the
  // campaign's channel set (see generateQuickCampaignDraftAction below).
  await syncChannelCampaigns(
    supabase,
    session.tenantId,
    campaign.id,
    parsed.data.channels as Channel[],
    proposal.budget_allocation,
  );

  redirect(`/campaigns/${campaign.id}`);
}

/**
 * Quick Promote — the same AI generation and campaign creation as
 * generateCampaignDraftAction above, minus the channel/audience micro-steps.
 * Only product + objective + budget are actually required; everything else
 * either comes from the tenant's existing brand profile (already true for
 * the full wizard too) or is generated by the AI itself.
 */
export async function generateQuickCampaignDraftAction(
  _prevState: PromoteActionState,
  formData: FormData,
): Promise<PromoteActionState> {
  const parsed = quickPromoteSchema.safeParse({
    productId: formData.get("productId"),
    objective: formData.get("objective"),
    dailyBudget: formData.get("dailyBudget") || undefined,
    totalBudget: formData.get("totalBudget") || undefined,
    channels: formData.getAll("channels"),
    targetCountry: formData.get("targetCountry"),
    targetRegion: formData.get("targetRegion"),
    targetCity: formData.get("targetCity"),
    audienceNotes: formData.get("audienceNotes"),
    durationDays: formData.get("durationDays") || undefined,
    // Unlike the Advanced wizard, QuickPromoteWizard never renders a
    // startDate field at all, so formData.get() returns null here, not
    // undefined — z.optional() rejects null, which is exactly what was
    // failing every Quick Promote submission with Zod's generic default
    // message. `|| undefined` normalizes "not submitted" the same way
    // every other optional field above already does.
    startDate: formData.get("startDate") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const supabase = await createClient();

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

  // Quick Promote's whole point is that the user isn't asked to pick
  // channels. When none were picked (the default), the AI prompt is given
  // the full channel menu to choose freely from — buildCampaignProposalPrompt
  // tells the model to recommend "only from the chosen channels," so an
  // empty list here would wrongly constrain it to nothing. The campaign
  // itself still only ever stores the AI's own recommended_channels below,
  // never this full list, so the end result is exactly the channels the AI
  // actually recommended — the same shape as if the user had picked them.
  const promptChannels =
    parsed.data.channels && parsed.data.channels.length > 0
      ? parsed.data.channels
      : channelOptions.map((c) => c.value);

  const channelPerformanceHistory = await getTenantChannelPerformance(supabase, session.tenantId);

  const inputs = {
    objective: parsed.data.objective,
    channels: promptChannels,
    targetCountry: parsed.data.targetCountry || null,
    targetRegion: parsed.data.targetRegion || null,
    targetCity: parsed.data.targetCity || null,
    audienceNotes: parsed.data.audienceNotes || null,
    dailyBudget: parsed.data.dailyBudget ?? null,
    totalBudget: parsed.data.totalBudget ?? null,
    currency: product.currency,
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
    inputReference: { product_id: product.id, quick_promote: true, ...inputs },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  // Smart Channel Selection (Batch B2): recommended_channels is derived
  // deterministically from budget_allocation's own positive-percentage
  // entries (withRecommendedChannels), not trusted as a separately
  // model-authored array — the same "never let two representations of
  // the same thing drift apart" pattern as withPrimaryCandidate(). Quick
  // Promote is the one flow where this choice actually becomes the
  // campaign's channel set (the Advanced Wizard always keeps the user's
  // own picks — see generateCampaignDraftAction above).
  const proposal = withRecommendedChannels(withPrimaryCandidate(result.data));
  const recommendedChannels = proposal.recommended_channels as Channel[];

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .insert({
      tenant_id: session.tenantId,
      product_id: product.id,
      name: `Promosi ${product.name}`,
      objective: parsed.data.objective as PrimaryGoal,
      channels: recommendedChannels,
      target_country: inputs.targetCountry,
      target_region: inputs.targetRegion,
      target_city: inputs.targetCity,
      target_language: brandProfile?.default_language ?? null,
      target_currency: product.currency,
      audience_notes: inputs.audienceNotes,
      daily_budget: inputs.dailyBudget,
      total_budget: inputs.totalBudget,
      currency: product.currency,
      duration_days: parsed.data.durationDays,
      start_date: parsed.data.startDate || null,
      ai_proposal: proposal,
      ai_job_id: result.jobId,
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    return { error: "AI berhasil membuat proposal tapi gagal menyimpan campaign. Silakan coba lagi." };
  }

  await syncChannelCampaigns(supabase, session.tenantId, campaign.id, recommendedChannels, proposal.budget_allocation);

  redirect(`/campaigns/${campaign.id}?from=quick-promote`);
}
