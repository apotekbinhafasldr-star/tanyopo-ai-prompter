"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import { allocateDailyBudget } from "@/lib/campaigns/budget-allocation";
import { statusAfterSuccessfulLaunch } from "@/lib/campaigns/launched-status";
import { checkBudgetGuard } from "@/lib/budget-guard";
import {
  BUDGET_WRITE_DISABLED_MESSAGE,
  evaluateExternalBudgetWrite,
  isBudgetWritePlatformEnabled,
} from "@/lib/campaigns/external-budget-guard";
import { readEmergencyStopStrict } from "@/services/automation-settings";
import { decryptToken } from "@/lib/crypto/token-cipher";
import {
  LaunchDatabaseError,
  LaunchFenceLostError,
  LaunchStopError,
  buildClaimNote,
  buildIntentNote,
  buildProgressNote,
  correlationToken,
  describeCreatedObjects,
  describeLaunchFailure,
  launchAttemptTag,
  newLaunchNonce,
  requireCreatedId,
  withCorrelationToken,
  type CorrelationObject,
  type CreateStep,
  type CreatedPlatformObjects,
  type LaunchStep,
} from "@/lib/campaigns/launch-reconciliation";
import {
  PRODUCT_MEDIA_BUCKET,
  checkAdAccountId,
  checkCreativeImage,
  checkLaunchApproval,
  checkSelectedPageId,
  pickLaunchMedia,
  preflightFail,
  resolveLandingUrl,
  resolveMetaObjectivePlan,
  resolveOwnHosts,
  resolveTargetCountry,
  type Check,
  type ProductMediaRow,
} from "@/lib/campaigns/meta-launch-preflight";
import { resolveLegacyLandingCheck } from "@/services/destination-integrity";
import {
  checkApprovalDestinationSnapshot,
  checkLaunchDestination,
  ownHostsFromProcessEnv,
  withUtm,
} from "@/lib/campaigns/purchase-destination";
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
const OBJECTIVE_MAP: Record<Exclude<ConnectorPlatform, "META">, Record<string, string>> = {
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

const DEFAULT_OBJECTIVE: Record<Exclude<ConnectorPlatform, "META">, string> = {
  TIKTOK: "REACH",
  X: "AWARENESS",
};

/**
 * TikTok / X keep their existing objective mapping unchanged. META is NOT
 * here: its objective comes only from the verified contracts in
 * lib/campaigns/meta-objective-contracts.ts via the preflight (no default).
 */
function legacyObjective(platform: Exclude<ConnectorPlatform, "META">, objective: string): string {
  return OBJECTIVE_MAP[platform][objective] ?? DEFAULT_OBJECTIVE[platform];
}

/** Everything the Meta calls need, produced only by a fully passing preflight. */
interface MetaLaunchPlan {
  campaignObjective: string;
  optimizationGoal: string;
  targetingCountries: string[];
  pageId: string;
  linkUrl: string;
  imageUrl: string;
}

interface MetaPreflightInput {
  supabase: LaunchSupabase;
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  tenantId: string;
  master: {
    id: string;
    objective: string;
    product_id: string | null;
    target_country: string | null;
    selected_media_id: string | null;
    ai_proposal?: unknown;
  };
  /** `context` of the latest CAMPAIGN_LAUNCH approval (holds the destination snapshot). */
  approvalContext: unknown;
  adAccountId: string;
  selectedPageId: string | undefined;
}

const READ_FAILED = () =>
  preflightFail("PREFLIGHT_READ_FAILED", "Gagal membaca data pra-peluncuran. Peluncuran dibatalkan dan tidak ada yang dikirim ke Meta, coba lagi.");

/**
 * Meta preflight (PR #36). READ-ONLY and entirely before the exclusive
 * claim: it makes no write, no Meta call and no HTTP request to any
 * user-supplied URL. The image is judged from our own database row plus
 * Supabase Storage's object metadata (no HEAD/GET on a URL).
 */
async function runMetaPreflight(input: MetaPreflightInput): Promise<Check<MetaLaunchPlan>> {
  const { supabase, admin, tenantId, master, adAccountId, selectedPageId, approvalContext } = input;

  const account = checkAdAccountId(adAccountId);
  if (!account.ok) return account;
  const page = checkSelectedPageId(selectedPageId);
  if (!page.ok) return page;
  const objective = resolveMetaObjectivePlan(master.objective);
  if (!objective.ok) return objective;
  const country = resolveTargetCountry(master.target_country);
  if (!country.ok) return country;

  // Application hosts from trusted config (no substring of the brand name); fail closed when unknown.
  const ownHosts = resolveOwnHosts({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    metaRedirectUri: process.env.META_REDIRECT_URI,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (!ownHosts.ok) return ownHosts;

  const ownHostList = ownHosts.value;
  const resolveLegacyLandingUrl = (): Promise<Check<string>> =>
    resolveLegacyLandingCheck(supabase, tenantId, master.product_id, ownHostList);

  // Purchase destination (stored per campaign in ai_proposal). Re-validated here with the strict own-host
  // list. Legacy campaigns (no stored destination) keep the product/brand landing URL below, unchanged.
  const destinationCheck = checkLaunchDestination(master.ai_proposal, ownHosts.value);
  if (!destinationCheck.ok) {
    return preflightFail("LANDING_URL_MISSING", destinationCheck.message);
  }
  let link: Check<string>;
  if (destinationCheck.mode === "destination") {
    const dest = destinationCheck.destination;
    if (dest.type === "WEBSITE" && dest.link) {
      // UTM only on website links; never on wa.me.
      const tagged = withUtm(dest.link, { campaignRef: master.id });
      link = tagged.ok ? { ok: true, value: tagged.value } : preflightFail("LANDING_URL_UNSAFE", tagged.message);
    } else if (dest.type === "WHATSAPP" && dest.link) {
      link = { ok: true, value: dest.link };
    } else {
      link = preflightFail("LANDING_URL_MISSING", "Tujuan pembelian campaign tidak valid.");
    }
  } else {
    link = await resolveLegacyLandingUrl();
  }
  if (!link.ok) return link;

  // The destination being launched must be exactly the one that was approved. `link` above was resolved
  // from the database in THIS request (legacy: the validated product/brand URL), right before use, so
  // nothing can change between this comparison and the link that goes into the creative. A changed,
  // missing or unreadable snapshot (including every approval that predates snapshots) fails closed
  // before the claim and before any Meta call.
  const approved = checkApprovalDestinationSnapshot(
    approvalContext,
    master.ai_proposal,
    ownHosts.value,
    destinationCheck.mode === "legacy" ? link.value : undefined,
  );
  if (!approved.ok) return preflightFail("DESTINATION_CHANGED", approved.message);

  // Creative image: only this tenant's own product media.
  if (!master.product_id) {
    return resolveImageMissing();
  }
  const { data: mediaRows, error: mediaError } = await supabase
    .from("prompter_product_media")
    .select("id, tenant_id, product_id, storage_path, media_type, position")
    .eq("tenant_id", tenantId)
    .eq("product_id", master.product_id)
    .order("position", { ascending: true });
  if (mediaError || !mediaRows) return READ_FAILED();

  const media = pickLaunchMedia(mediaRows as (ProductMediaRow & { position?: number })[], master.selected_media_id);
  if (!media.ok) return media;

  const lastSlash = media.value.storage_path.lastIndexOf("/");
  const directory = lastSlash > 0 ? media.value.storage_path.slice(0, lastSlash) : "";
  const fileName = media.value.storage_path.slice(lastSlash + 1);
  let metadata: { mimetype?: unknown; size?: unknown } | null = null;
  // Directory must be this tenant's own product folder before Storage is even asked.
  if (directory === `${tenantId}/${master.product_id}` && fileName) {
    const { data: objects, error: listError } = await admin.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .list(directory, { limit: 100, search: fileName });
    if (listError) return READ_FAILED();
    const match = (objects ?? []).find((object) => object.name === fileName);
    metadata = (match?.metadata as { mimetype?: unknown; size?: unknown } | null | undefined) ?? null;
  }

  const image = checkCreativeImage({
    media: media.value,
    tenantId,
    productId: master.product_id,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    metadata,
  });
  if (!image.ok) return image;

  return {
    ok: true,
    value: {
      campaignObjective: objective.value.campaignObjective,
      optimizationGoal: objective.value.optimizationGoal,
      targetingCountries: [country.value],
      pageId: page.value,
      linkUrl: link.value,
      imageUrl: image.value.imageUrl,
    },
  };
}

function resolveImageMissing(): Check<never> {
  return preflightFail(
    "IMAGE_MISSING",
    "Campaign belum terhubung ke produk yang memiliki gambar untuk iklan. Tidak ada yang dikirim ke Meta.",
  );
}

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
    .select(
      "id, status, name, objective, currency, daily_budget, total_budget, ai_proposal, product_id, target_country, selected_media_id",
    )
    .eq("id", channelCampaign.master_campaign_id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (masterError || !masterCampaign) {
    return { error: "Campaign induk tidak ditemukan." };
  }

  if (masterCampaign.status !== "SCHEDULED") {
    return { error: "Campaign harus berstatus Terjadwal (sudah disetujui) sebelum diluncurkan." };
  }

  // Purchase destination gate (platform-agnostic, read-only, before any approval/credential/claim step):
  // a campaign whose stored destination is "none" or invalid can never be launched as a paid ad.
  // Legacy campaigns (no stored destination) are unaffected.
  const launchOwnHosts = ownHostsFromProcessEnv();
  const earlyDestination = checkLaunchDestination(masterCampaign.ai_proposal, launchOwnHosts);
  if (!earlyDestination.ok) {
    return { error: earlyDestination.message };
  }

  // Meta preflight, approval part (PR #36): the master's latest CAMPAIGN_LAUNCH
  // approval must be APPROVED. Read-only, before budget checks, the claim and
  // any Meta call. TikTok/X are untouched.
  let approvalContext: unknown = null;
  if (connectorPlatform === "META") {
    const { data: approvalRows, error: approvalError } = await supabase
      .from("prompter_approvals")
      .select("status, created_at, context")
      .eq("tenant_id", session.tenantId)
      .eq("approval_type", "CAMPAIGN_LAUNCH")
      .eq("resource_type", "prompter_master_campaigns")
      .eq("resource_id", masterCampaign.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (approvalError) {
      return { error: "Gagal memeriksa persetujuan campaign. Peluncuran dibatalkan, coba lagi." };
    }
    const approval = checkLaunchApproval(approvalRows);
    if (!approval.ok) return { error: approval.message };

    // Same "latest" rule as checkLaunchApproval: the approval that was just verified is the one whose
    // snapshot is compared.
    approvalContext =
      [...(approvalRows ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]?.context ??
      null;
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
    // null (no Page chosen yet) stays undefined: the Meta preflight below
    // rejects it before the claim (it is never replaced by another Page).
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

  // Meta preflight (PR #36): every remaining prerequisite is validated here,
  // read-only, BEFORE the exclusive claim. A failure claims nothing, creates
  // nothing on Meta and leaves every status untouched.
  let metaPlan: MetaLaunchPlan | null = null;
  if (connectorPlatform === "META") {
    const preflight = await runMetaPreflight({
      supabase,
      admin,
      tenantId: session.tenantId,
      master: masterCampaign,
      approvalContext,
      adAccountId: connectedAccount.external_account_id,
      selectedPageId,
    });
    if (!preflight.ok) {
      return { error: preflight.message };
    }
    metaPlan = preflight.value;
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
  //
  // H2-C: the claim also stamps a fresh, unguessable nonce into the row's
  // `error` note. Every later write of this attempt is conditional on the
  // EXACT note the attempt wrote last (see LaunchFence), so a stale worker, a
  // second attempt or a manual change can never be overwritten by this one.
  const nonce = newLaunchNonce();
  const fence: LaunchFence = { nonce, note: buildClaimNote(nonce) };
  const claim = await claimChannelCampaignLaunch(supabase, session.tenantId, channelCampaignId, fence.note);
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

  // H2-A: Meta object names carry a short correlation token (attempt + object
  // type) so an object whose id we never received can be found in Ads Manager.
  // TikTok/X names are left exactly as before. The token is a human aid, not an
  // idempotency key: Meta is NOT known to offer one.
  const tokenInNames = metaPlan !== null;
  const objectName = (object: CorrelationObject, label?: string): string =>
    tokenInNames
      ? withCorrelationToken(masterCampaign.name, object, nonce, label)
      : label
        ? `${masterCampaign.name} — ${label}`
        : masterCampaign.name;
  const tokenFor = (object: CorrelationObject): string | undefined => (tokenInNames ? correlationToken(nonce, object) : undefined);

  /**
   * Before EVERY create: (1) store the INTENT durably (fenced; no create if it
   * cannot be stored), then (2) read Emergency Stop strictly, immediately
   * before the external call. Anything but a confirmed `false` stops here.
   */
  const beforeCreate = async (createStep: CreateStep, object: CorrelationObject): Promise<void> => {
    await persistLaunchProgress(
      supabase,
      session.tenantId,
      channelCampaignId,
      fence,
      { error: buildIntentNote(createStep, created, nonce, tokenFor(object)) },
      "intent",
    );
    await assertEmergencyStopClear(supabase, session.tenantId);
  };

  try {
    await beforeCreate("createCampaign", "campaign");
    const campaign = await connector.createCampaign(accessToken, adAccountId, {
      name: objectName("campaign"),
      objective: metaPlan
        ? metaPlan.campaignObjective
        : legacyObjective(connectorPlatform as Exclude<ConnectorPlatform, "META">, masterCampaign.objective),
      dailyBudgetMinorUnits,
    });
    const campaignId = requireCreatedId(campaign, "createCampaign");
    created.campaignId = campaignId;

    // Record the id at once. If this write fails we stop BEFORE the next
    // object: continuing would build more objects that we cannot trace.
    step = "saveResult";
    await persistLaunchProgress(
      supabase,
      session.tenantId,
      channelCampaignId,
      fence,
      { external_campaign_id: campaignId, error: buildProgressNote(created, nonce) },
      "result",
    );

    step = "createAdSet";
    await beforeCreate("createAdSet", "adSet");
    const adSet = await connector.createAdSet(accessToken, adAccountId, {
      campaignId,
      name: objectName("adSet", "Ad Set"),
      dailyBudgetMinorUnits,
      // META: the master's validated target country and the preflight's
      // explicit optimization goal. TikTok/X keep their existing behaviour.
      targetingCountries: metaPlan ? metaPlan.targetingCountries : ["ID"],
      ...(metaPlan ? { optimizationGoal: metaPlan.optimizationGoal } : {}),
    });
    const adSetId = requireCreatedId(adSet, "createAdSet");
    created.adSetId = adSetId;
    step = "saveResult";
    await persistLaunchProgress(
      supabase,
      session.tenantId,
      channelCampaignId,
      fence,
      { error: buildProgressNote(created, nonce) },
      "result",
    );

    step = "createCreative";
    await beforeCreate("createCreative", "creative");
    const creative = await connector.createCreative(accessToken, adAccountId, {
      name: objectName("creative", "Creative"),
      headline: proposal?.headline ?? masterCampaign.name,
      primaryText: proposal?.primary_text ?? "",
      cta: proposal?.cta ?? "Pelajari Lebih Lanjut",
      // Track B — Meta's own required Page selection, set by the Owner via
      // the Connections page (features/connections/meta-page-picker.tsx).
      // Undefined for TikTok/X (the field is Meta-specific) and for a Meta
      // account that hasn't picked a Page yet — connector.createCreative()
      // already throws its existing, unchanged error in that case.
      // A Page that could not be READ never reaches this point (see above).
      pageId: metaPlan ? metaPlan.pageId : selectedPageId,
      ...(metaPlan ? { linkUrl: metaPlan.linkUrl, imageUrl: metaPlan.imageUrl } : {}),
    });
    const creativeId = requireCreatedId(creative, "createCreative");
    created.creativeId = creativeId;
    step = "saveResult";
    await persistLaunchProgress(
      supabase,
      session.tenantId,
      channelCampaignId,
      fence,
      { error: buildProgressNote(created, nonce) },
      "result",
    );

    step = "createAd";
    await beforeCreate("createAd", "ad");
    const ad = await connector.createAd(accessToken, adAccountId, {
      name: objectName("ad", "Ad"),
      adSetId,
      creativeId,
    });
    created.adId = requireCreatedId(ad, "createAd");

    // Final write: only a CONFIRMED update counts as success. META records PAUSED
    // (every Meta object is created PAUSED and nothing here activates it); only
    // TikTok / X keep ACTIVE. See lib/campaigns/launched-status.ts.
    step = "saveResult";
    await persistLaunchProgress(
      supabase,
      session.tenantId,
      channelCampaignId,
      fence,
      { status: statusAfterSuccessfulLaunch(connectorPlatform), error: null },
      "result",
    );
  } catch (err) {
    const failure = describeLaunchFailure(step, err, created, { nonce, tokenInNames });

    // Only a definitive rejection of the very first call (nothing exists on
    // the platform) returns the row to SCHEDULED. Every other failure stays
    // FAILED with the ids and a reconciliation note, which blocks a relaunch.
    // A request that no longer owns the claim writes NOTHING.
    const ownershipLost = failure.certainty === "FENCE_LOST";
    const recorded = ownershipLost
      ? false
      : await recordLaunchFailure(supabase, session.tenantId, channelCampaignId, fence, {
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
        ownership_lost: ownershipLost,
        launch_attempt: launchAttemptTag(nonce),
        ...(tokenInNames ? { correlation_token: `LNE-${launchAttemptTag(nonce)}-*` } : {}),
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
    context: {
      platform: connectorPlatform,
      external_campaign_id: created.campaignId ?? null,
      launch_attempt: launchAttemptTag(nonce),
      ...(tokenInNames ? { correlation_token: `LNE-${launchAttemptTag(nonce)}-*` } : {}),
      // The final ACTIVE write clears the row's progress note, so the ids of
      // the ad set, creative and ad would otherwise be lost. Only ids the
      // platform actually returned are recorded (same format as the
      // failure audit). The audit write is best-effort and never repeats a
      // platform call.
      ...(describeCreatedObjects(created) ? { created_objects: describeCreatedObjects(created) } : {}),
      ...budgetAuditContext,
    },
  });

  revalidatePath(`/campaigns/${masterCampaign.id}`);
  return { error: null };
}

type LaunchSupabase = Awaited<ReturnType<typeof createClient>>;

type ClaimResult = { claimed: true } | { claimed: false; error: string };

/**
 * Ownership of the claim for ONE launch attempt. `note` is the exact `error`
 * text this attempt wrote last; the next write is conditional on it, so the
 * row's own text acts as a compare-and-swap token (it carries the nonce).
 * Semantics of the PostgREST equality filter on this column are demonstrated
 * against a real PostgREST + PostgreSQL in the H2 PR (special characters,
 * 25-way races, stale writers).
 */
interface LaunchFence {
  readonly nonce: string;
  note: string;
}

type FencedPatch = Database["public"]["Tables"]["prompter_channel_campaigns"]["Update"];

/**
 * The exclusive launch claim: a single conditional UPDATE, filtered by id,
 * tenant and `status = 'SCHEDULED'`, that changes the status in the same
 * statement (and stamps the attempt's nonce note). Exactly one row must come
 * back; zero (someone else claimed it, wrong tenant, not SCHEDULED) or an
 * error means the caller stops and calls no platform API.
 */
async function claimChannelCampaignLaunch(
  supabase: LaunchSupabase,
  tenantId: string,
  channelCampaignId: string,
  claimNote: string,
): Promise<ClaimResult> {
  const { data, error } = await supabase
    .from("prompter_channel_campaigns")
    .update({ status: "FAILED", error: claimNote })
    .eq("id", channelCampaignId)
    .eq("tenant_id", tenantId)
    .eq("status", "SCHEDULED")
    .select("id");

  if (error || !data || data.length !== 1) {
    return { claimed: false, error: "Campaign ini sudah diluncurkan atau sedang diproses oleh permintaan lain." };
  }
  return { claimed: true };
}

type FencedWrite = "written" | "lost" | "error";

/**
 * The ONLY way this attempt writes after the claim: one conditional UPDATE
 * filtered by id AND tenant AND status = 'FAILED' AND error = <the note this
 * attempt wrote last>. "written" means exactly one row changed; "lost" means
 * no row matched (ownership gone); "error" means the database failed or the
 * answer was ambiguous (the write may or may not have happened).
 */
async function writeFenced(
  supabase: LaunchSupabase,
  tenantId: string,
  channelCampaignId: string,
  fence: LaunchFence,
  patch: FencedPatch,
): Promise<FencedWrite> {
  try {
    const { data, error } = await supabase
      .from("prompter_channel_campaigns")
      .update(patch)
      .eq("id", channelCampaignId)
      .eq("tenant_id", tenantId)
      .eq("status", "FAILED")
      .eq("error", fence.note)
      .select("id");
    if (error || !Array.isArray(data)) return "error";
    if (data.length === 1) {
      if (typeof patch.error === "string") fence.note = patch.error;
      return "written";
    }
    return data.length === 0 ? "lost" : "error";
  } catch {
    return "error";
  }
}

/**
 * A progress write made while this request holds the claim. It must hit
 * exactly the claimed row with this attempt's note; anything else stops the
 * launch before the next object: a LaunchFenceLostError when the row is no
 * longer ours, a LaunchDatabaseError otherwise.
 */
async function persistLaunchProgress(
  supabase: LaunchSupabase,
  tenantId: string,
  channelCampaignId: string,
  fence: LaunchFence,
  patch: { status?: "ACTIVE" | "PAUSED"; external_campaign_id?: string; error: string | null },
  phase: "intent" | "result",
): Promise<void> {
  const outcome = await writeFenced(supabase, tenantId, channelCampaignId, fence, patch);
  if (outcome === "written") return;
  const what = phase === "intent" ? "niat pembuatan" : patch.status !== undefined ? "status akhir" : "progres peluncuran";
  if (outcome === "lost") throw new LaunchFenceLostError(what);
  throw new LaunchDatabaseError(what, phase === "intent");
}

/**
 * Writes the failure outcome (fenced); returns whether the database confirmed
 * it. An existing external id is never overwritten with null: it is only
 * written when this attempt actually received one.
 */
async function recordLaunchFailure(
  supabase: LaunchSupabase,
  tenantId: string,
  channelCampaignId: string,
  fence: LaunchFence,
  outcome: { releasable: boolean; message: string; externalCampaignId: string | null },
): Promise<boolean> {
  const patch: FencedPatch = outcome.releasable
    ? { status: "SCHEDULED", error: null, external_campaign_id: null }
    : {
        status: "FAILED",
        error: outcome.message,
        ...(outcome.externalCampaignId ? { external_campaign_id: outcome.externalCampaignId } : {}),
      };
  // On any non-"written" result the row keeps whatever state it has: fail closed.
  return (await writeFenced(supabase, tenantId, channelCampaignId, fence, patch)) === "written";
}

/**
 * Fresh, STRICT Emergency Stop read immediately before an external create.
 * Only a confirmed `false` lets the create proceed: `true`, `null` (read
 * error), or anything unexpected stops the launch. No release, no retry.
 */
async function assertEmergencyStopClear(supabase: LaunchSupabase, tenantId: string): Promise<void> {
  let state: unknown;
  try {
    state = await readEmergencyStopStrict(supabase, tenantId);
  } catch {
    state = null;
  }
  if (state === false) return;
  throw new LaunchStopError(state === true ? "ACTIVE" : "UNREADABLE");
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
