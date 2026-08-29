"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { manualConversionSchema } from "@/schemas/conversion";
import { AnalyticsInsightSchema } from "@/schemas/ai/analytics-insight";
import { buildSystemPreamble, buildAnalyticsInsightPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import type { ConversionEventType, Json } from "@/types/database";

export interface AnalyticsActionState {
  error: string | null;
}

export async function logConversionAction(
  _prevState: AnalyticsActionState,
  formData: FormData,
): Promise<AnalyticsActionState> {
  const parsed = manualConversionSchema.safeParse({
    campaignId: formData.get("campaignId"),
    eventType: formData.get("eventType"),
    value: formData.get("value") || undefined,
    customerReference: formData.get("customerReference"),
    occurredAt: formData.get("occurredAt"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.from("prompter_conversions").insert({
    tenant_id: session.tenantId,
    master_campaign_id: parsed.data.campaignId || null,
    event_type: parsed.data.eventType as ConversionEventType,
    value: parsed.data.value,
    customer_reference: parsed.data.customerReference || null,
    source: "manual",
    occurred_at: parsed.data.occurredAt ? new Date(parsed.data.occurredAt).toISOString() : new Date().toISOString(),
  });

  if (error) {
    return { error: "Gagal mencatat konversi." };
  }

  revalidatePath("/analytics");
  return { error: null };
}

/**
 * AnalyticsAgent (product spec, Phase 7): summarizes the tenant's real
 * prompter_marketing_metrics + prompter_conversions into plain-language
 * trends. Refuses outright when neither table has any row for this
 * tenant — there is nothing honest an AI could say about data that
 * doesn't exist, so this never even calls the provider in that case
 * (see buildAnalyticsInsightPrompt for the second layer of protection:
 * an explicit "don't invent a channel/number not given" instruction for
 * whenever there IS some data, just not much).
 */
export async function generateAnalyticsInsightAction(): Promise<AnalyticsActionState> {
  const session = await requireSessionContext();
  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Anda tidak memiliki izin untuk membuat insight." };
  }

  const supabase = await createClient();

  const [{ data: metrics }, { data: conversions }] = await Promise.all([
    supabase
      .from("prompter_marketing_metrics")
      .select("platform, spend, impressions, clicks, reach")
      .eq("tenant_id", session.tenantId),
    supabase.from("prompter_conversions").select("event_type, value").eq("tenant_id", session.tenantId),
  ]);

  if ((metrics?.length ?? 0) === 0 && (conversions?.length ?? 0) === 0) {
    return { error: "Belum ada data metrik iklan atau konversi untuk dianalisis." };
  }

  const channelAgg = new Map<string, { spend: number; impressions: number; clicks: number; reach: number }>();
  for (const m of metrics ?? []) {
    const agg = channelAgg.get(m.platform) ?? { spend: 0, impressions: 0, clicks: 0, reach: 0 };
    agg.spend += m.spend;
    agg.impressions += m.impressions;
    agg.clicks += m.clicks;
    agg.reach += m.reach;
    channelAgg.set(m.platform, agg);
  }
  const channelMetrics = Array.from(channelAgg.entries()).map(([channel, agg]) => ({ channel, ...agg }));

  const conversionAgg = new Map<string, { value: number; count: number }>();
  for (const c of conversions ?? []) {
    const agg = conversionAgg.get(c.event_type) ?? { value: 0, count: 0 };
    agg.value += c.value ?? 0;
    agg.count += 1;
    conversionAgg.set(c.event_type, agg);
  }
  const conversionsSummary = Array.from(conversionAgg.entries()).map(([eventType, agg]) => ({
    eventType,
    ...agg,
  }));
  const totalConversionValue = conversionsSummary.reduce((sum, c) => sum + c.value, 0);

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  const result = await runAiJob({
    supabase,
    tenantId: session.tenantId,
    actorUserId: session.userId,
    jobType: "ANALYTICS_INSIGHT",
    schema: AnalyticsInsightSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildAnalyticsInsightPrompt({ channelMetrics, conversions: conversionsSummary, totalConversionValue }),
    inputReference: { channel_count: channelMetrics.length, conversion_row_count: conversions?.length ?? 0 },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const { error: upsertError } = await supabase.from("prompter_analytics_insights").upsert(
    {
      tenant_id: session.tenantId,
      summary: result.data.summary,
      trends: result.data.trends as Json,
      top_channel: result.data.top_channel,
      underperforming_channels: result.data.underperforming_channels as Json,
      risks: result.data.risks as Json,
      ai_job_id: result.jobId,
      model: result.model,
    },
    { onConflict: "tenant_id" },
  );

  if (upsertError) {
    return { error: "AI berhasil membuat insight tapi gagal menyimpannya. Silakan coba lagi." };
  }

  revalidatePath("/analytics");
  revalidatePath("/dashboard");
  return { error: null };
}
