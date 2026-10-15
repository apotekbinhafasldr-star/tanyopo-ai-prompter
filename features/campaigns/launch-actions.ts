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
import {
  LAUNCH_IN_PROGRESS_NOTE,
  LaunchDatabaseError,
  buildProgressNote,
  describeCreatedObjects,
  describeLaunchFailure,
  requireCreatedId,
  type CreatedPlatformObjects,
  type LaunchStep,
} from "@/lib/campaigns/launch-reconciliation";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";
import type { ConnectorPlatform, Database } from "@/types/database";

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

  // Credentials, connector and token are all resolved BEFORE the claim: any
  // failure here writes nothing, so a launch that cannot even start never
  // leaves the row claimed.
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

  // Exclusive claim (launch safety remediation). ONE conditional UPDATE moves
  // the row SCHEDULED -> FAILED(+in-progress note) and returns the rows it
  // really changed. Postgres row locking makes this exclusive: of two
  // concurrent requests, the second blocks on the row lock, then re-checks
  // `status = 'SCHEDULED'` against the new row version, matches zero rows and
  // stops here — before any platform call. The previous claim only rewrote
  // `error` and left the status SCHEDULED, so BOTH requests passed it.
  // FAILED is deliberately the fail-closed holding state: if this request
  // dies mid-launch the row can never be launched again by accident, and the
  // note tells the operator to reconcile in Meta Ads Manager first.
  const claim = await claimChannelCampaignLaunch(supabase, session.tenantId, channelCampaignId);
  if (!claim.claimed) {
    return { error: claim.error };
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

  const created: CreatedPlatformObjects = {};
  let step: LaunchStep = "createCampaign";

  try {
    const campaign = await connector.createCampaign(accessToken, adAccountId, {
      name: masterCampaign.name,
      objective:
        OBJECTIVE_MAP[connectorPlatform][masterCampaign.objective] ?? DEFAULT_OBJECTIVE[connectorPlatform],
      dailyBudgetMinorUnits,
    });
    const campaignId = requireCreatedId(campaign, "createCampaign");
    created.campaignId = campaignId;

    // Record the id at once. If this write fails we stop BEFORE the next
    // object: continuing would build more objects that we cannot trace.
    step = "saveResult";
    await persistLaunchProgress(supabase, session.tenantId, channelCampaignId, {
      external_campaign_id: campaignId,
      error: buildProgressNote(created),
    });

    step = "createAdSet";
    const adSet = await connector.createAdSet(accessToken, adAccountId, {
      campaignId,
      name: `${masterCampaign.name} — Ad Set`,
      dailyBudgetMinorUnits,
      // No location picker/geocoding yet — defaults to Indonesia.
      targetingCountries: ["ID"],
    });
    const adSetId = requireCreatedId(adSet, "createAdSet");
    created.adSetId = adSetId;
    step = "saveResult";
    await persistLaunchProgress(supabase, session.tenantId, channelCampaignId, {
      error: buildProgressNote(created),
    });

    step = "createCreative";
    const creative = await connector.createCreative(accessToken, adAccountId, {
      name: `${masterCampaign.name} — Creative`,
      headline: proposal?.headline ?? masterCampaign.name,
      primaryText: proposal?.primary_text ?? "",
      cta: proposal?.cta ?? "Pelajari Lebih Lanjut",
      // Track B — Meta's own required Page selection, set by the Owner via
      // the Connections page (features/connections/meta-page-picker.tsx).
      // Undefined for TikTok/X (the field is Meta-specific) and for a Meta
      // account that hasn't picked a Page yet — connector.createCreative()
      // already throws its existing, unchanged error in that case.
      // A Page that could not be READ never reaches this point (see above).
      pageId: selectedPageId,
    });
    const creativeId = requireCreatedId(creative, "createCreative");
    created.creativeId = creativeId;
    step = "saveResult";
    await persistLaunchProgress(supabase, session.tenantId, channelCampaignId, {
      error: buildProgressNote(created),
    });

    step = "createAd";
    const ad = await connector.createAd(accessToken, adAccountId, {
      name: `${masterCampaign.name} — Ad`,
      adSetId,
      creativeId,
    });
    created.adId = requireCreatedId(ad, "createAd");

    // Final write: only a CONFIRMED update to ACTIVE counts as success.
    step = "saveResult";
    await persistLaunchProgress(supabase, session.tenantId, channelCampaignId, {
      status: "ACTIVE",
      error: null,
    });
  } catch (err) {
    const failure = describeLaunchFailure(step, err, created);

    // Only a definitive rejection of the very first call (nothing exists on
    // the platform) returns the row to SCHEDULED. Every other failure stays
    // FAILED with the ids and a reconciliation note, which blocks a relaunch.
    const recorded = await recordLaunchFailure(supabase, session.tenantId, channelCampaignId, {
      releasable: failure.releasable,
      message: failure.message,
      externalCampaignId: created.campaignId ?? null,
    });

    await writeLaunchAudit(supabase, {
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      action: "campaign.launch_failed",
      resource_type: "prompter_channel_campaigns",
      resource_id: channelCampaignId,
      context: {
        platform: connectorPlatform,
        error: failure.message,
        failed_step: failure.step,
        certainty: failure.certainty,
        released_for_retry: failure.releasable && recorded,
        status_recorded: recorded,
        ...(describeCreatedObjects(created) ? { created_objects: describeCreatedObjects(created) } : {}),
        ...budgetAuditContext,
      },
    });

    revalidatePath(`/campaigns/${masterCampaign.id}`);
    return { error: failure.message };
  }

  await writeLaunchAudit(supabase, {
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "campaign.launched",
    resource_type: "prompter_channel_campaigns",
    resource_id: channelCampaignId,
    context: { platform: connectorPlatform, external_campaign_id: created.campaignId ?? null, ...budgetAuditContext },
  });

  revalidatePath(`/campaigns/${masterCampaign.id}`);
  return { error: null };
}

type LaunchSupabase = Awaited<ReturnType<typeof createClient>>;

type ClaimResult = { claimed: true } | { claimed: false; error: string };

/**
 * The exclusive launch claim: a single conditional UPDATE, filtered by id,
 * tenant and `status = 'SCHEDULED'`, that changes the status in the same
 * statement. Exactly one row must come back; zero (someone else claimed it,
 * wrong tenant, not SCHEDULED) or an error means the caller stops and calls
 * no platform API.
 */
async function claimChannelCampaignLaunch(
  supabase: LaunchSupabase,
  tenantId: string,
  channelCampaignId: string,
): Promise<ClaimResult> {
  const { data, error } = await supabase
    .from("prompter_channel_campaigns")
    .update({ status: "FAILED", error: LAUNCH_IN_PROGRESS_NOTE })
    .eq("id", channelCampaignId)
    .eq("tenant_id", tenantId)
    .eq("status", "SCHEDULED")
    .select("id");

  if (error || !data || data.length !== 1) {
    return { claimed: false, error: "Campaign ini sudah diluncurkan atau sedang diproses oleh permintaan lain." };
  }
  return { claimed: true };
}

/**
 * A progress write made while this request holds the claim. It must hit
 * exactly the claimed row (still FAILED + in progress); anything else is a
 * LaunchDatabaseError, which stops the launch before the next object.
 */
async function persistLaunchProgress(
  supabase: LaunchSupabase,
  tenantId: string,
  channelCampaignId: string,
  patch: { status?: "ACTIVE"; external_campaign_id?: string; error: string | null },
): Promise<void> {
  const { data, error } = await supabase
    .from("prompter_channel_campaigns")
    .update(patch)
    .eq("id", channelCampaignId)
    .eq("tenant_id", tenantId)
    .eq("status", "FAILED")
    .select("id");

  if (error || !data || data.length !== 1) {
    throw new LaunchDatabaseError(patch.status === "ACTIVE" ? "status akhir" : "progres peluncuran");
  }
}

/** Writes the failure outcome; returns whether the database confirmed it. */
async function recordLaunchFailure(
  supabase: LaunchSupabase,
  tenantId: string,
  channelCampaignId: string,
  outcome: { releasable: boolean; message: string; externalCampaignId: string | null },
): Promise<boolean> {
  const patch = outcome.releasable
    ? { status: "SCHEDULED" as const, error: null, external_campaign_id: null }
    : { status: "FAILED" as const, error: outcome.message, external_campaign_id: outcome.externalCampaignId };

  try {
    const { data, error } = await supabase
      .from("prompter_channel_campaigns")
      .update(patch)
      .eq("id", channelCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", "FAILED")
      .select("id");
    return !error && Array.isArray(data) && data.length === 1;
  } catch {
    // The row keeps the claim state (FAILED + in-progress note): fail closed.
    return false;
  }
}

/** Audit rows are best-effort: a failed audit write never changes the launch outcome. */
async function writeLaunchAudit(
  supabase: LaunchSupabase,
  row: Database["public"]["Tables"]["prompter_audit_logs"]["Insert"],
): Promise<void> {
  try {
    const { error } = await supabase.from("prompter_audit_logs").insert(row);
    if (error) console.error("[launch] audit log write failed");
  } catch {
    console.error("[launch] audit log write failed");
  }
}
