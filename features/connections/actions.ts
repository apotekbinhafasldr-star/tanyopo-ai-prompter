"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { MetaConnector } from "@/lib/connectors/meta-connector";
import { ConnectorConfigError } from "@/lib/connectors/types";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { ConnectorPlatform } from "@/types/database";

export interface ConnectionActionState {
  error: string | null;
}

export interface MetaPage {
  id: string;
  name: string;
}

export type ListMetaPagesResult = { pages: MetaPage[]; error: null } | { pages: null; error: string };

/**
 * Track B — decrypts this tenant's own Meta access token (admin client:
 * prompter_oauth_credentials has zero RLS policies, service-role only) and
 * fetches its real Facebook Pages live from Meta. Returns only {id, name}
 * pairs — the access token itself never leaves this function, is never
 * logged, and is never included in any returned error message (Graph API
 * error bodies are message text from Meta, not an echo of the request).
 */
async function fetchOwnMetaPagesOrError(
  tenantId: string,
): Promise<{ pages: MetaPage[] } | { error: string }> {
  const supabase = await createClient();

  const { data: connectedAccount } = await supabase
    .from("prompter_connected_accounts")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("platform", "META")
    .maybeSingle();

  if (!connectedAccount || connectedAccount.status !== "CONNECTED") {
    return { error: "Akun Meta belum terhubung. Hubungkan akun di halaman Connections terlebih dahulu." };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { error: "Server belum dikonfigurasi untuk mengambil kredensial (SUPABASE_SECRET_KEY kosong)." };
  }

  const { data: credentials } = await admin
    .from("prompter_oauth_credentials")
    .select("encrypted_access_token")
    .eq("connected_account_id", connectedAccount.id)
    .maybeSingle();

  if (!credentials) {
    return { error: "Kredensial koneksi tidak ditemukan. Coba hubungkan ulang akun Meta." };
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(credentials.encrypted_access_token);
  } catch {
    return { error: "Gagal membaca kredensial. Coba hubungkan ulang akun Meta." };
  }

  try {
    const pages = await new MetaConnector().getPages(accessToken);
    return { pages };
  } catch (err) {
    const message =
      err instanceof ConnectorConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Gagal mengambil daftar Page dari Meta.";
    return { error: message };
  }
}

/**
 * Track B — lists the Facebook Pages available to select as this tenant's
 * ad-creative Page. Owner-only, tenant-scoped via requireSessionContext();
 * never accepts or returns any token/secret.
 */
export async function listMetaPagesAction(): Promise<ListMetaPagesResult> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { pages: null, error: "Hanya Owner yang dapat mengelola Page Meta." };
  }

  const result = await fetchOwnMetaPagesOrError(session.tenantId);
  if ("error" in result) {
    return { pages: null, error: result.error };
  }
  return { pages: result.pages, error: null };
}

/**
 * Track B — persists the Owner's chosen Facebook Page for ad creatives.
 * Security: `pageId` is untrusted client input — it is never written
 * directly. Instead, this re-fetches the tenant's real Pages live from
 * Meta (same path as listMetaPagesAction, using the tenant's own token)
 * and only accepts `pageId` if it's present in that fresh result. This
 * closes off both a tampered request (an id the client invented) and a
 * stale one (a Page since removed/unshared from this token) — the
 * verification is always against what Meta says *right now*, not a
 * cached list the client was shown earlier.
 */
export async function selectMetaPageAction(pageId: string): Promise<ConnectionActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengelola Page Meta." };
  }

  if (typeof pageId !== "string" || pageId.trim().length === 0) {
    return { error: "Page tidak valid." };
  }

  const result = await fetchOwnMetaPagesOrError(session.tenantId);
  if ("error" in result) {
    return { error: result.error };
  }

  const selected = result.pages.find((p) => p.id === pageId);
  if (!selected) {
    return { error: "Page tidak ditemukan atau sudah tidak dapat diakses. Muat ulang daftar Page dan coba lagi." };
  }

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("prompter_connected_accounts")
    .update({ selected_page_id: selected.id, selected_page_name: selected.name })
    .eq("tenant_id", session.tenantId)
    .eq("platform", "META");

  if (updateError) {
    return { error: "Gagal menyimpan pilihan Page. Silakan coba lagi." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "connection.meta_page_selected",
    resource_type: "prompter_connected_accounts",
    resource_id: null,
    context: { page_id: selected.id, page_name: selected.name },
  });

  revalidatePath("/connections");
  return { error: null };
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
