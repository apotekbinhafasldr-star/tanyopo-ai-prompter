"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { buildSystemPreamble, buildOptimizationRecommendationPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import { OptimizationRecommendationSchema, type OptimizationRecommendation } from "@/schemas/ai/optimization-recommendation";
import { computeProfitEstimate } from "@/lib/profit-estimate";
import { checkBudgetGuard } from "@/lib/budget-guard";
import { getOrCreateBudgetPolicy, getMonthToDateSpend } from "@/services/budget-guard";
import { policyTypeForAction } from "@/lib/autopilot-policy";
import type { Channel, Json, OptimizationActionType, RiskLevel } from "@/types/database";

export interface OptimizationActionState {
  error: string | null;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * OptimizationAgent (product spec, Phase 7): compares one campaign's own
 * channels against each other using real prompter_marketing_metrics +
 * prompter_conversions, reasoning about estimated marketing contribution
 * (lib/profit-estimate.ts) rather than ROAS alone. Refuses when the
 * campaign has no channel campaigns with any recorded spend or
 * conversions — there's nothing real to compare yet.
 *
 * After saving, each individual recommendation is checked against
 * `maybeAutoSubmitRecommendation()` — a recommendation is only ever
 * auto-routed to the Approval Center (skipping the human's manual
 * "submit" click) when automation_mode is 'autopilot', Emergency Stop is
 * inactive, and a matching prompter_autopilot_policies row is enabled.
 * This is human-triggered detection (someone opened this page and asked
 * for recommendations) with policy-gated auto-routing, not an autonomous
 * background scheduler — this app has no job-scheduling infrastructure to
 * run OptimizationAgent on its own.
 */
export async function generateOptimizationRecommendationsAction(
  masterCampaignId: string,
): Promise<OptimizationActionState> {
  const session = await requireSessionContext();
  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Anda tidak memiliki izin untuk membuat rekomendasi optimasi." };
  }

  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, name, product_id, daily_budget")
    .eq("id", masterCampaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (campaignError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
  }

  const { data: channelCampaigns } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, channel, status, budget_percentage")
    .eq("master_campaign_id", masterCampaignId);

  if (!channelCampaigns || channelCampaigns.length === 0) {
    return { error: "Campaign ini belum punya channel untuk dibandingkan." };
  }

  const channelCampaignIds = channelCampaigns.map((cc) => cc.id);

  const [{ data: metrics }, { data: conversions }, { data: product }] = await Promise.all([
    supabase
      .from("prompter_marketing_metrics")
      .select("channel_campaign_id, spend")
      .in("channel_campaign_id", channelCampaignIds),
    supabase
      .from("prompter_conversions")
      .select("channel_campaign_id, value, event_type")
      .in("channel_campaign_id", channelCampaignIds)
      .eq("event_type", "PURCHASE"),
    campaign.product_id
      ? supabase
          .from("prompter_products")
          .select("hpp")
          .eq("id", campaign.product_id)
          .eq("tenant_id", session.tenantId)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const hasAnyData = (metrics?.length ?? 0) > 0 || (conversions?.length ?? 0) > 0;
  if (!hasAnyData) {
    return { error: "Belum ada data spend atau konversi untuk channel campaign ini." };
  }

  const spendByChannelCampaign = new Map<string, number>();
  for (const m of metrics ?? []) {
    spendByChannelCampaign.set(
      m.channel_campaign_id!,
      (spendByChannelCampaign.get(m.channel_campaign_id!) ?? 0) + m.spend,
    );
  }

  const conversionsByChannelCampaign = new Map<string, { count: number; value: number }>();
  for (const c of conversions ?? []) {
    const key = c.channel_campaign_id!;
    const agg = conversionsByChannelCampaign.get(key) ?? { count: 0, value: 0 };
    agg.count += 1;
    agg.value += c.value ?? 0;
    conversionsByChannelCampaign.set(key, agg);
  }

  const hpp = product?.hpp ?? null;

  const channelPerformance = channelCampaigns.map((cc) => {
    const spend = spendByChannelCampaign.get(cc.id) ?? 0;
    const conv = conversionsByChannelCampaign.get(cc.id) ?? { count: 0, value: 0 };
    const dailyBudget =
      cc.budget_percentage !== null && campaign.daily_budget !== null
        ? Math.round((campaign.daily_budget * cc.budget_percentage) / 100)
        : null;
    const estimate = computeProfitEstimate({
      revenue: conv.value,
      adSpend: spend,
      hpp,
      unitsSold: conv.count,
    });

    return {
      channel: cc.channel,
      status: cc.status,
      dailyBudget,
      spend,
      conversionCount: conv.count,
      conversionValue: conv.value,
      estimatedContribution: estimate.netProfit,
    };
  });

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  const result = await runAiJob({
    supabase,
    tenantId: session.tenantId,
    actorUserId: session.userId,
    jobType: "OPTIMIZATION_RECOMMENDATION",
    schema: OptimizationRecommendationSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildOptimizationRecommendationPrompt({ campaignName: campaign.name, channels: channelPerformance }),
    inputReference: { master_campaign_id: masterCampaignId, channel_count: channelPerformance.length },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const { error: upsertError } = await supabase.from("prompter_optimization_recommendations").upsert(
    {
      tenant_id: session.tenantId,
      master_campaign_id: masterCampaignId,
      summary: result.data.summary,
      recommendations: result.data.recommendations as Json,
      ai_job_id: result.jobId,
      model: result.model,
    },
    { onConflict: "master_campaign_id" },
  );

  if (upsertError) {
    return { error: "AI berhasil membuat rekomendasi tapi gagal menyimpannya. Silakan coba lagi." };
  }

  await maybeAutoSubmitRecommendations(supabase, session.tenantId, session.userId, masterCampaignId, result.data);

  revalidatePath(`/campaigns/${masterCampaignId}`);
  revalidatePath("/approvals");
  return { error: null };
}

/**
 * Checks every recommendation against the tenant's autopilot
 * configuration and auto-submits the ones that qualify — every boundary
 * the product spec names for Autopilot is checked here, in code, before
 * anything is routed anywhere: `automation_mode` must be `'autopilot'`
 * (tenant authorization), Emergency Stop must be inactive, and a matching
 * `prompter_autopilot_policies` row must be `enabled` (the specific
 * automation scope the tenant turned on). None of these bypass the
 * Approval Center or Budget Guard — `submitRecommendationCore()` still
 * runs the exact same checks as a manual submission.
 */
async function maybeAutoSubmitRecommendations(
  supabase: SupabaseServerClient,
  tenantId: string,
  actorUserId: string,
  masterCampaignId: string,
  result: OptimizationRecommendation,
): Promise<void> {
  const { data: automationSettings } = await supabase
    .from("prompter_automation_settings")
    .select("automation_mode, emergency_stop_active")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!automationSettings || automationSettings.automation_mode !== "autopilot") return;
  if (automationSettings.emergency_stop_active) return;

  const { data: policies } = await supabase
    .from("prompter_autopilot_policies")
    .select("policy_type, enabled")
    .eq("tenant_id", tenantId);
  const enabledPolicies = new Set((policies ?? []).filter((p) => p.enabled).map((p) => p.policy_type));

  for (const rec of result.recommendations) {
    if (rec.action_type === "NO_ACTION") continue;
    const policyType = policyTypeForAction(rec.action_type);
    if (!policyType || !enabledPolicies.has(policyType)) continue;

    await submitRecommendationCore(
      supabase,
      tenantId,
      actorUserId,
      masterCampaignId,
      rec.channel,
      rec.action_type,
      rec.suggested_daily_budget,
      rec.rationale,
      rec.risk_level,
      "autopilot_policy",
    );
  }
}

/**
 * Bridges one AI-generated recommendation into the existing, already
 * privilege-separated Approval Center (product spec's Autopilot boundary:
 * a suggestion never executes itself). Budget Guard runs here, before the
 * approval row even exists — same precedent as Phase 2 campaign
 * submission ("a campaign that exceeds the tenant's limit never reaches
 * the queue"), so an owner's later APPROVED decision can never be used to
 * push a budget past the tenant's configured limit; the system refuses
 * the submission outright instead.
 */
async function submitRecommendationCore(
  supabase: SupabaseServerClient,
  tenantId: string,
  actorUserId: string,
  masterCampaignId: string,
  channel: Channel,
  actionType: OptimizationActionType,
  suggestedDailyBudget: number | null,
  rationale: string,
  riskLevel: RiskLevel,
  source: "optimization_agent" | "autopilot_policy",
): Promise<OptimizationActionState> {
  if (actionType === "NO_ACTION") {
    return { error: "Rekomendasi ini tidak memerlukan tindakan." };
  }

  const { data: channelCampaign, error: channelError } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, channel, status")
    .eq("master_campaign_id", masterCampaignId)
    .eq("channel", channel)
    .eq("tenant_id", tenantId)
    .single();

  if (channelError || !channelCampaign) {
    return { error: "Channel campaign tidak ditemukan." };
  }

  if (channelCampaign.status !== "ACTIVE") {
    return { error: "Hanya channel yang sudah Aktif yang bisa diajukan tindakan optimasi." };
  }

  if ((actionType === "INCREASE_BUDGET" || actionType === "DECREASE_BUDGET") && suggestedDailyBudget !== null) {
    const { data: masterCampaign, error: masterCampaignError } = await supabase
      .from("prompter_master_campaigns")
      .select("currency")
      .eq("id", masterCampaignId)
      .eq("tenant_id", tenantId)
      .single();

    if (masterCampaignError || !masterCampaign) {
      return { error: "Campaign induk tidak ditemukan — tidak dapat memverifikasi Budget Guard." };
    }

    const policy = await getOrCreateBudgetPolicy(supabase, tenantId);
    const monthToDateSpend = await getMonthToDateSpend(supabase, tenantId);
    const guardResult = checkBudgetGuard(policy, {
      dailyBudget: suggestedDailyBudget,
      totalBudget: null,
      campaignCurrency: masterCampaign.currency,
      monthToDateSpend,
    });
    if (!guardResult.allowed) {
      return { error: `Ditolak oleh Budget Guard: ${guardResult.reason}` };
    }
  }

  const { data: approval, error: insertError } = await supabase
    .from("prompter_approvals")
    .insert({
      tenant_id: tenantId,
      approval_type: "AUTOPILOT_ACTION",
      resource_type: "prompter_channel_campaigns",
      resource_id: channelCampaign.id,
      requested_by: actorUserId,
      context: {
        source,
        master_campaign_id: masterCampaignId,
        channel,
        action_type: actionType,
        suggested_daily_budget: suggestedDailyBudget,
        rationale,
        risk_level: riskLevel,
      } as Json,
    })
    .select("id")
    .single();

  if (insertError || !approval) {
    return { error: "Gagal mengajukan rekomendasi untuk persetujuan." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    action: source === "autopilot_policy" ? "autopilot_policy.auto_submitted" : "optimization.recommendation_submitted",
    resource_type: "prompter_approvals",
    resource_id: approval.id,
    context: { channel, action_type: actionType, risk_level: riskLevel },
  });

  return { error: null };
}

export async function submitRecommendationAsApprovalAction(
  masterCampaignId: string,
  channel: Channel,
  actionType: OptimizationActionType,
  suggestedDailyBudget: number | null,
  rationale: string,
  riskLevel: RiskLevel,
): Promise<OptimizationActionState> {
  const session = await requireSessionContext();
  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Anda tidak memiliki izin untuk mengajukan rekomendasi." };
  }

  const supabase = await createClient();
  const result = await submitRecommendationCore(
    supabase,
    session.tenantId,
    session.userId,
    masterCampaignId,
    channel,
    actionType,
    suggestedDailyBudget,
    rationale,
    riskLevel,
    "optimization_agent",
  );

  revalidatePath(`/campaigns/${masterCampaignId}`);
  revalidatePath("/approvals");
  return result;
}
