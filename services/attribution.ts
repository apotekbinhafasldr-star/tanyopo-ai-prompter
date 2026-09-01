import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttributionModel, Database } from "@/types/database";

type AnyClient = SupabaseClient<Database>;

export interface SingleTouchAttributionInput {
  tenantId: string;
  conversionId: string;
  masterCampaignId: string | null;
  channelCampaignId: string | null;
  value: number | null;
  model: AttributionModel;
}

/**
 * prompter_attributions is forward-compatible for future multi-touch
 * models (product spec), but no code path has ever written to it — a
 * conversion recorded with a known campaign link was tracked in
 * prompter_conversions and then never actually attributed anywhere. This
 * writes the one attribution every conversion-recording path can support
 * today: single-touch, full weight, to whichever campaign the conversion
 * was already recorded against (either picked by the user in the manual
 * form, or passed by UMKMpro AI in its webhook/handoff payload).
 *
 * Deletes-then-inserts by conversion_id rather than a plain insert, so
 * it's safe to call again for the same conversion — recordConversionFromUmkmpro
 * (services/umkmpro.ts) deliberately *overwrites* on a resend with the
 * same external_event_id (a corrected resend is expected there), and the
 * attribution row must track that correction rather than accumulate a
 * stale duplicate alongside it.
 *
 * Silently no-ops when no campaign is known at all — there is nothing
 * honest to attribute a conversion to without one, and this must never
 * guess a campaign.
 */
export async function recordSingleTouchAttribution(
  supabase: AnyClient,
  input: SingleTouchAttributionInput,
): Promise<void> {
  if (!input.masterCampaignId && !input.channelCampaignId) return;

  await supabase.from("prompter_attributions").delete().eq("conversion_id", input.conversionId);

  await supabase.from("prompter_attributions").insert({
    tenant_id: input.tenantId,
    conversion_id: input.conversionId,
    master_campaign_id: input.masterCampaignId,
    channel_campaign_id: input.channelCampaignId,
    attribution_model: input.model,
    weight: 100,
    attributed_value: input.value,
  });
}
