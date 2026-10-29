"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { MetaConnector } from "@/lib/connectors/meta-connector";
import { ConnectorConfigError } from "@/lib/connectors/types";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { describeSafeError } from "@/lib/connectors/safe-error-log";
import { runMetaReadinessCheck, type MetaReadinessActionResult } from "@/features/connections/meta-readiness-core";
import {
  listMetaAdAccounts,
  selectMetaAdAccount,
  type MetaAdAccountListResult,
  type MetaAdAccountSelectResult,
  type MetaAdAccountSelectionDeps,
} from "@/features/connections/meta-ad-account-selection-core";
import type { ConnectorPlatform } from "@/types/database";
import { AD_ACCOUNT_SELECTED_ACTION, readSelectionConfirmed } from "@/features/connections/meta-selection-confirmation";

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

/**
 * F-2a — READ-ONLY Meta ad-account readiness check. Owner-only and
 * tenant-scoped; it reads this tenant's own connection (RLS client) and its
 * own encrypted credentials (admin client, filtered by tenant AND connection),
 * makes at most two GET calls to Meta, and writes nothing. The returned value
 * carries no token, no ad-account id and no funding-source id — see
 * `runMetaReadinessCheck`. It never opens the External Budget Safety Gate and
 * never creates or activates a campaign.
 */
export async function checkMetaAdAccountReadinessAction(): Promise<MetaReadinessActionResult> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  return runMetaReadinessCheck(
    { tenantId: session.tenantId, role: session.role },
    {
      async loadConnection(tenantId) {
        const { data, error } = await supabase
          .from("prompter_connected_accounts")
          .select("id, status, external_account_id, expires_at, last_refreshed_at")
          .eq("tenant_id", tenantId)
          .eq("platform", "META")
          .maybeSingle();
        if (error) return { ok: false };
        return { ok: true, connection: data ?? null };
      },
      isSelectionConfirmed: readSelectionConfirmed,
      async loadEncryptedToken(tenantId, connectedAccountId) {
        const admin = createAdminClient();
        if (!admin) return { ok: false };
        const { data, error } = await admin
          .from("prompter_oauth_credentials")
          .select("encrypted_access_token")
          .eq("connected_account_id", connectedAccountId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (error) return { ok: false };
        return { ok: true, encrypted: data?.encrypted_access_token ?? null };
      },
      decrypt: decryptToken,
      connector: new MetaConnector(),
      now: () => new Date(),
      logFailure(stage, err) {
        // Structured, allowlisted fields only (error name, HTTP status, numeric
        // code/subcode). Never the message, a token, a URL or a response body.
        console.error("[meta-readiness] failure", { stage, ...(err === undefined ? {} : describeSafeError(err)) });
      },
    },
  );
}

/**
 * F-2b — "the Owner confirmed this ad account" marker. No new column: the
 * confirmation is a `connection.meta_ad_account_selected` audit row for THIS
 * connection that names exactly the account stored now AND carries the
 * connection's current connect stamp (`last_refreshed_at`). A reconnect
 * changes the stamp, so it invalidates an older choice; any change to the
 * stored account that was not made through the selection action leaves it
 * unconfirmed (fail-closed).
 * Read with the admin client, filtered by tenant AND connection.
 */
const PRE_LAUNCH_STATUSES: readonly string[] = ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"];
const META_ACTIVITY_SCAN_LIMIT = 1000;

function buildAdAccountSelectionDeps(
  supabase: Awaited<ReturnType<typeof createClient>>,
): MetaAdAccountSelectionDeps {
  return {
    async loadConnection(tenantId) {
      const { data, error } = await supabase
        .from("prompter_connected_accounts")
        .select("id, status, external_account_id, expires_at, last_refreshed_at")
        .eq("tenant_id", tenantId)
        .eq("platform", "META")
        .maybeSingle();
      if (error) return { ok: false };
      return { ok: true, connection: data ?? null };
    },
    async loadEncryptedToken(tenantId, connectedAccountId) {
      const admin = createAdminClient();
      if (!admin) return { ok: false };
      const { data, error } = await admin
        .from("prompter_oauth_credentials")
        .select("encrypted_access_token")
        .eq("connected_account_id", connectedAccountId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) return { ok: false };
      return { ok: true, encrypted: data?.encrypted_access_token ?? null };
    },
    decrypt: decryptToken,
    connector: new MetaConnector(),
    isSelectionConfirmed: readSelectionConfirmed,
    async hasMetaAdActivity(tenantId) {
      const { data, error } = await supabase
        .from("prompter_channel_campaigns")
        .select("status, external_campaign_id")
        .eq("tenant_id", tenantId)
        .in("channel", ["FACEBOOK", "INSTAGRAM"])
        .limit(META_ACTIVITY_SCAN_LIMIT);
      if (error || !data) return { ok: false };
      // Anything beyond the pre-launch states counts, an unknown status counts,
      // and so does a full page (we cannot see the rest).
      const has =
        data.length >= META_ACTIVITY_SCAN_LIMIT ||
        data.some((row) => row.external_campaign_id !== null || !PRE_LAUNCH_STATUSES.includes(row.status));
      return { ok: true, has };
    },
    async persistSelection(input) {
      const admin = createAdminClient();
      if (!admin) return { ok: false, reason: "ERROR" };

      // 1) Confirmation FIRST. If this fails nothing has changed. If a later
      //    step fails, the row is harmless: it counts only when it names the
      //    stored account AND the current connect stamp.
      const { error: auditError } = await admin.from("prompter_audit_logs").insert({
        tenant_id: input.tenantId,
        actor_user_id: input.userId,
        action: AD_ACCOUNT_SELECTED_ACTION,
        resource_type: "prompter_connected_accounts",
        resource_id: input.connectionId,
        context: {
          platform: "META",
          external_account_id: input.adAccountId,
          previous_external_account_id: input.previousAdAccountId,
          connected_at: input.expectedLastRefreshedAt,
        },
      });
      if (auditError) return { ok: false, reason: "ERROR" };

      // 2) Compare-and-set. Tenant, platform, CONNECTED, the exact connect stamp
      //    and the account read earlier are all part of the WHERE clause, and
      //    exactly one row must change: a reconnect, or a concurrent selection
      //    that got there first, yields CONFLICT and leaves the account alone.
      const { data, error } = await supabase
        .from("prompter_connected_accounts")
        .update({ external_account_id: input.adAccountId, external_account_name: input.adAccountName })
        .eq("id", input.connectionId)
        .eq("tenant_id", input.tenantId)
        .eq("platform", "META")
        .eq("status", "CONNECTED")
        .eq("last_refreshed_at", input.expectedLastRefreshedAt)
        .eq("external_account_id", input.previousAdAccountId)
        .select("id");
      if (error) return { ok: false, reason: "ERROR" };
      if (!data || data.length !== 1) return { ok: false, reason: "CONFLICT" };
      return { ok: true };
    },
    now: () => new Date(),
    logFailure(stage, err) {
      // Structured, allowlisted fields only. Never the message, token, URL or body.
      console.error("[meta-ad-account] failure", { stage, ...(err === undefined ? {} : describeSafeError(err)) });
    },
  };
}

/**
 * F-2b — READ-ONLY list of the Meta ad accounts this tenant's connection can
 * access, for the account picker. Owner-only and tenant-scoped; writes nothing.
 */
export async function listMetaAdAccountsAction(): Promise<MetaAdAccountListResult> {
  const session = await requireSessionContext();
  const supabase = await createClient();
  return listMetaAdAccounts({ tenantId: session.tenantId, role: session.role }, buildAdAccountSelectionDeps(supabase));
}

/**
 * F-2b — stores the Owner's chosen ad account. The id is untrusted input: it is
 * accepted only if it is in the list Meta returns right now for this tenant's
 * own token. Only the stored account choice changes; no campaign, budget or
 * payment is touched, and the Budget Gate is never opened.
 */
export async function selectMetaAdAccountAction(adAccountId: string): Promise<MetaAdAccountSelectResult> {
  const session = await requireSessionContext();
  const supabase = await createClient();
  const result = await selectMetaAdAccount(
    { tenantId: session.tenantId, userId: session.userId, role: session.role },
    adAccountId,
    buildAdAccountSelectionDeps(supabase),
  );
  if (result.error === null) revalidatePath("/connections");
  return result;
}
