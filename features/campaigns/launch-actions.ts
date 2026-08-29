"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";
import type { ConnectorPlatform } from "@/types/database";

export interface LaunchActionState {
  error: string | null;
}

const CHANNEL_TO_CONNECTOR: Partial<Record<string, ConnectorPlatform>> = {
  FACEBOOK: "META",
  INSTAGRAM: "META",
  TIKTOK: "TIKTOK",
  X: "X",
};

/**
 * Each ad platform has its own objective vocabulary (Meta's `OUTCOME_*`,
 * TikTok's `objective_type`, X's `objective`) — mapping Promoter's
 * `PrimaryGoal` per connector platform rather than assuming one
 * platform's names apply everywhere.
 */
const OBJECTIVE_MAP: Record<ConnectorPlatform, Record<string, string>> = {
  META: {
    INCREASE_SALES: "OUTCOME_SALES",
    GET_LEADS: "OUTCOME_LEADS",
    INCREASE_FOLLOWERS: "OUTCOME_ENGAGEMENT",
    BRAND_AWARENESS: "OUTCOME_AWARENESS",
    WEBSITE_TRAFFIC: "OUTCOME_TRAFFIC",
    PROMOTE_APP: "OUTCOME_APP_PROMOTION",
  },
  TIKTOK: {
    INCREASE_SALES: "CONVERSIONS",
    GET_LEADS: "LEAD_GENERATION",
    INCREASE_FOLLOWERS: "ENGAGEMENT",
    BRAND_AWARENESS: "REACH",
    WEBSITE_TRAFFIC: "TRAFFIC",
    PROMOTE_APP: "APP_PROMOTION",
  },
  X: {
    INCREASE_SALES: "WEBSITE_CONVERSIONS",
    GET_LEADS: "LEAD_GENERATION",
    INCREASE_FOLLOWERS: "FOLLOWERS",
    BRAND_AWARENESS: "AWARENESS",
    WEBSITE_TRAFFIC: "WEBSITE_CLICKS",
    PROMOTE_APP: "APP_INSTALLS",
  },
};

const DEFAULT_OBJECTIVE: Record<ConnectorPlatform, string> = {
  META: "OUTCOME_AWARENESS",
  TIKTOK: "REACH",
  X: "AWARENESS",
};

/**
 * Launches one channel of an approved (SCHEDULED) campaign to its connected
 * ad platform (Meta, TikTok, or X — Phase 6). This is the one code path in
 * this app allowed to set a channel_campaigns.status to ACTIVE — only
 * after the platform's own API has confirmed each object was created
 * (product spec §90, never claim "berhasil tayang" without external
 * confirmation). Every object every connector creates is left
 * paused/disabled (see lib/connectors/*-connector.ts) — this action stages
 * the campaign, it does not start spending money. Entirely platform-
 * agnostic here: which connector runs is resolved once via
 * `getConnector(connectorPlatform)`, everything platform-specific lives
 * behind the `PlatformConnector` interface.
 *
 * Known gaps, one real missing prerequisite per platform — each connector
 * throws `ConnectorConfigError` at its own stopping point rather than
 * faking success past it, and this action stores that as the channel
 * campaign's `error` exactly like any other failure:
 * - **Meta**: `createCreative` requires a connected Facebook Page, no picker UI yet.
 * - **TikTok/X**: `createAdSet` requires each platform's own numeric location id
 *   (not an ISO country code) — no verified mapping exists yet, so this stops
 *   one step earlier than Meta rather than risk targeting the wrong location.
 */
export async function launchChannelCampaignAction(channelCampaignId: string): Promise<LaunchActionState> {
  const session = await requireSessionContext();
  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Anda tidak memiliki izin untuk meluncurkan campaign." };
  }

  const supabase = await createClient();

  const { data: channelCampaign, error: channelError } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, channel, master_campaign_id")
    .eq("id", channelCampaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (channelError || !channelCampaign) {
    return { error: "Channel campaign tidak ditemukan." };
  }

  const connectorPlatform = CHANNEL_TO_CONNECTOR[channelCampaign.channel];
  if (!connectorPlatform) {
    return { error: `Peluncuran otomatis untuk ${channelCampaign.channel} belum didukung.` };
  }

  const { data: masterCampaign, error: masterError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, status, name, objective, daily_budget, total_budget, ai_proposal")
    .eq("id", channelCampaign.master_campaign_id)
    .single();

  if (masterError || !masterCampaign) {
    return { error: "Campaign induk tidak ditemukan." };
  }

  if (masterCampaign.status !== "SCHEDULED") {
    return { error: "Campaign harus berstatus Terjadwal (sudah disetujui) sebelum diluncurkan." };
  }

  const { data: connectedAccount } = await supabase
    .from("prompter_connected_accounts")
    .select("id, external_account_id, status")
    .eq("tenant_id", session.tenantId)
    .eq("platform", connectorPlatform)
    .maybeSingle();

  if (!connectedAccount || connectedAccount.status !== "CONNECTED") {
    return {
      error: `${connectorPlatform} belum terhubung. Hubungkan akun di halaman Connections terlebih dahulu.`,
    };
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

  const connector = getConnector(connectorPlatform);
  if (!connector) {
    return { error: `Connector ${connectorPlatform} tidak tersedia.` };
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(credentials.encrypted_access_token);
  } catch {
    return { error: "Gagal membaca kredensial. Coba hubungkan ulang akun." };
  }

  const proposal = masterCampaign.ai_proposal as CampaignProposal | null;
  const adAccountId = connectedAccount.external_account_id;
  // Simplification: treats the budget as already being in the ad account's
  // minor unit (true for IDR, which has no sub-unit in practice) — a
  // cents-based currency would need multiplying by 100 here.
  const dailyBudgetMinorUnits = Math.round(masterCampaign.daily_budget ?? masterCampaign.total_budget ?? 0);

  let externalCampaignId: string | null = null;

  try {
    const campaign = await connector.createCampaign(accessToken, adAccountId, {
      name: masterCampaign.name,
      objective:
        OBJECTIVE_MAP[connectorPlatform][masterCampaign.objective] ?? DEFAULT_OBJECTIVE[connectorPlatform],
      dailyBudgetMinorUnits,
    });
    externalCampaignId = campaign.id;

    // Persist progress immediately — a paused, no-spend object created on
    // Meta is worth keeping even if a later step below fails.
    await supabase
      .from("prompter_channel_campaigns")
      .update({ external_campaign_id: externalCampaignId, error: null })
      .eq("id", channelCampaignId);

    const adSet = await connector.createAdSet(accessToken, adAccountId, {
      campaignId: externalCampaignId,
      name: `${masterCampaign.name} — Ad Set`,
      dailyBudgetMinorUnits,
      // No location picker/geocoding yet — defaults to Indonesia.
      targetingCountries: ["ID"],
    });

    const creative = await connector.createCreative(accessToken, adAccountId, {
      name: `${masterCampaign.name} — Creative`,
      headline: proposal?.headline ?? masterCampaign.name,
      primaryText: proposal?.primary_text ?? "",
      cta: proposal?.cta ?? "Pelajari Lebih Lanjut",
    });

    await connector.createAd(accessToken, adAccountId, {
      name: `${masterCampaign.name} — Ad`,
      adSetId: adSet.id,
      creativeId: creative.id,
    });

    await supabase
      .from("prompter_channel_campaigns")
      .update({ status: "ACTIVE", error: null })
      .eq("id", channelCampaignId);

    await supabase.from("prompter_audit_logs").insert({
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      action: "campaign.launched",
      resource_type: "prompter_channel_campaigns",
      resource_id: channelCampaignId,
      context: { platform: connectorPlatform, external_campaign_id: externalCampaignId },
    });

    revalidatePath(`/campaigns/${masterCampaign.id}`);
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal meluncurkan campaign.";

    await supabase
      .from("prompter_channel_campaigns")
      .update({ status: "FAILED", error: message, external_campaign_id: externalCampaignId })
      .eq("id", channelCampaignId);

    await supabase.from("prompter_audit_logs").insert({
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      action: "campaign.launch_failed",
      resource_type: "prompter_channel_campaigns",
      resource_id: channelCampaignId,
      context: { platform: connectorPlatform, error: message },
    });

    revalidatePath(`/campaigns/${masterCampaign.id}`);
    return { error: message };
  }
}
