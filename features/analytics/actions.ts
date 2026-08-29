"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { manualConversionSchema } from "@/schemas/conversion";
import type { ConversionEventType } from "@/types/database";

export interface AnalyticsActionState {
  error: string | null;
}

export async function logConversionAction(
  _prevState: AnalyticsActionState,
  formData: FormData,
): Promise<AnalyticsActionState> {
  const parsed = manualConversionSchema.safeParse({
    campaignId: formData.get("campaignId"),
    eventType: formData.get("eventType"),
    value: formData.get("value") || undefined,
    customerReference: formData.get("customerReference"),
    occurredAt: formData.get("occurredAt"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.from("prompter_conversions").insert({
    tenant_id: session.tenantId,
    master_campaign_id: parsed.data.campaignId || null,
    event_type: parsed.data.eventType as ConversionEventType,
    value: parsed.data.value,
    customer_reference: parsed.data.customerReference || null,
    source: "manual",
    occurred_at: parsed.data.occurredAt ? new Date(parsed.data.occurredAt).toISOString() : new Date().toISOString(),
  });

  if (error) {
    return { error: "Gagal mencatat konversi." };
  }

  revalidatePath("/analytics");
  return { error: null };
}
