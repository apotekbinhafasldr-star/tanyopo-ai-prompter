"use server";

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

/**
 * Winning Ads Phase 2B — add / edit / delete manually typed ad metrics.
 *
 * Deliberately self-contained and narrow:
 *   - writes ONLY `prompter_manual_ad_metrics` (it reads channel and master campaigns);
 *   - never touches `prompter_marketing_metrics` (connector data), campaign or
 *     channel status, connectors, Budget Guard, the Approval Center or any
 *     launch/H2 code — a structural test pins these imports;
 *   - never calls an ad platform; every number is typed by the user and is
 *     therefore stored as UNVERIFIED manual data.
 *
 * Authorization is layered: owner/marketing role here, tenant-scoped lookups
 * here, then the table's RLS + guard trigger (which still hold if a client
 * bypasses this file).
 *
 * Audit is NOT written here. A database trigger on the table writes the
 * `prompter_audit_logs` row in the same transaction as the change, so a failed
 * audit rolls the change back, a failed change leaves no audit row, and writes
 * made straight through the database API are logged too. Writing audit rows
 * from this file as well would duplicate them.
 */

export interface ManualMetricsActionState {
  error: string | null;
  success: string | null;
}

const OK = (success: string): ManualMetricsActionState => ({ error: null, success });
const FAIL = (error: string): ManualMetricsActionState => ({ error, success: null });

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

  const row = {
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

  const { error: insertError } = await supabase.from("prompter_manual_ad_metrics").insert(row);
  if (insertError) return FAIL(mapDbError(insertError));

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

  const { data: updated, error: updateError } = await supabase
    .from("prompter_manual_ad_metrics")
    .update(values)
    .eq("id", current.id)
    .eq("tenant_id", session.tenantId)
    .select("id");
  if (updateError) return FAIL(mapDbError(updateError));
  if (!updated || updated.length !== 1) {
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

  const { data: deleted, error: deleteError } = await supabase
    .from("prompter_manual_ad_metrics")
    .delete()
    .eq("id", current.id)
    .eq("tenant_id", session.tenantId)
    .select("id");
  if (deleteError) return FAIL(mapDbError(deleteError));
  if (!deleted || deleted.length !== 1) {
    return FAIL("Entri tidak ditemukan atau tidak bisa dihapus.");
  }

  revalidatePath(`/campaigns/${current.master_campaign_id}`);
  return OK("Entri dihapus.");
}
