import { createAdminClient } from "@/lib/supabase/admin";

/**
 * F-2b ad-account confirmation marker, shared by the Connections server actions
 * and the Meta launch. This file deliberately has NO "use server" directive: a
 * server-action module may only export server actions, and this function takes
 * a tenant id, so it must never be callable from a browser. It is the single
 * implementation of "has the Owner confirmed the stored ad account?"; the
 * launch does not keep a second confirmation mechanism.
 */
export const AD_ACCOUNT_SELECTED_ACTION = "connection.meta_ad_account_selected";

export async function readSelectionConfirmed(
  tenantId: string,
  connection: { id: string; external_account_id: string | null; last_refreshed_at?: string | null },
): Promise<{ ok: true; confirmed: boolean } | { ok: false }> {
  if (!connection.external_account_id || !connection.last_refreshed_at) return { ok: true, confirmed: false };
  const admin = createAdminClient();
  if (!admin) return { ok: false };
  // Bound to the stored account AND to the exact connect stamp the choice was
  // made against (no clock comparison, so no skew): a reconnect changes the
  // stamp, which invalidates every earlier confirmation at once.
  const { data, error } = await admin
    .from("prompter_audit_logs")
    .select("context")
    .eq("tenant_id", tenantId)
    .eq("action", AD_ACCOUNT_SELECTED_ACTION)
    .eq("resource_id", connection.id)
    .filter("context->>external_account_id", "eq", connection.external_account_id)
    .filter("context->>connected_at", "eq", connection.last_refreshed_at)
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false };
  const context = data?.context as { external_account_id?: unknown; connected_at?: unknown } | null | undefined;
  return {
    ok: true,
    confirmed:
      context?.external_account_id === connection.external_account_id &&
      context?.connected_at === connection.last_refreshed_at,
  };
}
