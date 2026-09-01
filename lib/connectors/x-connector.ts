import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { serverEnv, isConnectorConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, isTokenEncryptionConfigured } from "@/lib/crypto/token-cipher";
import { generateOAuthState, statesMatch } from "@/lib/connectors/oauth-state";
import {
  ok,
  notConfigured,
  unsupported,
  connectorError,
  type PlatformConnector,
  type ConnectorResult,
  type ConnectedAccountMetadata,
  type OAuthStartResult,
  type OAuthCallbackParams,
  type AnalyticsQuery,
  type AnalyticsResult,
} from "@/lib/connectors/types";

// X (Twitter) API v2 OAuth 2.0 Authorization Code flow with PKCE — see
// https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code.
const AUTH_BASE = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const ME_URL = "https://api.twitter.com/2/users/me";
const OAUTH_SCOPES = ["tweet.read", "users.read", "offline.access"];

interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function credentials() {
  return {
    clientId: serverEnv.x.clientId,
    clientSecret: serverEnv.x.clientSecret,
    redirectUri: serverEnv.x.redirectUri,
  };
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Foundation implementation — connect/disconnect/verify/metadata are
 * real, working code against X API v2. prompter_platform_capabilities
 * already records CONNECT_ACCOUNT, READ_ANALYTICS, CREATE_CAMPAIGN,
 * CREATE_AD, UPDATE_BUDGET, and PAUSE_CAMPAIGN as enabled for X (each
 * with a caveat in the registry's `notes` — e.g. campaign creation
 * stops at ad-set/targeting pending a verified location_id mapping,
 * and publishing needs a compose-tweet flow this codebase doesn't have
 * yet). Only PUBLISH_CONTENT stays disabled in the registry. Ads
 * operations additionally require X Ads API access — a separate
 * approval from basic API v2 access — so createCampaign/createAd/
 * updateBudget/pauseCampaign stay UNSUPPORTED here regardless: not
 * because the registry forbids them, but because neither that Ads API
 * approval nor this codebase's campaign-management calls exist yet.
 * X_CLIENT_ID/SECRET/REDIRECT_URI are also absent in this environment.
 */
export class XConnector implements PlatformConnector {
  readonly platform = "X" as const;

  isConfigured(): boolean {
    return isConnectorConfigured(credentials());
  }

  buildAuthorizationUrl(tenantId: string): ConnectorResult<OAuthStartResult> {
    const { clientId, redirectUri } = credentials();
    if (!this.isConfigured() || !clientId || !redirectUri) {
      return notConfigured("X belum dikonfigurasi. Tambahkan X_CLIENT_ID, X_CLIENT_SECRET, dan X_REDIRECT_URI.");
    }
    void tenantId;

    const state = generateOAuthState();
    const codeVerifier = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());

    const url = new URL(AUTH_BASE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return ok({ authorizationUrl: url.toString(), state, codeVerifier });
  }

  async handleCallback(
    params: OAuthCallbackParams,
  ): Promise<ConnectorResult<ConnectedAccountMetadata>> {
    const { clientId, clientSecret, redirectUri } = credentials();
    if (!this.isConfigured() || !clientId || !clientSecret || !redirectUri) {
      return notConfigured("X belum dikonfigurasi.");
    }
    if (!statesMatch(params.expectedState, params.state)) {
      return connectorError("State OAuth tidak cocok — kemungkinan permintaan CSRF.");
    }
    if (!params.codeVerifier) {
      return connectorError("PKCE code_verifier hilang — mulai ulang proses hubungkan akun.");
    }
    if (!isTokenEncryptionConfigured()) return notConfigured("TOKEN_ENCRYPTION_KEY belum dikonfigurasi.");

    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: params.code,
          redirect_uri: redirectUri,
          code_verifier: params.codeVerifier,
        }),
      });
      if (!tokenRes.ok) return connectorError(`X menolak permintaan token (HTTP ${tokenRes.status}).`);
      const token = (await tokenRes.json()) as XTokenResponse;

      const meRes = await fetch(ME_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!meRes.ok) return connectorError(`Gagal mengambil profil akun X (HTTP ${meRes.status}).`);
      const me = (await meRes.json()) as { data: { id: string; username: string } };

      const encryptedAccess = encryptToken(token.access_token);
      const encryptedRefresh = token.refresh_token ? encryptToken(token.refresh_token) : null;
      if (!encryptedAccess) return notConfigured("Enkripsi token gagal — TOKEN_ENCRYPTION_KEY tidak valid.");

      const expiresAt = token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null;

      const { data: account, error: accountError } = await admin
        .from("prompter_connected_accounts")
        .upsert(
          {
            tenant_id: params.tenantId,
            platform: "X",
            external_account_id: me.data.id,
            external_account_name: `@${me.data.username}`,
            status: "CONNECTED",
            scopes: OAUTH_SCOPES,
            expires_at: expiresAt,
            refreshable: !!token.refresh_token,
            last_refreshed_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,platform" },
        )
        .select("id")
        .single();
      if (accountError || !account) return connectorError("Gagal menyimpan status koneksi X.");

      const { error: credError } = await admin.from("prompter_oauth_credentials").upsert(
        {
          tenant_id: params.tenantId,
          connected_account_id: account.id,
          encrypted_access_token: encryptedAccess,
          encrypted_refresh_token: encryptedRefresh,
        },
        { onConflict: "connected_account_id" },
      );
      if (credError) return connectorError("Gagal menyimpan kredensial X secara aman.");

      return ok({
        externalAccountId: me.data.id,
        externalAccountName: `@${me.data.username}`,
        scopes: OAUTH_SCOPES,
        expiresAt,
        refreshable: !!token.refresh_token,
      });
    } catch (err) {
      return connectorError(err instanceof Error ? err.message : "Gagal menghubungkan akun X.");
    }
  }

  async disconnect(tenantId: string): Promise<ConnectorResult<true>> {
    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    const { data: account } = await admin
      .from("prompter_connected_accounts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("platform", "X")
      .maybeSingle();
    if (account) {
      await admin.from("prompter_oauth_credentials").delete().eq("connected_account_id", account.id);
    }
    const { error } = await admin
      .from("prompter_connected_accounts")
      .update({ status: "DISCONNECTED" })
      .eq("tenant_id", tenantId)
      .eq("platform", "X");
    if (error) return connectorError("Gagal memutuskan koneksi X.");
    return ok(true as const);
  }

  async verifyConnection(tenantId: string): Promise<ConnectorResult<ConnectedAccountMetadata>> {
    return this.getAccountMetadata(tenantId);
  }

  async getAccountMetadata(tenantId: string): Promise<ConnectorResult<ConnectedAccountMetadata>> {
    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    const { data, error } = await admin
      .from("prompter_connected_accounts")
      .select("external_account_id, external_account_name, scopes, expires_at, refreshable")
      .eq("tenant_id", tenantId)
      .eq("platform", "X")
      .maybeSingle();
    if (error) return connectorError("Gagal membaca status koneksi X.");
    if (!data) return notConfigured("X belum terhubung untuk tenant ini.");

    return ok({
      externalAccountId: data.external_account_id,
      externalAccountName: data.external_account_name,
      scopes: data.scopes,
      expiresAt: data.expires_at,
      refreshable: data.refreshable,
    });
  }

  async readAnalytics(
    tenantId: string,
    _query: AnalyticsQuery,
  ): Promise<ConnectorResult<AnalyticsResult>> {
    void tenantId;
    void _query;
    return unsupported("Analitik X belum diimplementasikan pada fase ini.");
  }

  async publishContent(): Promise<ConnectorResult<{ externalId: string }>> {
    return unsupported("Publikasi tweet belum diimplementasikan pada fase ini.");
  }

  async createCampaign(): Promise<ConnectorResult<{ externalCampaignId: string }>> {
    return unsupported("X Ads API memerlukan approval terpisah yang belum tersedia.");
  }

  async createAd(): Promise<ConnectorResult<{ externalAdId: string }>> {
    return unsupported("X Ads API memerlukan approval terpisah yang belum tersedia.");
  }

  async updateBudget(): Promise<ConnectorResult<true>> {
    return unsupported("X Ads API memerlukan approval terpisah yang belum tersedia.");
  }

  async pauseCampaign(): Promise<ConnectorResult<true>> {
    return unsupported("X Ads API memerlukan approval terpisah yang belum tersedia.");
  }
}
