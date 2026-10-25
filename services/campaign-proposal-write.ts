import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type ProposalWriteOutcome = "written" | "conflict" | "error";

export const PROPOSAL_CONFLICT_MESSAGE =
  "Campaign baru saja diubah oleh proses lain (misalnya tab lain atau pengajuan). Muat ulang halaman lalu ulangi perubahan Anda. Tidak ada perubahan yang disimpan.";

/**
 * Compare-and-swap write of a DRAFT campaign. ONE conditional UPDATE: it only matches when the row still
 * has the `updated_at` the caller READ (a trigger bumps it on every write) AND is still DRAFT in this
 * tenant. The check and the write are the same statement, so there is no gap for another request to slip
 * into: a concurrent edit, regenerate, submit or status change makes this match zero rows and nothing is
 * overwritten. `expectedUpdatedAt` is passed through untouched (never parsed or reformatted).
 */
export async function writeCampaignIfUnchanged(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  campaignId: string,
  expectedUpdatedAt: string | null | undefined,
  patch: Database["public"]["Tables"]["prompter_master_campaigns"]["Update"],
): Promise<ProposalWriteOutcome> {
  if (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt.length === 0) return "error";
  try {
    const { data, error } = await supabase
      .from("prompter_master_campaigns")
      .update(patch)
      .eq("id", campaignId)
      .eq("tenant_id", tenantId)
      .eq("status", "DRAFT")
      .eq("updated_at", expectedUpdatedAt)
      .select("id");
    if (error || !Array.isArray(data)) return "error";
    if (data.length === 1) return "written";
    return data.length === 0 ? "conflict" : "error";
  } catch {
    return "error";
  }
}
