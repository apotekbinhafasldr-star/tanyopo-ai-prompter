import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { preflightFail, resolveLandingUrl, type Check } from "@/lib/campaigns/meta-launch-preflight";
import {
  checkApprovalDestinationSnapshot,
  checkLaunchDestination,
  readStoredDestination,
} from "@/lib/campaigns/purchase-destination";

type Client = SupabaseClient<Database>;

const READ_FAILED_MESSAGE =
  "Gagal membaca data pra-peluncuran. Peluncuran dibatalkan dan tidak ada yang dikirim ke Meta, coba lagi.";

/**
 * The landing URL a LEGACY campaign (no stored destination) would use: the product's website URL, else
 * the brand profile's, validated with the strict launch rules. Tenant scoped, read only. One shared
 * implementation for submission (snapshot), approval, recovery and launch, so all of them agree.
 */
export async function resolveLegacyLandingCheck(
  supabase: Client,
  tenantId: string,
  productId: string | null | undefined,
  ownHosts: readonly string[],
): Promise<Check<string>> {
  let productUrl: string | null = null;
  if (productId) {
    const { data: product, error } = await supabase
      .from("prompter_products")
      .select("id, website_url")
      .eq("id", productId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return preflightFail("PREFLIGHT_READ_FAILED", READ_FAILED_MESSAGE);
    productUrl = product?.website_url ?? null;
  }
  let brandUrl: string | null = null;
  if (!productUrl || productUrl.trim().length === 0) {
    const { data: brand, error } = await supabase
      .from("prompter_brand_profiles")
      .select("website_url")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return preflightFail("PREFLIGHT_READ_FAILED", READ_FAILED_MESSAGE);
    brandUrl = brand?.website_url ?? null;
  }
  return resolveLandingUrl({ productUrl, brandUrl }, ownHosts);
}

export type DestinationIntegrity =
  | { ok: true }
  | { ok: false; reason: "read_failed" | "destination" | "snapshot"; message: string };

/**
 * Is the campaign's CURRENT destination exactly what the given approval (its context snapshot) approved,
 * and is it launchable at all? Read only. Used when the owner decides an approval, by the recovery path
 * (to confirm a campaign is really blocked) and mirrors what the launch checks.
 */
export async function evaluateApprovalDestination(input: {
  supabase: Client;
  tenantId: string;
  productId: string | null | undefined;
  aiProposal: unknown;
  approvalContext: unknown;
  ownHosts: readonly string[] | null;
  /** Also refuse a destination that can never launch (none / invalid). Approving does not require it. */
  requireLaunchable: boolean;
}): Promise<DestinationIntegrity> {
  const { supabase, tenantId, productId, aiProposal, approvalContext, ownHosts, requireLaunchable } = input;

  if (requireLaunchable) {
    const launchable = checkLaunchDestination(aiProposal, ownHosts);
    if (!launchable.ok) return { ok: false, reason: "destination", message: launchable.message };
  }

  let legacyUrl: string | null | undefined;
  if (readStoredDestination(aiProposal, ownHosts).kind === "legacy") {
    const resolved = await resolveLegacyLandingCheck(supabase, tenantId, productId, ownHosts ?? []);
    if (resolved.ok) legacyUrl = resolved.value;
    else if (resolved.code === "PREFLIGHT_READ_FAILED") {
      return { ok: false, reason: "read_failed", message: "Gagal membaca tujuan iklan. Tidak ada perubahan, coba lagi." };
    } else legacyUrl = null;
  }

  const snapshot = checkApprovalDestinationSnapshot(approvalContext, aiProposal, ownHosts, legacyUrl);
  if (!snapshot.ok) return { ok: false, reason: "snapshot", message: snapshot.message };
  return { ok: true };
}
