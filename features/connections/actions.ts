"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { ConnectorPlatform } from "@/types/database";

export interface ConnectionActionState {
  error: string | null;
}

/**
 * Disconnects a platform. Attempts remote token revocation on a
 * best-effort basis (a failure there never blocks the local cleanup —
 * an account should never appear "connected" in this app once the user
 * has asked to disconnect it, even if Meta's revoke call itself fails).
 */
export async function disconnectAction(platform: ConnectorPlatform): Promise<ConnectionActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat memutuskan koneksi." };
  }

  const supabase = await createClient();

  const { data: account } = await supabase
    .from("prompter_connected_accounts")
    .select("id, external_account_id")
    .eq("tenant_id", session.tenantId)
    .eq("platform", platform)
    .maybeSingle();

  if (!account) {
    return { error: null };
  }

  const admin = createAdminClient();
  if (admin) {
    const { data: credentials } = await admin
      .from("prompter_oauth_credentials")
      .select("encrypted_access_token")
      .eq("connected_account_id", account.id)
      .maybeSingle();

    if (credentials) {
      try {
        const connector = getConnector(platform);
        const accessToken = decryptToken(credentials.encrypted_access_token);
        await connector?.disconnect(accessToken, account.external_account_id);
      } catch {
        // Best-effort — proceed to local cleanup regardless.
      }
    }
  }

  // prompter_oauth_credentials cascades on delete via its FK.
  await supabase.from("prompter_connected_accounts").delete().eq("id", account.id);

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "connection.disconnected",
    resource_type: "prompter_connected_accounts",
    resource_id: account.id,
    context: { platform },
  });

  revalidatePath("/connections");
  return { error: null };
}
