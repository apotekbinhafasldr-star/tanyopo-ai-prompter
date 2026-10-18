"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import {
  MANUAL_METRICS_UNAVAILABLE_MESSAGE,
  isManualMetricsTableMissing,
} from "@/lib/manual-ad-metrics";
import {
  MANUAL_METRIC_CHANNELS,
  buildManualMetricCreateSchema,
  firstIssueMessage,
  manualMetricValuesSchema,
} from "@/schemas/manual-ad-metrics";
import type { Json } from "@/types/database";

/**
 * Winning Ads Phase 2B — add / edit / delete manually typed ad metrics.
 *
 * Deliberately self-contained and narrow:
 *   - writes ONLY `prompter_manual_ad_metrics` and `prompter_audit_logs`;
 *   - never touches `prompter_marketing_metrics` (connector data), campaign or
 *     channel status, connectors, Budget Guard, the Approval Center or any
 *     launch/H2 code — a structural test pins these imports;
 *   - never calls an ad platform; every number is typed by the user and is
 *     therefore stored as UNVERIFIED manual data.
 *
 * Authorization is layered: owner/marketing role here, tenant-scoped lookups
 * here, then the table's RLS + guard trigger (which still hold if a client
 * bypasses this file). Audit is written BEFORE the mutation and the action
 * fails closed if the audit row cannot be written, so no change exists
 * without a log entry.
 */

export interface ManualMetricsActionState {
  error: string | null;
  success: string | null;
}

const OK = (success: string): ManualMetricsActionState => ({ error: null, success });
const FAIL = (error: string): ManualMetricsActionState => ({ error, success: null });

const AUDIT_RESOURCE = "prompter_manual_ad_metrics";

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function mapDbError(error: { code?: string | null; message?: string | null }): string {
  if (isManualMetricsTableMissing(error)) return MANUAL_METRICS_UNAVAILABLE_MESSAGE;
  switch (error.code) {
    case "23505":
      return "Data untuk tanggal ini sudah ada. Gunakan Edit pada entri yang sudah ada.";
    case "42501":
      return "Anda tidak memiliki izin untuk data ini.";
    case "23514":
    case "23503":
      return "Data ditolak oleh aturan integritas (channel sudah terhubung ke platform, atau nilai di luar batas).";
    default:
      return "Gagal menyimpan data. Silakan coba lagi.";
  }
}

type Session = Awaited<ReturnType<typeof requireSessionContext>>;

async function authorize(): Promise<{ session: Session } | { error: string }> {
  const session = await requireSessionContext();
  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Anda tidak memiliki izin untuk mengubah metrik iklan manual." };
  }
  return { session };
}
type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Audit BEFORE the change. Returns false when the audit row could not be written (caller must stop). */
async function writeAudit(
  supabase: Supabase,
  session: Session,
  entry: {
    action: string;
    resourceId: string;
    before?: Json | null;
    after?: Json | null;
    context: Record<string, Json>;
  },
): Promise<boolean> {
  const { error } = await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: entry.action,
    resource_type: AUDIT_RESOURCE,
    resource_id: entry.resourceId,
    before_data: entry.before ?? null,
    after_data: entry.after ?? null,
    context: { source: "manual", verified_by_platform: false, ...entry.context },
  });
  return !error;
}

/** Best-effort marker that an audited intent did not complete. Never blocks the response. */
async function writeFailureAudit(supabase: Supabase, session: Session, action: string, resourceId: string, code?: string | null) {
  await supabase
    .from("prompter_audit_logs")
    .insert({
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      action: `${action}_failed`,
      resource_type: AUDIT_RESOURCE,
      resource_id: resourceId,
      context: { source: "manual", db_error_code: code ?? null },
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

export async function addManualMetricAction(
  _prev: ManualMetricsActionState,
  formData: FormData,
): Promise<ManualMetricsActionState> {
  const auth = await authorize();
  if ("error" in auth) return FAIL(auth.error);
  const { session } = auth;

  const parsed = buildManualMetricCreateSchema().safeParse({
    channelCampaignId: text(formData, "channelCampaignId"),
    metricDate: text(formData, "metricDate"),
    spend: text(formData, "spend"),
    impressions: text(formData, "impressions"),
    clicks: text(formData, "clicks"),
    conversions: text(formData, "conversions"),
    revenue: text(formData, "revenue"),
  });
  if (!parsed.success) return FAIL(firstIssueMessage(parsed.error));
  const input = parsed.data;

  const supabase = await createClient();

  // Tenant-scoped lookup: another tenant's id is indistinguishable from "not found".
  const { data: channelCampaign } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, channel, master_campaign_id, external_campaign_id")
    .eq("id", input.channelCampaignId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (!channelCampaign) return FAIL("Channel campaign tidak ditemukan.");

  if (!(MANUAL_METRIC_CHANNELS as readonly string[]).includes(channelCampaign.channel)) {
    return FAIL("Input metrik manual hanya untuk channel iklan berbayar (bukan SEO).");
  }
  if (channelCampaign.external_campaign_id) {
    return FAIL(
      "Channel ini sudah terhubung ke campaign di platform. Data platform adalah sumber utama, input manual ditolak.",
    );
  }

  const { data: master } = await supabase
    .from("prompter_master_campaigns")
    .select("id, currency")
    .eq("id", channelCampaign.master_campaign_id)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (!master) return FAIL("Campaign tidak ditemukan.");

  const { data: existing, error: existingError } = await supabase
    .from("prompter_manual_ad_metrics")
    .select("id")
    .eq("channel_campaign_id", channelCampaign.id)
    .eq("metric_date", input.metricDate)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (existingError) return FAIL(mapDbError(existingError));
  if (existing) return FAIL("Data untuk tanggal ini sudah ada. Gunakan Edit pada entri yang sudah ada.");

  const id = randomUUID();
  const row = {
    id,
    tenant_id: session.tenantId,
    master_campaign_id: channelCampaign.master_campaign_id,
    channel_campaign_id: channelCampaign.id,
    channel: channelCampaign.channel as (typeof MANUAL_METRIC_CHANNELS)[number],
    metric_date: input.metricDate,
    spend: input.spend,
    impressions: input.impressions,
    clicks: input.clicks,
    conversions: input.conversions,
    revenue: input.revenue,
    currency: master.currency,
    entered_by: session.userId,
  };

  const audited = await writeAudit(supabase, session, {
    action: "manual_metrics.create",
    resourceId: id,
    after: row as unknown as Json,
    context: { channel_campaign_id: channelCampaign.id, metric_date: input.metricDate },
  });
  if (!audited) return FAIL("Gagal mencatat audit log, data tidak disimpan. Silakan coba lagi.");

  const { error: insertError } = await supabase.from("prompter_manual_ad_metrics").insert(row);
  if (insertError) {
    await writeFailureAudit(supabase, session, "manual_metrics.create", id, insertError.code);
    return FAIL(mapDbError(insertError));
  }

  revalidatePath(`/campaigns/${channelCampaign.master_campaign_id}`);
  return OK("Data tersimpan.");
}

export async function updateManualMetricAction(
  _prev: ManualMetricsActionState,
  formData: FormData,
): Promise<ManualMetricsActionState> {
  const auth = await authorize();
  if ("error" in auth) return FAIL(auth.error);
  const { session } = auth;

  const idRaw = text(formData, "id");
  if (!idRaw || !/^[0-9a-f-]{36}$/i.test(idRaw)) return FAIL("Entri tidak valid.");

  const parsed = manualMetricValuesSchema.safeParse({
    spend: text(formData, "spend"),
    impressions: text(formData, "impressions"),
    clicks: text(formData, "clicks"),
    conversions: text(formData, "conversions"),
    revenue: text(formData, "revenue"),
  });
  if (!parsed.success) return FAIL(firstIssueMessage(parsed.error));
  const values = parsed.data;

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("prompter_manual_ad_metrics")
    .select("*")
    .eq("id", idRaw)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (readError) return FAIL(mapDbError(readError));
  if (!current) return FAIL("Entri tidak ditemukan.");

  const { data: channelCampaign } = await supabase
    .from("prompter_channel_campaigns")
    .select("id, external_campaign_id")
    .eq("id", current.channel_campaign_id)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (!channelCampaign) return FAIL("Channel campaign tidak ditemukan.");
  if (channelCampaign.external_campaign_id) {
    return FAIL("Channel ini sudah terhubung ke platform, entri manual tidak bisa diubah. Anda masih bisa menghapusnya.");
  }

  const audited = await writeAudit(supabase, session, {
    action: "manual_metrics.update",
    resourceId: current.id,
    before: current as unknown as Json,
    after: { ...current, ...values } as unknown as Json,
    context: { channel_campaign_id: current.channel_campaign_id, metric_date: current.metric_date },
  });
  if (!audited) return FAIL("Gagal mencatat audit log, perubahan tidak disimpan. Silakan coba lagi.");

  const { data: updated, error: updateError } = await supabase
    .from("prompter_manual_ad_metrics")
    .update(values)
    .eq("id", current.id)
    .eq("tenant_id", session.tenantId)
    .select("id");
  if (updateError) {
    await writeFailureAudit(supabase, session, "manual_metrics.update", current.id, updateError.code);
    return FAIL(mapDbError(updateError));
  }
  if (!updated || updated.length !== 1) {
    await writeFailureAudit(supabase, session, "manual_metrics.update", current.id, "no_row");
    return FAIL("Entri tidak ditemukan atau tidak bisa diubah.");
  }

  revalidatePath(`/campaigns/${current.master_campaign_id}`);
  return OK("Perubahan tersimpan.");
}

export async function deleteManualMetricAction(
  _prev: ManualMetricsActionState,
  formData: FormData,
): Promise<ManualMetricsActionState> {
  const auth = await authorize();
  if ("error" in auth) return FAIL(auth.error);
  const { session } = auth;

  const idRaw = text(formData, "id");
  if (!idRaw || !/^[0-9a-f-]{36}$/i.test(idRaw)) return FAIL("Entri tidak valid.");

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("prompter_manual_ad_metrics")
    .select("*")
    .eq("id", idRaw)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (readError) return FAIL(mapDbError(readError));
  if (!current) return FAIL("Entri tidak ditemukan.");

  const audited = await writeAudit(supabase, session, {
    action: "manual_metrics.delete",
    resourceId: current.id,
    before: current as unknown as Json,
    context: { channel_campaign_id: current.channel_campaign_id, metric_date: current.metric_date },
  });
  if (!audited) return FAIL("Gagal mencatat audit log, data tidak dihapus. Silakan coba lagi.");

  const { data: deleted, error: deleteError } = await supabase
    .from("prompter_manual_ad_metrics")
    .delete()
    .eq("id", current.id)
    .eq("tenant_id", session.tenantId)
    .select("id");
  if (deleteError) {
    await writeFailureAudit(supabase, session, "manual_metrics.delete", current.id, deleteError.code);
    return FAIL(mapDbError(deleteError));
  }
  if (!deleted || deleted.length !== 1) {
    await writeFailureAudit(supabase, session, "manual_metrics.delete", current.id, "no_row");
    return FAIL("Entri tidak ditemukan atau tidak bisa dihapus.");
  }

  revalidatePath(`/campaigns/${current.master_campaign_id}`);
  return OK("Entri dihapus.");
}
