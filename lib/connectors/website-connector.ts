import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type WebsiteConnectionStatus = "NOT_CONFIGURED" | "CONFIGURED";

export interface WebsiteConnectionOverview {
  status: WebsiteConnectionStatus;
  websiteUrl: string | null;
  /**
   * SEO project readiness (prompter_seo_projects, Phase 5) and
   * conversion-event ingestion readiness (prompter_conversions webhook
   * path, Phase 2/4) are both planned but have no application code yet
   * — reported as false rather than querying tables this app doesn't
   * type/touch, so this never implies a capability that isn't real.
   */
  seoReady: false;
  conversionTrackingReady: false;
}

/**
 * The Website "connection" has no OAuth — a brand's site is just a URL
 * the tenant already entered in onboarding/brand profile. This reads
 * that value rather than fabricating a verified/live status, per
 * "Do not fabricate website analytics."
 */
export async function getWebsiteConnectionOverview(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<WebsiteConnectionOverview> {
  const { data } = await supabase
    .from("prompter_brand_profiles")
    .select("website_url")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const websiteUrl = data?.website_url ?? null;

  return {
    status: websiteUrl ? "CONFIGURED" : "NOT_CONFIGURED",
    websiteUrl,
    seoReady: false,
    conversionTrackingReady: false,
  };
}
