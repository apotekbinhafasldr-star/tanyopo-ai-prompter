"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { growthGoalSchema, followerSnapshotSchema, growthPlatforms } from "@/schemas/growth";
import { GrowthRecommendationSchema, type GrowthRecommendation } from "@/schemas/ai/growth-recommendation";
import { buildSystemPreamble, buildGrowthRecommendationPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import type { GrowthPlatform } from "@/types/database";

export interface GrowthActionState {
  error: string | null;
}

function requireWriteAccess(role: string): string | null {
  if (role !== "owner" && role !== "marketing") {
    return "Hanya Owner/Marketing yang dapat mengubah data Growth.";
  }
  return null;
}

export async function setGrowthGoalAction(
  _prevState: GrowthActionState,
  formData: FormData,
): Promise<GrowthActionState> {
  const parsed = growthGoalSchema.safeParse({
    platform: formData.get("platform"),
    targetFollowers: formData.get("targetFollowers"),
    targetDate: formData.get("targetDate"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const permissionError = requireWriteAccess(session.role);
  if (permissionError) return { error: permissionError };

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_growth_goals").upsert(
    {
      tenant_id: session.tenantId,
      platform: parsed.data.platform as GrowthPlatform,
      target_followers: parsed.data.targetFollowers,
      target_date: parsed.data.targetDate || null,
      notes: parsed.data.notes || null,
    },
    { onConflict: "tenant_id,platform" },
  );

  if (error) {
    return { error: "Gagal menyimpan target growth. Silakan coba lagi." };
  }

  revalidatePath("/growth");
  return { error: null };
}

export async function logFollowerSnapshotAction(
  _prevState: GrowthActionState,
  formData: FormData,
): Promise<GrowthActionState> {
  const parsed = followerSnapshotSchema.safeParse({
    platform: formData.get("platform"),
    followerCount: formData.get("followerCount"),
    recordedAt: formData.get("recordedAt"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const permissionError = requireWriteAccess(session.role);
  if (permissionError) return { error: permissionError };

  const supabase = await createClient();

  const recordedAt = parsed.data.recordedAt || new Date().toISOString().slice(0, 10);

  const { error } = await supabase.from("prompter_follower_snapshots").upsert(
    {
      tenant_id: session.tenantId,
      platform: parsed.data.platform as GrowthPlatform,
      follower_count: parsed.data.followerCount,
      recorded_at: recordedAt,
    },
    { onConflict: "tenant_id,platform,recorded_at" },
  );

  if (error) {
    return { error: "Gagal mencatat jumlah follower. Silakan coba lagi." };
  }

  revalidatePath("/growth");
  return { error: null };
}

export interface GrowthRecommendationState {
  error: string | null;
  recommendation: GrowthRecommendation | null;
  /** True when the tenant has no data at all yet — the AI was never even called, so there's nothing honest to show but a clear next step. */
  insufficientData: boolean;
}

/**
 * Batch B6 — "Rekomendasi LINOE". Reuses the existing AI Router
 * (ANALYTICS_INSIGHT job_type — see schemas/ai/growth-recommendation.ts
 * for why no new job_type was added) and real tenant data already
 * collected elsewhere in the app (products, campaigns, content,
 * connected accounts, growth goals/snapshots). Refuses outright — never
 * even calls the provider — when none of that exists yet, the same
 * "nothing honest to say about data that doesn't exist" rule
 * generateAnalyticsInsightAction already follows. Ephemeral: the result
 * is returned directly to the caller, never persisted (prompter_analytics_insights
 * already belongs to the Analytics feature, one row per tenant), so
 * pressing the button again always regenerates fresh.
 */
export async function generateGrowthRecommendationAction(): Promise<GrowthRecommendationState> {
  const session = await requireSessionContext();
  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Anda tidak memiliki izin untuk membuat rekomendasi.", recommendation: null, insufficientData: false };
  }

  const supabase = await createClient();

  const [
    { data: brandProfile },
    { data: products },
    { data: campaigns },
    { count: contentCount },
    { data: connectedAccounts },
    { data: goals },
    { data: snapshots },
  ] = await Promise.all([
    supabase.from("prompter_brand_profiles").select("*").eq("tenant_id", session.tenantId).maybeSingle(),
    supabase.from("prompter_products").select("id, name").eq("tenant_id", session.tenantId).limit(10),
    supabase.from("prompter_master_campaigns").select("id, status").eq("tenant_id", session.tenantId).limit(10),
    supabase.from("prompter_content_items").select("id", { count: "exact", head: true }).eq("tenant_id", session.tenantId),
    supabase.from("prompter_connected_accounts").select("platform, status").eq("tenant_id", session.tenantId),
    supabase.from("prompter_growth_goals").select("platform, target_followers, target_date").eq("tenant_id", session.tenantId),
    supabase
      .from("prompter_follower_snapshots")
      .select("platform, follower_count, recorded_at")
      .eq("tenant_id", session.tenantId)
      .order("recorded_at", { ascending: false })
      .limit(20),
  ]);

  const hasAnyData =
    (products?.length ?? 0) > 0 ||
    (campaigns?.length ?? 0) > 0 ||
    (contentCount ?? 0) > 0 ||
    (goals?.length ?? 0) > 0 ||
    (snapshots?.length ?? 0) > 0;

  if (!hasAnyData) {
    return { error: null, recommendation: null, insufficientData: true };
  }

  const connectedConnectorPlatforms = new Set(
    (connectedAccounts ?? []).filter((a) => a.status === "CONNECTED").map((a) => a.platform),
  );
  const connectedPlatforms = growthPlatforms
    .filter((p) => {
      const connector = CHANNEL_TO_CONNECTOR[p.value];
      return connector ? connectedConnectorPlatforms.has(connector) : false;
    })
    .map((p) => p.value);
  const unconnectedPlatforms = growthPlatforms.map((p) => p.value).filter((p) => !connectedPlatforms.includes(p));

  const latestSnapshotByPlatform = new Map<string, { follower_count: number; recorded_at: string }>();
  for (const s of snapshots ?? []) {
    if (!latestSnapshotByPlatform.has(s.platform)) {
      latestSnapshotByPlatform.set(s.platform, s);
    }
  }

  const result = await runAiJob({
    supabase,
    tenantId: session.tenantId,
    actorUserId: session.userId,
    jobType: "ANALYTICS_INSIGHT",
    schema: GrowthRecommendationSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildGrowthRecommendationPrompt({
      productCount: products?.length ?? 0,
      productNames: (products ?? []).map((p) => p.name),
      campaignCount: campaigns?.length ?? 0,
      campaignStatuses: (campaigns ?? []).map((c) => c.status),
      contentCount: contentCount ?? 0,
      connectedPlatforms,
      unconnectedPlatforms,
      growthGoals: (goals ?? []).map((g) => ({
        platform: g.platform,
        targetFollowers: g.target_followers,
        targetDate: g.target_date,
      })),
      followerSnapshots: Array.from(latestSnapshotByPlatform.entries()).map(([platform, s]) => ({
        platform,
        followerCount: s.follower_count,
        recordedAt: s.recorded_at,
      })),
    }),
    inputReference: {
      growth_recommendation: true,
      product_count: products?.length ?? 0,
      campaign_count: campaigns?.length ?? 0,
      content_count: contentCount ?? 0,
    },
  });

  if (!result.ok) {
    return { error: result.error, recommendation: null, insufficientData: false };
  }

  return { error: null, recommendation: result.data, insufficientData: false };
}
