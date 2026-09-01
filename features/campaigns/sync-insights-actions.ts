"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { Json } from "@/types/database";

export interface SyncInsightsState {
  error: string | null;
}

/**
 * Calls the connected platform's real `getInsights()` and writes the
 * result into `prompter_marketing_metrics` (upsert on
 * `channel_campaign_id, date` — re-syncing today just corrects today's
 * row). This is the first caller `getInsights()` has ever had — Phase 3
 * and Phase 6 both implemented it on every connector but never wired it
 * to anything, an explicitly documented gap. Only ever writes real
 * numbers the platform returned; a failure here is a stored `FAILED`-style
 * error, never a fabricated metric.
 */
export async function syncChannelCampaignInsightsAction(
  channelCampaignId: string,
): Promise<SyncInsightsState> {
  const session = await requireSessionContext();
  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Anda tidak memiliki izin untuk menyinkronkan insight." };
  }

  const supabase = await createClient();

  const { data: channelCampaign, error: channelError } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, channel, status, master_campaign_id, external_campaign_id")
    .eq("id", channelCampaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (channelError || !channelCampaign) {
    return { error: "Channel campaign tidak ditemukan." };
  }

  if (channelCampaign.status !== "ACTIVE" || !channelCampaign.external_campaign_id) {
    return { error: "Insight hanya bisa disinkronkan untuk campaign yang sudah Aktif di platform." };
  }

  const connectorPlatform = CHANNEL_TO_CONNECTOR[channelCampaign.channel];
  if (!connectorPlatform) {
    return { error: `Sinkronisasi insight untuk ${channelCampaign.channel} tidak didukung.` };
  }

  const { data: connectedAccount } = await supabase
    .from("prompter_connected_accounts")
    .select("id, external_account_id, status")
    .eq("tenant_id", session.tenantId)
    .eq("platform", connectorPlatform)
    .maybeSingle();

  if (!connectedAccount || connectedAccount.status !== "CONNECTED") {
    return { error: `${connectorPlatform} belum terhubung.` };
  }

  const connector = getConnector(connectorPlatform);
  if (!connector || !connector.isConfigured()) {
    return { error: `Connector ${connectorPlatform} belum dikonfigurasi.` };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { error: "Server belum dikonfigurasi untuk mengambil kredensial (SUPABASE_SECRET_KEY kosong)." };
  }

  const { data: credentials } = await admin
    .from("prompter_oauth_credentials")
    .select("encrypted_access_token")
    .eq("connected_account_id", connectedAccount.id)
    .maybeSingle();

  if (!credentials) {
    return { error: "Kredensial koneksi tidak ditemukan." };
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(credentials.encrypted_access_token);
  } catch {
    return { error: "Gagal membaca kredensial. Coba hubungkan ulang akun." };
  }

  try {
    const insights = await connector.getInsights(
      accessToken,
      connectedAccount.external_account_id,
      channelCampaign.external_campaign_id,
    );

    const today = new Date().toISOString().slice(0, 10);

    const { error: upsertError } = await supabase.from("prompter_marketing_metrics").upsert(
      {
        tenant_id: session.tenantId,
        master_campaign_id: channelCampaign.master_campaign_id,
        channel_campaign_id: channelCampaign.id,
        platform: channelCampaign.channel,
        date: today,
        spend: insights.spend,
        impressions: insights.impressions,
        reach: insights.reach,
        clicks: insights.clicks,
        raw_data: insights.raw as Json,
      },
      { onConflict: "channel_campaign_id,date" },
    );

    if (upsertError) {
      return { error: "Insight berhasil diambil tapi gagal disimpan. Silakan coba lagi." };
    }

    await supabase.from("prompter_audit_logs").insert({
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      action: "metrics.synced",
      resource_type: "prompter_channel_campaigns",
      resource_id: channelCampaign.id,
      context: { platform: connectorPlatform, date: today, spend: insights.spend },
    });

    revalidatePath(`/campaigns/${channelCampaign.master_campaign_id}`);
    revalidatePath("/analytics");
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mengambil insight dari platform.";
    return { error: message };
  }
}
