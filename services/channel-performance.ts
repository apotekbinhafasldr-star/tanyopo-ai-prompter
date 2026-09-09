import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface ChannelPerformanceSummary {
  channel: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
}

/**
 * Tenant-wide historical ad performance aggregated by channel, across all
 * of this tenant's own past campaigns (same prompter_marketing_metrics
 * table and query shape already used by
 * features/analytics/actions.ts#generateAnalyticsInsightAction) — an
 * optional signal for Smart Channel Selection (Batch B2). Returns an
 * empty array when the tenant has no recorded metrics yet; callers must
 * treat that as "no history available" and fall back to heuristic
 * reasoning, never fabricate a number.
 */
export async function getTenantChannelPerformance(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<ChannelPerformanceSummary[]> {
  const { data } = await supabase
    .from("prompter_marketing_metrics")
    .select("platform, spend, impressions, clicks, reach")
    .eq("tenant_id", tenantId);

  const byChannel = new Map<string, ChannelPerformanceSummary>();
  for (const row of data ?? []) {
    const agg = byChannel.get(row.platform) ?? { channel: row.platform, spend: 0, impressions: 0, clicks: 0, reach: 0 };
    agg.spend += row.spend;
    agg.impressions += row.impressions;
    agg.clicks += row.clicks;
    agg.reach += row.reach;
    byChannel.set(row.platform, agg);
  }
  return Array.from(byChannel.values());
}
