import { createAdminClient } from "@/lib/supabase/admin";

/**
 * F-2b ad-account confirmation marker, shared by the Connections server actions
 * and the Meta launch. This file deliberately has NO "use server" directive: a
 * server-action module may only export server actions, and this function takes
 * a tenant id, so it must never be callable from a browser. It is the single
 * implementation of "has the Owner confirmed the stored ad account?"; the
 * launch does not keep a second confirmation mechanism.
 *
 * Anti-forgery (PR #73 remediation). `prompter_audit_logs` can be INSERTed by
 * any signed-in member of the tenant (RLS only pins tenant_id and requires
 * actor_user_id to be NULL or the caller's own id), so a marker row alone proves
 * nothing. A marker counts ONLY if its actor_user_id is a user who is, right
 * now, an Owner of THIS tenant according to `user_profiles` (read with the
 * admin client; clients have no INSERT/UPDATE policy there, so a member cannot
 * promote themselves). Consequences:
 *  - actor NULL, or the id of a marketing/other member, never counts;
 *  - a member cannot write another user's id (RLS pins actor to auth.uid());
 *  - a marker from another tenant cannot match (tenant_id is filtered twice:
 *    on the marker and on the Owner lookup);
 *  - a demoted or removed Owner's old marker stops counting;
 *  - the Owner filter is applied INSIDE the query (.in), so a flood of forged
 *    rows can neither hide nor outrank a genuine one.
 * Any read error is "not readable", never "confirmed".
 */
const OWNER_LOOKUP_LIMIT = 200;

export const AD_ACCOUNT_SELECTED_ACTION = "connection.meta_ad_account_selected";

export async function readSelectionConfirmed(
  tenantId: string,
  connection: { id: string; external_account_id: string | null; last_refreshed_at?: string | null },
): Promise<{ ok: true; confirmed: boolean } | { ok: false }> {
  if (!connection.external_account_id || !connection.last_refreshed_at) return { ok: true, confirmed: false };
  const admin = createAdminClient();
  if (!admin) return { ok: false };

  // Who may confirm: the Owners of this tenant, as of now.
  const { data: owners, error: ownersError } = await admin
    .from("user_profiles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .limit(OWNER_LOOKUP_LIMIT);
  if (ownersError) return { ok: false };
  const ownerIds = (owners ?? []).map((row: { id: unknown }) => row.id).filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
  if (ownerIds.length === 0) return { ok: true, confirmed: false };

  // Bound to the stored account AND to the exact connect stamp the choice was
  // made against (no clock comparison, so no skew): a reconnect changes the
  // stamp, which invalidates every earlier confirmation at once.
  const { data, error } = await admin
    .from("prompter_audit_logs")
    .select("context")
    .eq("tenant_id", tenantId)
    .eq("action", AD_ACCOUNT_SELECTED_ACTION)
    .eq("resource_id", connection.id)
    .in("actor_user_id", ownerIds)
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
