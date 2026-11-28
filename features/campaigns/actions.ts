"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import {
  CampaignProposalGenerationSchema,
  normalizeProposalAdditions,
  findCopyLengthViolations,
  withPrimaryCandidate,
  withRecommendedChannels,
  selectCandidate,
  type CampaignProposal,
} from "@/schemas/ai/campaign-proposal";
import { buildSystemPreamble, buildCampaignProposalPrompt } from "@/lib/ai/prompts";
import { checkChannelAllocation } from "@/lib/campaigns/channel-allocation";
import {
  canDeleteCampaign,
  canEditCampaign,
  CAMPAIGN_DELETE_FORBIDDEN_MESSAGE,
  CAMPAIGN_EDIT_FORBIDDEN_MESSAGE,
  CAMPAIGN_MEDIA_FORBIDDEN_MESSAGE,
  CAMPAIGN_SCHEDULE_FORBIDDEN_MESSAGE,
  CAMPAIGN_SUBMIT_FORBIDDEN_MESSAGE,
} from "@/lib/campaigns/campaign-roles";
import { evaluateCopyGuard, buildCopySnapshot, COPY_SNAPSHOT_KEY } from "@/lib/campaigns/copy-guard";
import { readCopyGuardContext } from "@/services/copy-guard-context";
import { campaignHasManualMetrics } from "@/features/campaigns/manual-metrics-actions";
import { runAiJob } from "@/services/ai-jobs";
import {
  syncChannelCampaigns,
  readChannelAllocationRows,
  isMirrorConfirmed,
  mirrorChannelCampaignStatus,
  transitionMasterCampaign,
  readChannelRowsForRecovery,
  moveChannelCampaignsScheduledToDraft,
  restoreChannelCampaignsToScheduled,
  transitionMasterScheduledToDraft,
} from "@/services/channel-campaigns";
import { getTenantChannelPerformance } from "@/services/channel-performance";
import { getOrCreateBudgetPolicy, getMonthToDateSpend, checkBudgetGuard } from "@/services/budget-guard";
import { evaluateApprovalThreshold } from "@/lib/campaigns/approval-threshold";
import { checkCampaignLimitCoverage } from "@/lib/campaigns/campaign-limit";
import { parseLocalDateTimeInZone } from "@/lib/scheduling/recommend-time";
import type { ApprovalStatus, Json } from "@/types/database";
import { campaignHasManualAdMetrics } from "@/features/campaigns/manual-metrics-actions";
import { PROPOSAL_CONFLICT_MESSAGE, writeCampaignIfUnchanged } from "@/services/campaign-proposal-write";
import {
  evaluateApprovalDestination,
  resolveLegacyLandingCheck,
} from "@/services/destination-integrity";
import {
  PURCHASE_DESTINATION_KEY,
  buildDestinationSnapshot,
  buildPurchaseDestination,
  ownHostsFromProcessEnv,
  readStoredDestination,
  resolveOwnHostsFromEnv,
} from "@/lib/campaigns/purchase-destination";

export interface CampaignActionState {
  error: string | null;
}

export async function regenerateCampaignProposalAction(campaignId: string): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  // Role first (server-side, FIX-195-SERVER-AUTHORIZATION): before any read, AI call, quota use or write.
  if (!canEditCampaign(session.role)) {
    return { error: CAMPAIGN_EDIT_FORBIDDEN_MESSAGE };
  }
  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (campaignError || !campaign || !campaign.product_id) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa dibuat ulang. Batalkan pengajuan terlebih dahulu." };
  }

  const { data: product, error: productError } = await supabase
    .from("prompter_products")
    .select("*")
    .eq("id", campaign.product_id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (productError || !product) {
    return { error: "Produk terkait campaign ini tidak ditemukan." };
  }

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  const channelPerformanceHistory = await getTenantChannelPerformance(supabase, session.tenantId);

  const inputs = {
    objective: campaign.objective,
    channels: campaign.channels,
    targetCountry: campaign.target_country,
    targetRegion: campaign.target_region,
    targetCity: campaign.target_city,
    audienceNotes: campaign.audience_notes,
    dailyBudget: campaign.daily_budget,
    totalBudget: campaign.total_budget,
    currency: campaign.currency,
    channelPerformanceHistory,
  };

  // The purchase destination lives inside ai_proposal, which regenerate replaces wholesale:
  // read it from the existing proposal, tell the AI about it, and carry it over untouched.
  // Legacy campaigns (no key) stay legacy: nothing is added.
  const existingProposal = campaign.ai_proposal as Record<string, unknown> | null;
  const existingDestinationRaw = existingProposal?.[PURCHASE_DESTINATION_KEY];
  const storedDestination = readStoredDestination(
    existingProposal,
    resolveOwnHostsFromEnv({
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      META_REDIRECT_URI: process.env.META_REDIRECT_URI,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }),
  );
  const promptDestination =
    storedDestination.kind === "valid"
      ? {
          type: storedDestination.destination.type,
          host:
            storedDestination.destination.type === "WEBSITE" && storedDestination.destination.link
              ? new URL(storedDestination.destination.link).hostname
              : null,
        }
      : storedDestination.kind === "legacy"
        ? undefined
        : { type: "NONE" as const };

  const result = await runAiJob({
    supabase,
    tenantId: session.tenantId,
    actorUserId: session.userId,
    jobType: "CAMPAIGN_PROPOSAL",
    schema: CampaignProposalGenerationSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildCampaignProposalPrompt(product, inputs, promptDestination),
    inputReference: { product_id: product.id, campaign_id: campaignId, ...inputs },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const regenerated = withRecommendedChannels(withPrimaryCandidate(normalizeProposalAdditions(result.data)));
  const proposal =
    existingDestinationRaw === undefined || existingDestinationRaw === null
      ? regenerated
      : { ...regenerated, [PURCHASE_DESTINATION_KEY]: existingDestinationRaw };

  // The AI call takes seconds: write only if the campaign is still exactly as it was READ above (same
  // updated_at, still DRAFT). Otherwise the user's newer edit (e.g. the destination) would be overwritten.
  const written = await writeCampaignIfUnchanged(supabase, session.tenantId, campaignId, campaign.updated_at, {
    ai_proposal: proposal as unknown as Json,
    ai_job_id: result.jobId,
  });
  if (written === "conflict") return { error: PROPOSAL_CONFLICT_MESSAGE };
  if (written === "error") {
    return { error: "AI berhasil membuat proposal baru tapi gagal menyimpannya." };
  }

  // Regenerate keeps the campaign's existing channel set (campaign.channels)
  // — it refreshes copy/reasoning/budget-split within that set, same as
  // before Batch B2. Only Quick Promote's own generation lets the AI's
  // channel choice determine the campaign's channels.
  await syncChannelCampaigns(
    supabase,
    session.tenantId,
    campaignId,
    campaign.channels,
    proposal.budget_allocation,
  );

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null };
}

/**
 * "Gunakan Ini" (Batch B1 correction #1) — the Owner picks a different
 * already-generated candidate as the active recommendation. Reuses the
 * candidate data the same AI call already produced; never calls the AI
 * again and never creates a second campaign. selectCandidate() swaps the
 * chosen candidate into the primary position and moves hook/headline/cta/
 * primary_text together, so the ad copy never ends up describing one
 * angle while the headline promises another.
 */
export async function selectCampaignCandidateAction(
  campaignId: string,
  candidateIndex: number,
): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  // Role first (server-side, FIX-195-SERVER-AUTHORIZATION): before any read, AI call, quota use or write.
  if (!canEditCampaign(session.role)) {
    return { error: CAMPAIGN_EDIT_FORBIDDEN_MESSAGE };
  }
  const supabase = await createClient();

  const { data: campaign, error: fetchError } = await supabase
    .from("prompter_master_campaigns")
    .select("ai_proposal, status, updated_at")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (fetchError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa diedit." };
  }

  const currentProposal = campaign.ai_proposal as CampaignProposal | null;
  if (!currentProposal || !Array.isArray(currentProposal.candidates) || currentProposal.candidates.length < 2) {
    return { error: "Belum ada kandidat alternatif untuk campaign ini." };
  }

  const updatedProposal = selectCandidate(currentProposal, candidateIndex);

  const written = await writeCampaignIfUnchanged(supabase, session.tenantId, campaignId, campaign.updated_at, {
    ai_proposal: updatedProposal as unknown as Json,
  });
  if (written === "conflict") return { error: PROPOSAL_CONFLICT_MESSAGE };
  if (written === "error") {
    return { error: "Gagal menyimpan pilihan kandidat." };
  }

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null };
}

/**
 * Batch B4 — Media Workflow. "Gunakan"/"Ganti" on the campaign's own
 * Materi Promosi section (Review & Setujui step). Reuses
 * prompter_product_media as-is — no campaign-media table, no new upload
 * path — this only records which already-uploaded product media this
 * campaign wants as its promotional creative. `mediaId` must belong to
 * the same tenant AND the same product as the campaign, otherwise a user
 * could point one campaign at another product's (or tenant's) media.
 * Restricted to DRAFT, same rule every other campaign edit here follows.
 */
export async function selectCampaignMediaAction(
  campaignId: string,
  mediaId: string,
): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  if (!canEditCampaign(session.role)) return { error: CAMPAIGN_MEDIA_FORBIDDEN_MESSAGE };
  const supabase = await createClient();

  const { data: campaign, error: fetchError } = await supabase
    .from("prompter_master_campaigns")
    .select("status, product_id")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (fetchError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa diedit." };
  }

  const { data: media, error: mediaError } = await supabase
    .from("prompter_product_media")
    .select("id")
    .eq("id", mediaId)
    .eq("tenant_id", session.tenantId)
    .eq("product_id", campaign.product_id ?? "")
    .maybeSingle();

  if (mediaError || !media) {
    return { error: "Media tidak ditemukan untuk produk ini." };
  }

  // Conditional write: tenant-bound and only while still DRAFT. A campaign that was submitted between the read
  // above and this write matches zero rows and is reported, never silently changed.
  const { data: updatedRows, error: updateError } = await supabase
    .from("prompter_master_campaigns")
    .update({ selected_media_id: mediaId })
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "DRAFT")
    .select("id");

  if (updateError) {
    return { error: "Gagal menyimpan pilihan media." };
  }
  if (!Array.isArray(updatedRows) || updatedRows.length !== 1) {
    return { error: "Campaign baru saja berubah status atau tidak ditemukan, pilihan media tidak disimpan. Muat ulang halaman." };
  }

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null };
}

export async function updateCampaignCopyAction(
  campaignId: string,
  _prevState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  // Role first (server-side, FIX-195-SERVER-AUTHORIZATION): before any read, AI call, quota use or write.
  if (!canEditCampaign(session.role)) {
    return { error: CAMPAIGN_EDIT_FORBIDDEN_MESSAGE };
  }
  const supabase = await createClient();

  const headline = formData.get("headline");
  const primaryText = formData.get("primaryText");
  const cta = formData.get("cta");
  const hook = formData.get("hook");

  const { data: campaign, error: fetchError } = await supabase
    .from("prompter_master_campaigns")
    .select("ai_proposal, status, updated_at")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (fetchError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa diedit." };
  }

  // A null or non-object stored proposal (never spread: a string/array would leak index keys) starts from {}, so the
  // editor can recover a campaign whose proposal is missing or malformed.
  const currentProposal = (
    campaign.ai_proposal !== null && typeof campaign.ai_proposal === "object" && !Array.isArray(campaign.ai_proposal)
      ? campaign.ai_proposal
      : {}
  ) as Record<string, Json>;

  // Server-side length guard. The editor's HTML maxLength is only a convenience: a crafted request could store
  // copy the proposal schema rejects, which would make the submit gate fall back to a partial scan.
  const lengthViolations = findCopyLengthViolations({
    hook: typeof hook === "string" ? hook : undefined,
    headline: typeof headline === "string" ? headline : undefined,
    primary_text: typeof primaryText === "string" ? primaryText : undefined,
    cta: typeof cta === "string" ? cta : undefined,
  });
  if (lengthViolations.length > 0) {
    return { error: `Teks melebihi batas panjang (${lengthViolations.join(", ")}). Persingkat lalu simpan lagi.` };
  }

  const updatedProposal: Record<string, Json> = {
    ...currentProposal,
    hook: typeof hook === "string" ? hook : currentProposal.hook,
    headline: typeof headline === "string" ? headline : currentProposal.headline,
    primary_text: typeof primaryText === "string" ? primaryText : currentProposal.primary_text,
    cta: typeof cta === "string" ? cta : currentProposal.cta,
  };

  const written = await writeCampaignIfUnchanged(supabase, session.tenantId, campaignId, campaign.updated_at, {
    ai_proposal: updatedProposal,
  });
  if (written === "conflict") return { error: PROPOSAL_CONFLICT_MESSAGE };
  if (written === "error") {
    return { error: "Gagal menyimpan perubahan." };
  }

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null };
}

/**
 * Batch B3 — Smart Scheduling, on the Golden Path's own Review Campaign
 * step (not a separate menu). Sets or clears a single channel's schedule
 * on the same `prompter_channel_campaigns` row B2 already uses for
 * per-channel selection/budget — no parallel table. Restricted to DRAFT
 * campaigns, same as `updateCampaignCopyAction`: once submitted for
 * approval, the reviewed schedule shouldn't shift under the Owner mid-review.
 *
 * `scheduledAt` is a naive `datetime-local` wall-clock string, interpreted
 * as the tenant's own configured timezone
 * (`prompter_brand_profiles.default_timezone`) before being converted to
 * the real UTC instant stored — same rule `scheduleContentAction` follows
 * for content items.
 */
export async function scheduleChannelCampaignAction(
  channelCampaignId: string,
  _prevState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const scheduledAtRaw = formData.get("scheduledAt");
  const localValue = typeof scheduledAtRaw === "string" ? scheduledAtRaw.trim() : "";

  const session = await requireSessionContext();
  if (!canEditCampaign(session.role)) return { error: CAMPAIGN_SCHEDULE_FORBIDDEN_MESSAGE };
  const supabase = await createClient();

  const { data: channelCampaign, error: fetchError } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, master_campaign_id")
    .eq("id", channelCampaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (fetchError || !channelCampaign) {
    return { error: "Channel campaign tidak ditemukan." };
  }

  const { data: masterCampaign } = await supabase
    .from("prompter_master_campaigns")
    .select("status")
    .eq("id", channelCampaign.master_campaign_id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (!masterCampaign || masterCampaign.status !== "DRAFT") {
    return { error: "Campaign yang sudah diajukan tidak bisa diedit." };
  }

  let scheduledAt: string | null = null;
  if (localValue) {
    const { data: brandProfile } = await supabase
      .from("prompter_brand_profiles")
      .select("default_timezone")
      .eq("tenant_id", session.tenantId)
      .maybeSingle();
    const timeZone = brandProfile?.default_timezone ?? "Asia/Jakarta";

    const parsed = parseLocalDateTimeInZone(localValue, timeZone);
    if (!parsed) {
      return { error: "Format tanggal/jam tidak valid." };
    }
    scheduledAt = parsed.toISOString();
  }

  // Lifecycle guard on the write itself: tenant-bound and only while the channel row is still DRAFT (submit moves
  // it to AWAITING_APPROVAL, launch claims it later). Zero matched rows is reported, not hidden.
  const { data: scheduledRows, error: updateError } = await supabase
    .from("prompter_channel_campaigns")
    .update({ scheduled_at: scheduledAt })
    .eq("id", channelCampaignId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "DRAFT")
    .select("id");

  if (updateError) {
    return { error: "Gagal menyimpan jadwal channel." };
  }
  if (!Array.isArray(scheduledRows) || scheduledRows.length !== 1) {
    return { error: "Channel campaign baru saja berubah status, jadwal tidak disimpan. Muat ulang halaman." };
  }

  revalidatePath(`/campaigns/${channelCampaign.master_campaign_id}`);
  return { error: null };
}

/**
 * Deletes a DRAFT campaign. OWNER ONLY, checked here before any read or write (RLS alone would also let marketing
 * delete). Returns an honest result instead of redirecting silently: the client shows the error or navigates away.
 *
 * What is and is not removed (from the schema, see docs in the PR):
 *  - removed by cascade: the campaign's channel rows and optimization recommendations; a DRAFT campaign has never
 *    been launched, so it must have no performance or spend rows. If ANY marketing/manual metric row exists the
 *    delete is REFUSED (those would cascade away), and so it is if that check cannot be read (fail closed).
 *  - kept: audit logs (append-only, no FK), approval rows (no FK; PENDING ones are first marked EXPIRED so the
 *    queue shows nothing orphaned), AI job rows (FK set null), content items (set null).
 *  - a "campaign.deleted" audit row is written after a confirmed delete.
 */
export async function deleteCampaignAction(campaignId: string): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  if (!canDeleteCampaign(session.role)) return { error: CAMPAIGN_DELETE_FORBIDDEN_MESSAGE };
  if (typeof campaignId !== "string" || campaignId.length === 0) return { error: "Campaign tidak ditemukan." };
  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, status")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (campaignError) return { error: "Campaign tidak dapat diperiksa. Tidak ada yang dihapus, coba lagi." };
  if (!campaign) return { error: "Campaign tidak ditemukan." };
  if (campaign.status !== "DRAFT") {
    return { error: "Hanya campaign berstatus Draft yang bisa dihapus. Batalkan pengajuan terlebih dahulu bila perlu." };
  }

  const { data: metricRows, error: metricsError } = await supabase
    .from("prompter_marketing_metrics")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("master_campaign_id", campaignId)
    .limit(1);
  // Manual metrics live behind their own module (they are kept apart from this file on purpose).
  const manual = await campaignHasManualMetrics(campaignId);
  if (metricsError || !Array.isArray(metricRows) || manual === "unreadable") {
    return { error: "Data performa campaign tidak dapat diperiksa. Tidak ada yang dihapus, coba lagi." };
  }
  if (metricRows.length > 0 || manual === "yes") {
    return { error: "Campaign ini memiliki data performa atau pengeluaran iklan, sehingga tidak bisa dihapus." };
  }

  // Mark any PENDING approval of this campaign EXPIRED first (owner-only UPDATE under RLS): nothing is left
  // waiting for a decision on a campaign that no longer exists. Approval rows themselves are kept.
  const { data: pending, error: pendingError } = await supabase
    .from("prompter_approvals")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("resource_type", "prompter_master_campaigns")
    .eq("resource_id", campaignId)
    .eq("status", "PENDING");
  if (pendingError || !Array.isArray(pending)) return { error: "Persetujuan campaign tidak dapat diperiksa. Tidak ada yang dihapus, coba lagi." };
  if (pending.length > 0) {
    const { data: expired, error: expireError } = await supabase
      .from("prompter_approvals")
      .update({ status: "EXPIRED" })
      .eq("tenant_id", session.tenantId)
      .eq("resource_type", "prompter_master_campaigns")
      .eq("resource_id", campaignId)
      .eq("status", "PENDING")
      .select("id");
    if (expireError || !Array.isArray(expired) || expired.length !== pending.length) {
      return { error: "Persetujuan yang menunggu tidak dapat ditutup. Tidak ada yang dihapus, coba lagi." };
    }
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("prompter_master_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "DRAFT")
    .select("id");
  if (deleteError) return { error: "Gagal menghapus campaign. Muat ulang halaman dan periksa statusnya." };
  if (!Array.isArray(deleted) || deleted.length !== 1) {
    return { error: "Campaign baru saja berubah status atau sudah dihapus, tidak ada yang dihapus. Muat ulang halaman." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "campaign.deleted",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    context: {},
  });

  revalidatePath("/campaigns");
  return { error: null };
}

/** Reason codes fn_reserve_active_campaign_slot() (Batch B9) can return,
 * mapped to Indonesian copy. */
function describeCampaignReservationBlock(reason: string | null): string {
  switch (reason) {
    case "CAMPAIGN_LIMIT_REACHED":
      return "Campaign tidak dapat diajukan karena sudah mencapai batas jumlah campaign aktif paket Anda. Selesaikan atau hentikan campaign lain, atau upgrade paket.";
    case "INVALID_STATE":
      return "Campaign ini sudah diajukan sebelumnya.";
    case "NOT_FOUND":
    case "NO_TENANT":
      return "Campaign tidak ditemukan.";
    default:
      return "Gagal mengajukan campaign untuk persetujuan.";
  }
}

/**
 * Budget Guard gate + Approval Center handoff (product spec §15 step 9,
 * §38-39). A campaign whose budget exceeds the tenant's policy is rejected
 * outright — see services/budget-guard.ts. Otherwise a CAMPAIGN_LAUNCH
 * approval request is created and the campaign moves to
 * AWAITING_APPROVAL. Nothing here ever sets status to ACTIVE — that only
 * happens once a real connector (Phase 3+) confirms the campaign is live.
 *
 * Batch B9 P0-1/P2-2: DRAFT -> AWAITING_APPROVAL is the only transition in
 * the app that starts consuming a plan's maxActiveCampaigns slot (Audit 4's
 * canonical "active campaign" set: ACTIVE/SCHEDULED/AWAITING_APPROVAL/
 * PAUSED), so fn_reserve_active_campaign_slot() atomically re-checks the
 * campaign is still DRAFT, counts the tenant's current consuming
 * campaigns, and performs the status update in one DB transaction —
 * closing the same check-then-act race class as the AI usage cap.
 */
export async function submitForApprovalAction(campaignId: string): Promise<CampaignActionState> {
  const session = await requireSessionContext();
  if (!canEditCampaign(session.role)) return { error: CAMPAIGN_SUBMIT_FORBIDDEN_MESSAGE };
  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, status, daily_budget, total_budget, duration_days, currency, ai_proposal, product_id")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (campaignError || !campaign) {
    return { error: "Campaign tidak ditemukan." };
  }

  if (campaign.status !== "DRAFT") {
    return { error: "Campaign ini sudah diajukan sebelumnya." };
  }

  // What the owner is approving: the destination exactly as it is NOW. The launch compares the
  // campaign's current destination with this snapshot and refuses on any difference.
  // A legacy campaign (no stored destination) uses the product/brand landing URL: that URL is resolved and
  // validated on the server NOW and recorded, so changing the product/brand URL later needs a new approval.
  const submitOwnHosts = ownHostsFromProcessEnv();
  let legacyLandingUrl: string | null = null;
  if (readStoredDestination(campaign.ai_proposal, submitOwnHosts).kind === "legacy") {
    const resolved = await resolveLegacyLandingCheck(
      supabase,
      session.tenantId,
      campaign.product_id,
      submitOwnHosts ?? [],
    );
    if (resolved.ok) legacyLandingUrl = resolved.value;
    else if (resolved.code === "PREFLIGHT_READ_FAILED") {
      return { error: "Gagal membaca tujuan iklan. Pengajuan tidak dibuat, coba lagi." };
    }
  }
  const destinationSnapshot = buildDestinationSnapshot(campaign.ai_proposal, submitOwnHosts, legacyLandingUrl);

  const policy = await getOrCreateBudgetPolicy(supabase, session.tenantId);
  const monthToDateSpend = await getMonthToDateSpend(supabase, session.tenantId);
  const guardResult = checkBudgetGuard(policy, {
    dailyBudget: campaign.daily_budget,
    totalBudget: campaign.total_budget,
    campaignCurrency: campaign.currency,
    monthToDateSpend,
  });

  if (!guardResult.allowed) {
    return { error: guardResult.reason };
  }

  // Same per-campaign cap rule the launch re-checks: a campaign without a total budget
  // is never asked of the Owner when its spend could not be bounded by the cap.
  const campaignLimit = checkCampaignLimitCoverage({
    campaignLimit: policy.campaign_limit,
    dailyBudget: campaign.daily_budget,
    totalBudget: campaign.total_budget,
    durationDays: campaign.duration_days,
  });
  if (!campaignLimit.ok) {
    return { error: campaignLimit.message };
  }

  // Quality Gate, enforced on the server (PR-5) by the SAME validator the launch uses (lib/campaigns/copy-guard.ts):
  // required active copy, length limits and the full Quality Gate (or, for a proposal the schema does not accept,
  // the reduced check, which is NOT a gate pass). Nothing has been written yet, so a refusal leaves no approval
  // row and no status change. Only the ACTIVE copy (headline, primary_text, cta, hook) is enforced; the page still
  // shows findings for every candidate as advice.
  const copyGuard = await evaluateCopyGuard(campaign.ai_proposal, {
    action: "SUBMIT",
    loadContext: () => readCopyGuardContext(supabase, session.tenantId, campaign.product_id),
  });
  if (!copyGuard.ok) {
    return { error: copyGuard.message };
  }
  // The copy the Owner is approving, recorded in the approval so the launch can refuse a different copy.
  const copySnapshot = buildCopySnapshot(campaign.ai_proposal);

  // Budget allocation across channels, checked with the launch's own rules BEFORE an approval exists (F-01): a
  // split that the launch would refuse (missing/invalid share, not adding up to 100%, paid channel at 0%) must not
  // reach the Owner. A read failure refuses too (fail closed).
  const allocationRows = await readChannelAllocationRows(supabase, session.tenantId, campaignId);
  if (!allocationRows.ok) {
    return { error: "Gagal membaca alokasi budget channel. Pengajuan tidak dibuat, coba lagi." };
  }
  const allocationCheck = checkChannelAllocation(allocationRows.rows);
  if (!allocationCheck.ok) {
    return { error: allocationCheck.error };
  }

  const { error: approvalError } = await supabase.from("prompter_approvals").insert({
    tenant_id: session.tenantId,
    approval_type: "CAMPAIGN_LAUNCH",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    requested_by: session.userId,
    context: {
      daily_budget: campaign.daily_budget,
      total_budget: campaign.total_budget,
      // Snapshot of the Owner's approval threshold at submission time (audit only;
      // the launch re-reads the live policy). See lib/campaigns/approval-threshold.ts.
      approval_threshold: {
        require_approval_above: policy.require_approval_above,
        above_threshold: evaluateApprovalThreshold({
          threshold: policy.require_approval_above,
          dailyBudget: campaign.daily_budget,
          totalBudget: campaign.total_budget,
        }).required,
      },
      destination_snapshot: destinationSnapshot,
      // Fingerprint of the active copy being approved; the launch refuses a different copy (FIX-195-LAUNCH-GUARD).
      [COPY_SNAPSHOT_KEY]: copySnapshot,
    } as unknown as Json,
  });

  if (approvalError) {
    return { error: "Gagal mengajukan campaign untuk persetujuan." };
  }

  const { data: reservationRows, error: reservationError } = await supabase.rpc(
    "fn_reserve_active_campaign_slot",
    { p_campaign_id: campaignId },
  );
  const reservationRow = (Array.isArray(reservationRows) ? reservationRows[0] : reservationRows) as
    | { allowed: boolean; reason: string | null }
    | undefined;

  if (reservationError || !reservationRow?.allowed) {
    // The cap check failed after the approval row was already created —
    // remove it so no PENDING approval is left pointing at a campaign that
    // never actually left DRAFT.
    await supabase
      .from("prompter_approvals")
      .delete()
      .eq("tenant_id", session.tenantId)
      .eq("resource_type", "prompter_master_campaigns")
      .eq("resource_id", campaignId)
      .eq("status", "PENDING");
    return { error: describeCampaignReservationBlock(reservationRow?.reason ?? null) };
  }

  // Mirror onto the channel rows: tenant-scoped and only DRAFT -> AWAITING_APPROVAL.
  // A channel in any other state (e.g. a claimed/launched one) is never rewritten.
  const mirrored = await mirrorChannelCampaignStatus(supabase, session.tenantId, campaignId, "SUBMIT");
  if (!isMirrorConfirmed(mirrored)) {
    revalidatePath(`/campaigns/${campaignId}`);
    return {
      error:
        "Pengajuan BELUM selesai: status campaign sudah berubah tetapi status channel tidak terkonfirmasi sinkron. Gunakan Batalkan Pengajuan lalu ajukan ulang, atau hubungi admin.",
    };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "campaign.submitted_for_approval",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    context: { daily_budget: campaign.daily_budget, total_budget: campaign.total_budget },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/approvals");
  return { error: null };
}

/** Reverts a not-yet-decided submission back to DRAFT and expires the request. */
export async function cancelSubmissionAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  const session = await requireSessionContext();
  // Owner only, enforced on the server (the button is also Owner-only). Production RLS lets only the Owner
  // update an approval, so any other role would leave a PENDING approval behind. Refused before any read/write.
  if (session.role !== "owner") return;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("prompter_master_campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "AWAITING_APPROVAL")
    .maybeSingle();

  if (!campaign) {
    return;
  }

  // Expire the PENDING approvals FIRST and verify the row count (RLS makes a refused update match 0 rows
  // without an error). If that fails nothing else changes: the campaign stays AWAITING_APPROVAL (still
  // visible as not cancelled, never reported as success) and can be cancelled again.
  const PENDING: ApprovalStatus[] = ["PENDING"];
  const { data: pending, error: pendingError } = await supabase
    .from("prompter_approvals")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("resource_type", "prompter_master_campaigns")
    .eq("resource_id", campaignId)
    .in("status", PENDING);
  if (pendingError || !Array.isArray(pending)) {
    revalidatePath(`/campaigns/${campaignId}`);
    return;
  }
  if (pending.length > 0) {
    const { data: expired, error: expireError } = await supabase
      .from("prompter_approvals")
      .update({ status: "EXPIRED" })
      .eq("tenant_id", session.tenantId)
      .eq("resource_type", "prompter_master_campaigns")
      .eq("resource_id", campaignId)
      .in("status", PENDING)
      .select("id");
    if (expireError || !Array.isArray(expired) || expired.length !== pending.length) {
      revalidatePath(`/campaigns/${campaignId}`);
      return;
    }
  }

  // Conditional on AWAITING_APPROVAL and exactly one row. Losing a race changes NOTHING else (an expired
  // approval can never launch, so this is fail-closed).
  const reverted = await transitionMasterCampaign(supabase, session.tenantId, campaignId, "CANCEL");
  if (reverted !== "moved") {
    revalidatePath(`/campaigns/${campaignId}`);
    return;
  }
  await mirrorChannelCampaignStatus(supabase, session.tenantId, campaignId, "CANCEL");

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/approvals");
}


export interface DestinationEditState {
  error: string | null;
  saved: boolean;
}

/**
 * Changes where a campaign's ad sends buyers. Owner/marketing only, DRAFT only, tenant scoped, validated
 * on the server (same rules as creation). A campaign that is awaiting approval, scheduled or later is never
 * edited here: the owner must cancel the submission first, so a destination can never change behind an
 * approval. Only the purchase_destination key inside ai_proposal is written; products and the brand profile
 * are never touched.
 */
export async function updateCampaignDestinationAction(
  campaignId: string,
  _prevState: DestinationEditState,
  formData: FormData,
): Promise<DestinationEditState> {
  const session = await requireSessionContext();

  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Hanya Owner atau Marketing yang dapat mengubah tujuan iklan.", saved: false };
  }

  const rawType = formData.get("destinationType");
  const rawValue = formData.get("destinationValue");
  const built = buildPurchaseDestination(
    { type: typeof rawType === "string" ? rawType : "", value: typeof rawValue === "string" ? rawValue.trim() : "" },
    ownHostsFromProcessEnv(),
  );
  if (!built.ok) return { error: built.message, saved: false };

  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, status, ai_proposal, updated_at")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (campaignError || !campaign) {
    return { error: "Campaign tidak ditemukan.", saved: false };
  }

  if (campaign.status !== "DRAFT") {
    return {
      error: "Tujuan iklan hanya bisa diubah saat campaign berstatus Draft. Batalkan pengajuan terlebih dahulu.",
      saved: false,
    };
  }

  const current = campaign.ai_proposal;
  if (current === null || typeof current !== "object" || Array.isArray(current)) {
    return { error: "Campaign ini belum punya proposal AI, sehingga tujuan belum bisa diatur.", saved: false };
  }

  // A submission writes its approval row before the status flips: refuse while one is pending so an edit
  // cannot slip between the snapshot and the status change.
  const { data: pending, error: pendingError } = await supabase
    .from("prompter_approvals")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("resource_type", "prompter_master_campaigns")
    .eq("resource_id", campaignId)
    .eq("status", "PENDING")
    .limit(1);
  if (pendingError) {
    return { error: "Gagal memeriksa status pengajuan. Tujuan tidak diubah, coba lagi.", saved: false };
  }
  if (pending && pending.length > 0) {
    return { error:
        "Masih ada persetujuan yang menunggu untuk campaign ini. Batalkan pengajuan (Owner) atau minta Owner menolak/memutuskannya di Pusat Persetujuan, lalu ubah tujuan iklan.", saved: false };
  }

  const previous = readStoredDestination(current, ownHostsFromProcessEnv());
  const next = { ...(current as Record<string, Json>), [PURCHASE_DESTINATION_KEY]: built.value as unknown as Json };

  const written = await writeCampaignIfUnchanged(supabase, session.tenantId, campaignId, campaign.updated_at, {
    ai_proposal: next,
  });
  if (written === "conflict") return { error: PROPOSAL_CONFLICT_MESSAGE, saved: false };
  if (written === "error") {
    return { error: "Tujuan iklan tidak berhasil disimpan. Muat ulang halaman lalu coba lagi.", saved: false };
  }

  // The audit trail records the kind of change only: never the URL or the phone number.
  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "campaign.destination_updated",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    context: {
      from: previous.kind === "valid" ? previous.destination.type : previous.kind,
      to: built.value.type,
    },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  return { error: null, saved: true };
}


export interface RecoverState {
  error: string | null;
  done: boolean;
}

/**
 * Returns a BLOCKED, never-launched SCHEDULED campaign to DRAFT so it can be fixed and re-approved.
 *
 * A campaign is "blocked" when its destination is unlaunchable or does not match what its latest approval
 * recorded (this includes every approval that predates destination snapshots). The recovery:
 *  - is Owner only (server side), tenant scoped, and refuses anything that is not SCHEDULED, whose channels are
 *    not ALL still SCHEDULED with no external id, or that has any recorded ad metrics (no spend activity);
 *  - refuses a campaign that is not blocked (nothing to recover);
 *  - moves the channel rows first and the master second, each as a conditional UPDATE (see
 *    services/channel-campaigns.ts), so a concurrent launch claim and the recovery can never both win a
 *    row; if any step cannot be confirmed the rows it moved are put back and nothing is reported as done;
 *  - FIRST marks every old approval of the campaign EXPIRED and requires the database to confirm exactly
 *    that many rows; if it cannot, NOTHING else is changed and the failure is reported (a blocked campaign
 *    is already unlaunchable, so expiring first can never open a launch). No approval, audit or campaign
 *    row is deleted.
 */
export async function recoverBlockedScheduledCampaignAction(
  campaignId: string,
  _prevState: RecoverState,
  _formData: FormData,
): Promise<RecoverState> {
  void _prevState;
  void _formData;
  const session = await requireSessionContext();

  // Owner only. The old approvals must be marked EXPIRED, and the database lets only the Owner update an
  // approval (RLS "Owner memutuskan approval"): for any other role that step silently changes zero rows.
  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengembalikan campaign ke Draft.", done: false };
  }

  const supabase = await createClient();

  const { data: master, error: masterError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, status, product_id, ai_proposal")
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .single();
  if (masterError || !master) return { error: "Campaign tidak ditemukan.", done: false };
  if (master.status !== "SCHEDULED") {
    return {
      error: "Hanya campaign berstatus Terjadwal yang belum pernah diluncurkan yang bisa dikembalikan ke Draft.",
      done: false,
    };
  }

  const channels = await readChannelRowsForRecovery(supabase, session.tenantId, campaignId);
  if (!channels.ok) return { error: "Status channel tidak dapat diperiksa. Tidak ada perubahan, coba lagi.", done: false };
  if (
    channels.rows.length === 0 ||
    channels.rows.some((r) => r.status !== "SCHEDULED" || r.external_campaign_id !== null)
  ) {
    return {
      error:
        "Campaign ini sudah pernah diluncurkan atau sedang diproses di platform iklan, sehingga tidak bisa dikembalikan ke Draft.",
      done: false,
    };
  }

  // Any recorded ad activity (platform metrics or manually entered spend) means money may have moved.
  const { data: platformActivity, error: platformError } = await supabase
    .from("prompter_marketing_metrics")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("master_campaign_id", campaignId)
    .limit(1);
  const manualActivity = await campaignHasManualAdMetrics(campaignId);
  if (platformError || manualActivity === null) {
    return { error: "Aktivitas iklan tidak dapat diperiksa. Tidak ada perubahan, coba lagi.", done: false };
  }
  if ((platformActivity?.length ?? 0) > 0 || manualActivity) {
    return {
      error: "Campaign ini sudah memiliki data performa atau pengeluaran iklan, sehingga tidak bisa dikembalikan ke Draft.",
      done: false,
    };
  }

  // Only a BLOCKED campaign is recoverable: latest approval must be APPROVED AND match the destination.
  const { data: approvalRows, error: approvalError } = await supabase
    .from("prompter_approvals")
    .select("status, created_at, context")
    .eq("tenant_id", session.tenantId)
    .eq("approval_type", "CAMPAIGN_LAUNCH")
    .eq("resource_type", "prompter_master_campaigns")
    .eq("resource_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (approvalError) return { error: "Persetujuan tidak dapat diperiksa. Tidak ada perubahan, coba lagi.", done: false };
  const latest = [...(approvalRows ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

  if (latest && latest.status === "APPROVED") {
    const integrity = await evaluateApprovalDestination({
      supabase,
      tenantId: session.tenantId,
      productId: master.product_id,
      aiProposal: master.ai_proposal,
      approvalContext: latest.context,
      ownHosts: ownHostsFromProcessEnv(),
      requireLaunchable: true,
    });
    if (integrity.ok) {
      return {
        error: "Campaign ini tidak terblokir: tujuan iklan sesuai dengan yang disetujui. Tidak perlu dikembalikan ke Draft.",
        done: false,
      };
    }
    if (integrity.reason === "read_failed") return { error: integrity.message, done: false };
  }

  // 0) every old approval (APPROVED, or a stray PENDING) must be declared void, confirmed by the database,
  //    BEFORE anything else changes. On any doubt nothing else is touched and the campaign stays blocked.
  const OLD_APPROVALS: ApprovalStatus[] = ["APPROVED", "PENDING"];
  const { data: oldApprovals, error: oldApprovalsError } = await supabase
    .from("prompter_approvals")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("approval_type", "CAMPAIGN_LAUNCH")
    .eq("resource_type", "prompter_master_campaigns")
    .eq("resource_id", campaignId)
    .in("status", OLD_APPROVALS);
  if (oldApprovalsError || !Array.isArray(oldApprovals)) {
    return { error: "Persetujuan lama tidak dapat diperiksa. Tidak ada perubahan, coba lagi.", done: false };
  }
  let approvalsExpired = 0;
  if (oldApprovals.length > 0) {
    const { data: expired, error: expireError } = await supabase
      .from("prompter_approvals")
      .update({ status: "EXPIRED" })
      .eq("tenant_id", session.tenantId)
      .eq("approval_type", "CAMPAIGN_LAUNCH")
      .eq("resource_type", "prompter_master_campaigns")
      .eq("resource_id", campaignId)
      .in("status", OLD_APPROVALS)
      .select("id");
    if (expireError || !Array.isArray(expired) || expired.length !== oldApprovals.length) {
      revalidatePath(`/campaigns/${campaignId}`);
      return {
        error:
          "Pemulihan DIBATALKAN: persetujuan lama tidak berhasil ditandai kedaluwarsa. Status campaign tidak diubah dan campaign tetap tidak bisa diluncurkan. Muat ulang halaman dan coba lagi sebagai Owner; jika terus gagal, hubungi admin.",
        done: false,
      };
    }
    approvalsExpired = expired.length;
  }

  // 1) channels first (exclusive with the launch claim, row by row)
  const movedChannels = await moveChannelCampaignsScheduledToDraft(supabase, session.tenantId, campaignId);
  if (!movedChannels.ok || movedChannels.ids.length !== channels.rows.length) {
    const restored = await restoreChannelCampaignsToScheduled(supabase, session.tenantId, campaignId, movedChannels.ids);
    revalidatePath(`/campaigns/${campaignId}`);
    return {
      error: restored
        ? "Campaign baru saja berubah atau sedang diluncurkan oleh proses lain. Status campaign tidak diubah (persetujuan lama sudah dinyatakan kedaluwarsa, jadi campaign tetap tidak bisa diluncurkan). Muat ulang halaman lalu coba lagi."
        : "Perubahan tidak dapat diselesaikan dan status channel mungkin tidak konsisten. Jangan meluncurkan. Hubungi admin untuk pemeriksaan.",
      done: false,
    };
  }

  // 2) then the master
  const masterOutcome = await transitionMasterScheduledToDraft(supabase, session.tenantId, campaignId);
  if (masterOutcome !== "moved") {
    const restored = await restoreChannelCampaignsToScheduled(supabase, session.tenantId, campaignId, movedChannels.ids);
    revalidatePath(`/campaigns/${campaignId}`);
    return {
      error: restored
        ? "Status campaign berubah saat dipulihkan dan tidak diubah (persetujuan lama sudah dinyatakan kedaluwarsa, jadi campaign tetap tidak bisa diluncurkan). Muat ulang halaman lalu coba lagi."
        : "Status campaign tidak dapat dipastikan dan channel mungkin tidak konsisten. Jangan meluncurkan. Hubungi admin untuk pemeriksaan.",
      done: false,
    };
  }

  const { error: auditError } = await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "campaign.recovered_to_draft",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    context: { approvals_expired: approvalsExpired },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  revalidatePath("/approvals");
  if (auditError) {
    return {
      error:
        "Campaign sudah dikembalikan ke Draft dan persetujuan lama sudah kedaluwarsa, tetapi catatan audit gagal ditulis. Beri tahu admin.",
      done: true,
    };
  }
  return { error: null, done: true };
}
