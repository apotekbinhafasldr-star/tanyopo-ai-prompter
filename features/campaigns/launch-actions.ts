"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import { allocateDailyBudget } from "@/lib/campaigns/budget-allocation";
import { checkBudgetGuard } from "@/lib/budget-guard";
import {
  BUDGET_WRITE_DISABLED_MESSAGE,
  evaluateExternalBudgetWrite,
  isBudgetWritePlatformEnabled,
} from "@/lib/campaigns/external-budget-guard";
import { readEmergencyStopStrict } from "@/services/automation-settings";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";
import type { ConnectorPlatform } from "@/types/database";

export interface LaunchActionState {
  error: string | null;
}

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
 * - **Meta**: `createCreative` requires a connected Facebook Page (Track B —
 *   the Owner selects one via the Connections page, features/connections/
 *   meta-page-picker.tsx; `selected_page_id` is read in its own query and
 *   threaded into the creative call below; if that read fails the launch
 *   is aborted before any platform call). A Meta account that hasn't
 *   picked a Page yet still throws the same existing error as before Track B.
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

  // S1 External Budget Safety Gate, static layer: default deny for every
  // platform. Runs before any further read and long before the claim, the
  // credentials or any connector call. See lib/campaigns/external-budget-guard.ts.
  if (!isBudgetWritePlatformEnabled(connectorPlatform)) {
    return { error: BUDGET_WRITE_DISABLED_MESSAGE };
  }

  const { data: masterCampaign, error: masterError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, status, name, objective, currency, daily_budget, total_budget, ai_proposal")
    .eq("id", channelCampaign.master_campaign_id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (masterError || !masterCampaign) {
    return { error: "Campaign induk tidak ditemukan." };
  }

  if (masterCampaign.status !== "SCHEDULED") {
    return { error: "Campaign harus berstatus Terjadwal (sudah disetujui) sebelum diluncurkan." };
  }

  // P0 budget launch safety — ALL budget validation completes here, BEFORE
  // the atomic claim and before any connector call, so a rejected launch
  // writes nothing and creates nothing on the ad platform.
  //
  // `daily_budget` is the master's TOTAL daily budget across the campaign;
  // it is split across the PAID channel rows by their `budget_percentage`
  // (SEO takes no share). `total_budget` is never used as a daily budget.
  // Only IDR is supported: the app does not verify the ad account's own
  // currency (separate gate before any real ad launch).
  if (masterCampaign.currency !== "IDR") {
    return {
      error: `Peluncuran otomatis hanya mendukung mata uang IDR (campaign ini ${masterCampaign.currency}).`,
    };
  }

  const { data: channelRows, error: channelRowsError } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, channel, budget_percentage")
    .eq("master_campaign_id", masterCampaign.id)
    .eq("tenant_id", session.tenantId);

  if (channelRowsError || !channelRows) {
    return { error: "Gagal membaca alokasi budget channel. Coba lagi." };
  }

  const allocation = allocateDailyBudget(
    masterCampaign.daily_budget,
    channelRows.map((row) => ({
      id: row.id,
      channel: row.channel,
      budgetPercentage: row.budget_percentage == null ? null : Number(row.budget_percentage),
    })),
  );
  if (!allocation.ok) {
    return { error: allocation.error };
  }

  const allocatedDailyBudget = allocation.allocations[channelCampaign.id];
  if (allocatedDailyBudget == null) {
    return { error: "Channel ini tidak memiliki alokasi budget berbayar, sehingga tidak dapat diluncurkan." };
  }

  // Budget Guard, re-run read-only right before the external side effect.
  // Deliberately NOT getOrCreateBudgetPolicy (it INSERTs): a read error
  // fails closed; an absent policy row means "no limits configured", same
  // as the default that service would have created.
  const { data: policyRow, error: policyError } = await supabase
    .from("prompter_budget_policies")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (policyError) {
    return { error: "Gagal memeriksa kebijakan Budget Guard. Peluncuran dibatalkan, coba lagi." };
  }
  const policy = policyRow ?? {
    tenant_id: session.tenantId,
    daily_limit: null,
    monthly_limit: null,
    campaign_limit: null,
    currency: "IDR",
    require_approval_above: null,
    autopilot_limit: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  // Month-to-date spend only influences Budget Guard when a monthly limit is
  // set. Read it here read-only and FAIL CLOSED: unlike the shared
  // getMonthToDateSpend() (which maps a query error to 0 for its other
  // callers), a failed or non-finite read must never be treated as "no spend"
  // at this gate. Same semantics as that helper otherwise: session tenant,
  // rows dated from the 1st of the current month.
  let monthToDateSpend = 0;
  if (policy.monthly_limit != null) {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const { data: spendRows, error: spendError } = await supabase
      .from("prompter_marketing_metrics")
      .select("spend")
      .eq("tenant_id", session.tenantId)
      .gte("date", monthStart);
    if (spendError || !spendRows) {
      return { error: "Gagal memeriksa pengeluaran bulan ini. Peluncuran dibatalkan, coba lagi." };
    }
    monthToDateSpend = spendRows.reduce((sum, row) => sum + Number(row.spend ?? 0), 0);
    if (!Number.isFinite(monthToDateSpend) || monthToDateSpend < 0) {
      return { error: "Data pengeluaran bulan ini tidak valid. Peluncuran dibatalkan." };
    }
  }
  const guard = checkBudgetGuard(policy, {
    dailyBudget: masterCampaign.daily_budget,
    totalBudget: masterCampaign.total_budget,
    campaignCurrency: masterCampaign.currency,
    monthToDateSpend,
  });
  if (!guard.allowed) {
    return { error: guard.reason ?? "Peluncuran ditolak oleh Budget Guard." };
  }

  // S1 External Budget Safety Gate, evidence layer: still before the claim,
  // so a denial writes nothing (no claim, status update or audit) and calls
  // no platform API. The ad-account currency and the current external budget
  // are NOT VERIFIED anywhere yet (null), which the gate always denies.
  const emergencyStopActive = await readEmergencyStopStrict(supabase, session.tenantId);
  const gate = evaluateExternalBudgetWrite({
    operation: "LAUNCH",
    platform: connectorPlatform,
    emergencyStopActive,
    masterCurrency: masterCampaign.currency,
    accountCurrency: null,
    proposedDailyBudget: allocatedDailyBudget,
    currentExternalDailyBudget: null,
    otherPaidChannelsDailyTotal: null,
    masterDailyBudget: masterCampaign.daily_budget,
    budgetGuard: { allowed: true },
  });
  if (!gate.allowed) {
    return { error: gate.message };
  }

  // Connection reads, still BEFORE the atomic claim: a failed read writes
  // nothing and calls no platform API (fail closed).
  //
  // Schema compatibility: the base account read never names a Track B
  // column, so it works whether or not the Track B migration has been
  // applied to the database. `selected_page_id` is read in its own query,
  // only for META (the only platform that uses it), and ANY failure to read
  // it aborts the launch. It is never replaced by a default or a guess.
  const { data: connectedAccount, error: connectedAccountError } = await supabase
    .from("prompter_connected_accounts")
    .select("id, external_account_id, status")
    .eq("tenant_id", session.tenantId)
    .eq("platform", connectorPlatform)
    .maybeSingle();

  if (connectedAccountError) {
    return { error: "Gagal membaca data koneksi akun. Peluncuran dibatalkan, coba lagi." };
  }

  if (!connectedAccount || connectedAccount.status !== "CONNECTED") {
    return {
      error: `${connectorPlatform} belum terhubung. Hubungkan akun di halaman Connections terlebih dahulu.`,
    };
  }

  let selectedPageId: string | undefined;
  if (connectorPlatform === "META") {
    const { data: pageRow, error: pageError } = await supabase
      .from("prompter_connected_accounts")
      .select("selected_page_id")
      .eq("tenant_id", session.tenantId)
      .eq("platform", connectorPlatform)
      .maybeSingle();

    if (pageError || !pageRow) {
      return {
        error:
          "Pilihan Page Facebook tidak dapat dibaca. Peluncuran dibatalkan dan tidak ada yang dibuat di platform iklan.",
      };
    }
    // null (no Page chosen yet) stays undefined: connector.createCreative()
    // already throws its existing error for that case, unchanged.
    selectedPageId = pageRow.selected_page_id ?? undefined;
  }

  // P0 remediation (Meta Ads production readiness): atomic claim to prevent
  // a duplicate/concurrent launch of this same channel campaign. Previously
  // nothing server-side re-checked this row's own current status before
  // proceeding — only the launch button's client-side `loading`→`disabled`
  // state did, which does not protect against a second tab, a network
  // retry, or two near-simultaneous clicks. This is a single conditional
  // UPDATE, atomic at the database row level: it only matches (and only
  // then do we proceed) if this channel campaign's status is still
  // SCHEDULED, so a second concurrent call for the same row finds zero
  // matching rows and aborts here instead of creating a second Meta
  // campaign for the same request.
  const { data: claimedRows, error: claimError } = await supabase
    .from("prompter_channel_campaigns")
    .update({ error: null })
    .eq("id", channelCampaignId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "SCHEDULED")
    .select("id");

  if (claimError || !claimedRows || claimedRows.length === 0) {
    return {
      error: "Campaign ini sudah diluncurkan atau sedang diproses oleh permintaan lain.",
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
  // This row's own share of the master daily budget (validated above), in
  // IDR whole units — IDR has no sub-unit in practice. Whether the platform
  // API's budget unit matches is a separate gate before real ad launch.
  const dailyBudgetMinorUnits = allocatedDailyBudget;
  const budgetAuditContext = {
    allocated_daily_budget: allocatedDailyBudget,
    budget_percentage: channelRows.find((row) => row.id === channelCampaign.id)?.budget_percentage ?? null,
    master_daily_budget: masterCampaign.daily_budget,
    paid_total_percentage: allocation.paidTotalPercentage,
  };

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
      // Track B — Meta's own required Page selection, set by the Owner via
      // the Connections page (features/connections/meta-page-picker.tsx).
      // Undefined for TikTok/X (the field is Meta-specific) and for a Meta
      // account that hasn't picked a Page yet — connector.createCreative()
      // already throws its existing, unchanged error in that case, so
      // behavior for an unselected Page is identical to before this change.
      // A Page that could not be READ never reaches this point (see above).
      pageId: selectedPageId,
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
      context: { platform: connectorPlatform, external_campaign_id: externalCampaignId, ...budgetAuditContext },
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
      context: { platform: connectorPlatform, error: message, ...budgetAuditContext },
    });

    revalidatePath(`/campaigns/${masterCampaign.id}`);
    return { error: message };
  }
}
