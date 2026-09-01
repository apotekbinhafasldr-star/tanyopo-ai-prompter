import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export { COMPLIANCE_FLAG_TYPES } from "@/schemas/compliance";

type ComplianceFlag = Database["public"]["Tables"]["prompter_compliance_flags"]["Row"];

/**
 * Real compliance readiness rows for the tenant (global scope —
 * market_country_code = '' — only; per-market flags are a future
 * extension of the same table). Never fabricates a status: a flag type
 * with no row simply doesn't appear, and the UI renders that as
 * NOT_CONFIGURED rather than assuming SUPPORTED.
 */
export async function listComplianceFlags(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<ComplianceFlag[]> {
  const { data } = await supabase
    .from("prompter_compliance_flags")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("market_country_code", "");

  return data ?? [];
}
