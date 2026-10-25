"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import {
  CampaignProposalSchema,
  withPrimaryCandidate,
  withRecommendedChannels,
  selectCandidate,
  type CampaignProposal,
} from "@/schemas/ai/campaign-proposal";
import { buildSystemPreamble, buildCampaignProposalPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import {
  syncChannelCampaigns,
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
import { parseLocalDateTimeInZone } from "@/lib/scheduling/recommend-time";
import type { Json } from "@/types/database";
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
    schema: CampaignProposalSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildCampaignProposalPrompt(product, inputs, promptDestination),
    inputReference: { product_id: product.id, campaign_id: campaignId, ...inputs },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const regenerated = withRecommendedChannels(withPrimaryCandidate(result.data));
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

  const { error: updateError } = await supabase
    .from("prompter_master_campaigns")
    .update({ selected_media_id: mediaId })
    .eq("id", campaignId);

  if (updateError) {
    return { error: "Gagal menyimpan pilihan media." };
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

  const currentProposal = (campaign.ai_proposal ?? {}) as Record<string, Json>;

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

  const { error: updateError } = await supabase
    .from("prompter_channel_campaigns")
    .update({ scheduled_at: scheduledAt })
    .eq("id", channelCampaignId);

  if (updateError) {
    return { error: "Gagal menyimpan jadwal channel." };
  }

  revalidatePath(`/campaigns/${channelCampaign.master_campaign_id}`);
  return { error: null };
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  const session = await requireSessionContext();
  const supabase = await createClient();

  await supabase
    .from("prompter_master_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "DRAFT");

  revalidatePath("/campaigns");
  redirect("/campaigns");
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
  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("prompter_master_campaigns")
    .select("id, status, daily_budget, total_budget, currency, ai_proposal, product_id")
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

  const { error: approvalError } = await supabase.from("prompter_approvals").insert({
    tenant_id: session.tenantId,
    approval_type: "CAMPAIGN_LAUNCH",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    requested_by: session.userId,
    context: {
      daily_budget: campaign.daily_budget,
      total_budget: campaign.total_budget,
      destination_snapshot: destinationSnapshot,
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

  // Conditional on AWAITING_APPROVAL and exactly one row. Losing a race (the
  // campaign was approved or changed meanwhile) changes NOTHING else.
  const reverted = await transitionMasterCampaign(supabase, session.tenantId, campaignId, "CANCEL");
  if (reverted !== "moved") {
    revalidatePath(`/campaigns/${campaignId}`);
    return;
  }
  await mirrorChannelCampaignStatus(supabase, session.tenantId, campaignId, "CANCEL");

  await supabase
    .from("prompter_approvals")
    .update({ status: "EXPIRED" })
    .eq("tenant_id", session.tenantId)
    .eq("resource_type", "prompter_master_campaigns")
    .eq("resource_id", campaignId)
    .eq("status", "PENDING");

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
    return { error: "Campaign sedang diajukan. Batalkan pengajuan sebelum mengubah tujuan iklan.", saved: false };
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
 *  - is owner/marketing only, tenant scoped, and refuses anything that is not SCHEDULED, whose channels are
 *    not ALL still SCHEDULED with no external id, or that has any recorded ad metrics (no spend activity);
 *  - refuses a campaign that is not blocked (nothing to recover);
 *  - moves the channel rows first and the master second, each as a conditional UPDATE (see
 *    services/channel-campaigns.ts), so a concurrent launch claim and the recovery can never both win a
 *    row; if any step cannot be confirmed the rows it moved are put back and nothing is reported as done;
 *  - then marks the old approvals EXPIRED (best effort: the approval table is owner-writable, and a newer
 *    submission is always the "latest" approval the launch looks at, so an old APPROVED row can never
 *    authorise a launch again). No approval, audit or campaign row is deleted.
 */
export async function recoverBlockedScheduledCampaignAction(
  campaignId: string,
  _prevState: RecoverState,
  _formData: FormData,
): Promise<RecoverState> {
  void _prevState;
  void _formData;
  const session = await requireSessionContext();

  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Hanya Owner atau Marketing yang dapat mengembalikan campaign ke Draft.", done: false };
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
  const [platformActivity, manualActivity] = await Promise.all([
    supabase
      .from("prompter_marketing_metrics")
      .select("id")
      .eq("tenant_id", session.tenantId)
      .eq("master_campaign_id", campaignId)
      .limit(1),
    supabase
      .from("prompter_manual_ad_metrics")
      .select("id")
      .eq("tenant_id", session.tenantId)
      .eq("master_campaign_id", campaignId)
      .limit(1),
  ]);
  if (platformActivity.error || manualActivity.error) {
    return { error: "Aktivitas iklan tidak dapat diperiksa. Tidak ada perubahan, coba lagi.", done: false };
  }
  if ((platformActivity.data?.length ?? 0) > 0 || (manualActivity.data?.length ?? 0) > 0) {
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

  // 1) channels first (exclusive with the launch claim, row by row)
  const movedChannels = await moveChannelCampaignsScheduledToDraft(supabase, session.tenantId, campaignId);
  if (!movedChannels.ok || movedChannels.ids.length !== channels.rows.length) {
    const restored = await restoreChannelCampaignsToScheduled(supabase, session.tenantId, campaignId, movedChannels.ids);
    revalidatePath(`/campaigns/${campaignId}`);
    return {
      error: restored
        ? "Campaign baru saja berubah atau sedang diluncurkan oleh proses lain. Tidak ada perubahan yang disimpan. Muat ulang halaman."
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
        ? "Status campaign berubah saat dipulihkan. Tidak ada perubahan yang disimpan. Muat ulang halaman."
        : "Status campaign tidak dapat dipastikan dan channel mungkin tidak konsisten. Jangan meluncurkan. Hubungi admin untuk pemeriksaan.",
      done: false,
    };
  }

  // 3) old approvals are no longer valid (nothing is deleted)
  const { data: expired } = await supabase
    .from("prompter_approvals")
    .update({ status: "EXPIRED" })
    .eq("tenant_id", session.tenantId)
    .eq("approval_type", "CAMPAIGN_LAUNCH")
    .eq("resource_type", "prompter_master_campaigns")
    .eq("resource_id", campaignId)
    .eq("status", "APPROVED")
    .select("id");

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "campaign.recovered_to_draft",
    resource_type: "prompter_master_campaigns",
    resource_id: campaignId,
    context: { approvals_expired: Array.isArray(expired) ? expired.length : 0 },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  revalidatePath("/approvals");
  return { error: null, done: true };
}
