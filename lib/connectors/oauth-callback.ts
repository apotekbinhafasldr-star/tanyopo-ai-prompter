import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { ConnectorConfigError } from "@/lib/connectors/types";
import type { ConnectorPlatform } from "@/types/database";

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

  try {
    const tokenResult = await connector.exchangeCodeForToken(code);
    const accounts = await connector.getAccounts(tokenResult.accessToken);
    const primaryAccount = accounts[0];

    if (!primaryAccount) {
      return redirectWith(request, { error: "no_ad_account" });
    }

    const { data: connectedAccount, error: upsertError } = await admin
      .from("prompter_connected_accounts")
      .upsert(
        {
          tenant_id: session.tenantId,
          platform,
          external_account_id: primaryAccount.id,
          external_account_name: primaryAccount.name,
          status: "CONNECTED",
          scopes: tokenResult.scopes,
          expires_at: tokenResult.expiresAt?.toISOString() ?? null,
          refreshable: true,
          last_refreshed_at: new Date().toISOString(),
          connected_by: session.userId,
        },
        { onConflict: "tenant_id,platform" },
      )
      .select("id")
      .single();

    if (upsertError || !connectedAccount) {
      return redirectWith(request, { error: "save_failed" });
    }

    await admin.from("prompter_oauth_credentials").upsert(
      {
        tenant_id: session.tenantId,
        connected_account_id: connectedAccount.id,
        encrypted_access_token: encryptToken(tokenResult.accessToken),
        encrypted_refresh_token: tokenResult.refreshToken
          ? encryptToken(tokenResult.refreshToken)
          : null,
      },
      { onConflict: "connected_account_id" },
    );

    await admin.from("prompter_audit_logs").insert({
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      action: "connection.connected",
      resource_type: "prompter_connected_accounts",
      resource_id: connectedAccount.id,
      context: { platform, external_account_id: primaryAccount.id },
    });

    return redirectWith(request, { connected: platform });
  } catch (err) {
    const errorCode = err instanceof ConnectorConfigError ? "not_configured" : "connect_failed";
    return redirectWith(request, { error: errorCode });
  }
}
