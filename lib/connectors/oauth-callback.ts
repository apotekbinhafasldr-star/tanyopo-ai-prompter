import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { encryptToken, isTokenCipherConfigured } from "@/lib/crypto/token-cipher";
import { ConnectorConfigError } from "@/lib/connectors/types";
import type { ConnectorPlatform, Database, StoredConnectionStatus } from "@/types/database";

type AccountInsert = Database["public"]["Tables"]["prompter_connected_accounts"]["Insert"];
/** Per-connection fields (everything but identity and status). */
type AccountFields = Omit<AccountInsert, "id" | "tenant_id" | "platform" | "status">;

function redirectWith(request: NextRequest, params: Record<string, string>) {
  const target = new URL("/connections", request.url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target);
}

/**
 * Shared OAuth callback handler for every ad-platform connector
 * (Meta/TikTok/X). Exchanges the code for a token server-side, encrypts
 * it (lib/crypto/token-cipher.ts), and writes it through the admin/
 * service-role client — the only client with any DB access to
 * prompter_oauth_credentials (RLS enabled with zero policies for the
 * authenticated role). Never returns the token to the browser in any
 * form. Extracted from the Meta-only implementation once TikTok/X needed
 * the identical flow (Phase 6) — no per-platform behavior differs here;
 * everything platform-specific lives behind the PlatformConnector
 * interface itself.
 */
export async function handleConnectorOauthCallback(
  request: NextRequest,
  platform: ConnectorPlatform,
  stateCookieName: string,
): Promise<NextResponse> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return redirectWith(request, { error: "owner_required" });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(stateCookieName)?.value;
  cookieStore.delete(stateCookieName);

  if (oauthError) {
    return redirectWith(request, { error: "denied" });
  }

  if (!code || !state || !stateCookie) {
    return redirectWith(request, { error: "invalid_state" });
  }

  const [expectedState, expectedTenantId] = stateCookie.split(":");
  if (state !== expectedState || expectedTenantId !== session.tenantId) {
    return redirectWith(request, { error: "invalid_state" });
  }

  const connector = getConnector(platform);
  if (!connector) {
    return redirectWith(request, { error: "not_available" });
  }

  const admin = createAdminClient();
  if (!admin) {
    return redirectWith(request, { error: "server_not_configured" });
  }

  // Refuse before the one-time authorization code is spent: with no usable
  // encryption key there is nowhere safe to put the resulting token.
  if (!isTokenCipherConfigured()) {
    return redirectWith(request, { error: "encryption_not_configured" });
  }

  try {
    const tokenResult = await connector.exchangeCodeForToken(code);
    const accounts = await connector.getAccounts(tokenResult.accessToken);
    const primaryAccount = accounts[0];

    if (!primaryAccount) {
      return redirectWith(request, { error: "no_ad_account" });
    }

    // Encrypt everything BEFORE the first database write, so an encryption
    // failure can never leave a half-written connection behind.
    const encryptedAccessToken = encryptToken(tokenResult.accessToken);
    const encryptedRefreshToken = tokenResult.refreshToken ? encryptToken(tokenResult.refreshToken) : null;

    const accountFields: AccountFields = {
      external_account_id: primaryAccount.id,
      external_account_name: primaryAccount.name,
      scopes: tokenResult.scopes,
      expires_at: tokenResult.expiresAt?.toISOString() ?? null,
      refreshable: true,
      last_refreshed_at: new Date().toISOString(),
      connected_by: session.userId,
    };

    // Write order (no DB transaction is available, so the order itself is
    // the safety mechanism). The invariant: status = 'CONNECTED' is written
    // LAST, and only after the encrypted credentials were stored and that
    // result was checked. Every earlier state is non-CONNECTED, so a crash
    // or error between any two writes fails closed.
    const { data: existing, error: lookupError } = await admin
      .from("prompter_connected_accounts")
      .select("id, status")
      .eq("tenant_id", session.tenantId)
      .eq("platform", platform)
      .maybeSingle();

    if (lookupError) {
      return redirectWith(request, { error: "save_failed" });
    }

    let accountId: string;
    // True only when THIS request inserted the row. Only such a row may be
    // deleted as compensation; a pre-existing (reconnect) row never is.
    let createdByThisRequest = false;
    let previousStatus: StoredConnectionStatus | null = null;

    if (existing) {
      // Reconnect. Take the live connection out of CONNECTED first, so
      // that while credentials/metadata are being replaced, nothing can
      // use a half-updated account. The row itself is never deleted.
      accountId = existing.id;
      previousStatus = existing.status as StoredConnectionStatus;
      const demoted = await setStatus(admin, session.tenantId, accountId, "ACTION_REQUIRED");
      if (!demoted) {
        return redirectWith(request, { error: "save_failed" });
      }
    } else {
      const { data: inserted, error: insertError } = await admin
        .from("prompter_connected_accounts")
        .insert({
          tenant_id: session.tenantId,
          platform,
          ...accountFields,
          // Not CONNECTED yet: credentials do not exist.
          status: "ACTION_REQUIRED",
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        // Includes a concurrent insert losing the (tenant_id, platform)
        // unique race. Nothing of ours exists, so there is nothing to undo.
        return redirectWith(request, { error: "save_failed" });
      }
      accountId = inserted.id;
      createdByThisRequest = true;
    }

    const { error: credentialsError } = await admin.from("prompter_oauth_credentials").upsert(
      {
        tenant_id: session.tenantId,
        connected_account_id: accountId,
        encrypted_access_token: encryptedAccessToken,
        encrypted_refresh_token: encryptedRefreshToken,
      },
      { onConflict: "connected_account_id" },
    );

    if (credentialsError) {
      // A single failed statement changed nothing, so the previous
      // credentials (if any) are intact.
      if (createdByThisRequest) {
        await removeCreatedAccount(admin, session.tenantId, accountId);
      } else if (previousStatus) {
        await setStatus(admin, session.tenantId, accountId, previousStatus);
      }
      return redirectWith(request, { error: "save_failed" });
    }

    const promoted = await setAccountConnected(admin, session.tenantId, accountId, accountFields);
    if (!promoted) {
      // Credentials are stored but the account could not be activated.
      // New row: remove it. Reconnect: leave ACTION_REQUIRED (credentials
      // were replaced, so restoring the old status would be wrong).
      if (createdByThisRequest) {
        await removeCreatedAccount(admin, session.tenantId, accountId);
      }
      return redirectWith(request, { error: "save_failed" });
    }

    const { error: auditError } = await admin.from("prompter_audit_logs").insert({
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      action: "connection.connected",
      resource_type: "prompter_connected_accounts",
      resource_id: accountId,
      context: { platform, external_account_id: primaryAccount.id },
    });
    if (auditError) {
      // The connection itself is complete and valid; losing the audit row
      // must not undo it, but it must not be silent either.
      console.error("[oauth-callback] audit log insert failed", { platform, code: auditError.code });
    }

    return redirectWith(request, { connected: platform });
  } catch (err) {
    const errorCode = err instanceof ConnectorConfigError ? "not_configured" : "connect_failed";
    return redirectWith(request, { error: errorCode });
  }
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

/** Updates one account's status; true only if exactly that row changed. */
async function setStatus(
  admin: AdminClient,
  tenantId: string,
  accountId: string,
  status: StoredConnectionStatus,
): Promise<boolean> {
  const { data, error } = await admin
    .from("prompter_connected_accounts")
    .update({ status })
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .select("id");
  if (error) {
    console.error("[oauth-callback] status update failed", { status, code: error.code });
    return false;
  }
  return data?.length === 1;
}

/** Final step: refresh metadata and flip to CONNECTED. True only if one row changed. */
async function setAccountConnected(
  admin: AdminClient,
  tenantId: string,
  accountId: string,
  fields: AccountFields,
): Promise<boolean> {
  const { data, error } = await admin
    .from("prompter_connected_accounts")
    .update({ ...fields, status: "CONNECTED" })
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .select("id");
  if (error) {
    console.error("[oauth-callback] activation failed", { code: error.code });
    return false;
  }
  return data?.length === 1;
}

/**
 * Compensation for a row inserted by this very request. If the delete
 * fails the row stays ACTION_REQUIRED (never CONNECTED), which is safe.
 */
async function removeCreatedAccount(admin: AdminClient, tenantId: string, accountId: string): Promise<void> {
  const { error } = await admin
    .from("prompter_connected_accounts")
    .delete()
    .eq("id", accountId)
    .eq("tenant_id", tenantId);
  if (error) {
    console.error("[oauth-callback] cleanup of new account failed", { code: error.code });
  }
}
