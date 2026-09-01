import "server-only";

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

// TikTok for Business Marketing API — see
// https://business-api.tiktok.com/portal/docs (Authorization).
const AUTH_BASE = "https://business-api.tiktok.com/portal/auth";
const TOKEN_URL = "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/";
const ADVERTISER_INFO_URL = "https://business-api.tiktok.com/open_api/v1.3/advertiser/info/";

interface TikTokTokenResponse {
  code: number;
  message: string;
  data?: { access_token: string; advertiser_ids?: string[] };
}

function credentials() {
  return {
    appId: serverEnv.tiktok.appId,
    appSecret: serverEnv.tiktok.appSecret,
    redirectUri: serverEnv.tiktok.redirectUri,
  };
}

/**
 * Foundation implementation — connect/disconnect/verify/metadata are
 * real, working code. prompter_platform_capabilities already records
 * CONNECT_ACCOUNT, READ_ANALYTICS, CREATE_CAMPAIGN, CREATE_AD,
 * UPDATE_BUDGET, and PAUSE_CAMPAIGN as enabled for TikTok (each with a
 * caveat noted in the registry's `notes` field — e.g. campaign creation
 * stops at ad-set/targeting, which needs a verified ISO-to-TikTok
 * location_id mapping this codebase doesn't have yet). Only
 * PUBLISH_CONTENT stays disabled in the registry. The campaign/ad/
 * budget/analytics methods below are still UNSUPPORTED here — not
 * because the registry forbids them, but because this pass only builds
 * the connection layer, not the TikTok Ads API campaign-management
 * calls themselves. TIKTOK_APP_ID/SECRET/REDIRECT_URI are also absent
 * in this environment, so isConfigured() is false regardless.
 */
export class TikTokConnector implements PlatformConnector {
  readonly platform = "TIKTOK" as const;

  isConfigured(): boolean {
    return isConnectorConfigured(credentials());
  }

  buildAuthorizationUrl(tenantId: string): ConnectorResult<OAuthStartResult> {
    const { appId, redirectUri } = credentials();
    if (!this.isConfigured() || !appId || !redirectUri) {
      return notConfigured(
        "TikTok belum dikonfigurasi. Tambahkan TIKTOK_APP_ID, TIKTOK_APP_SECRET, dan TIKTOK_REDIRECT_URI.",
      );
    }
    void tenantId;

    const state = generateOAuthState();
    const url = new URL(AUTH_BASE);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri);

    return ok({ authorizationUrl: url.toString(), state });
  }

  async handleCallback(
    params: OAuthCallbackParams,
  ): Promise<ConnectorResult<ConnectedAccountMetadata>> {
    const { appId, appSecret } = credentials();
    if (!this.isConfigured() || !appId || !appSecret) return notConfigured("TikTok belum dikonfigurasi.");
    if (!statesMatch(params.expectedState, params.state)) {
      return connectorError("State OAuth tidak cocok — kemungkinan permintaan CSRF.");
    }
    if (!isTokenEncryptionConfigured()) return notConfigured("TOKEN_ENCRYPTION_KEY belum dikonfigurasi.");

    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code: params.code }),
      });
      const body = (await res.json()) as TikTokTokenResponse;
      if (!res.ok || body.code !== 0 || !body.data?.access_token) {
        return connectorError(`TikTok menolak permintaan token: ${body.message ?? res.status}`);
      }

      const advertiserId = body.data.advertiser_ids?.[0];
      if (!advertiserId) {
        return connectorError("Akun ini tidak memiliki advertiser TikTok yang bisa dikelola.");
      }

      const infoRes = await fetch(
        `${ADVERTISER_INFO_URL}?advertiser_ids=${encodeURIComponent(JSON.stringify([advertiserId]))}`,
        { headers: { "Access-Token": body.data.access_token } },
      );
      const infoBody = (await infoRes.json()) as {
        data?: { list?: Array<{ advertiser_id: string; name: string }> };
      };
      const advertiserName = infoBody.data?.list?.[0]?.name ?? advertiserId;

      const encrypted = encryptToken(body.data.access_token);
      if (!encrypted) return notConfigured("Enkripsi token gagal — TOKEN_ENCRYPTION_KEY tidak valid.");

      const { data: account, error: accountError } = await admin
        .from("prompter_connected_accounts")
        .upsert(
          {
            tenant_id: params.tenantId,
            platform: "TIKTOK",
            external_account_id: advertiserId,
            external_account_name: advertiserName,
            status: "CONNECTED",
            scopes: [],
            refreshable: false,
            last_refreshed_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,platform" },
        )
        .select("id")
        .single();
      if (accountError || !account) return connectorError("Gagal menyimpan status koneksi TikTok.");

      const { error: credError } = await admin.from("prompter_oauth_credentials").upsert(
        { tenant_id: params.tenantId, connected_account_id: account.id, encrypted_access_token: encrypted },
        { onConflict: "connected_account_id" },
      );
      if (credError) return connectorError("Gagal menyimpan kredensial TikTok secara aman.");

      return ok({
        externalAccountId: advertiserId,
        externalAccountName: advertiserName,
        scopes: [],
        expiresAt: null,
        refreshable: false,
      });
    } catch (err) {
      return connectorError(err instanceof Error ? err.message : "Gagal menghubungkan akun TikTok.");
    }
  }

  async disconnect(tenantId: string): Promise<ConnectorResult<true>> {
    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    const { data: account } = await admin
      .from("prompter_connected_accounts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("platform", "TIKTOK")
      .maybeSingle();
    if (account) {
      await admin.from("prompter_oauth_credentials").delete().eq("connected_account_id", account.id);
    }
    const { error } = await admin
      .from("prompter_connected_accounts")
      .update({ status: "DISCONNECTED" })
      .eq("tenant_id", tenantId)
      .eq("platform", "TIKTOK");
    if (error) return connectorError("Gagal memutuskan koneksi TikTok.");
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
      .eq("platform", "TIKTOK")
      .maybeSingle();
    if (error) return connectorError("Gagal membaca status koneksi TikTok.");
    if (!data) return notConfigured("TikTok belum terhubung untuk tenant ini.");

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
    return unsupported("Analitik TikTok belum diimplementasikan pada fase ini.");
  }

  async publishContent(): Promise<ConnectorResult<{ externalId: string }>> {
    return unsupported("Publikasi konten TikTok belum diimplementasikan pada fase ini.");
  }

  async createCampaign(): Promise<ConnectorResult<{ externalCampaignId: string }>> {
    // The registry enables this capability, but real ad-set/targeting
    // creation needs a verified ISO-country-to-TikTok-location_id
    // mapping this codebase doesn't have — see the class docstring.
    return unsupported(
      "Pembuatan campaign TikTok belum diimplementasikan — memerlukan pemetaan location_id yang belum diverifikasi.",
    );
  }

  async createAd(): Promise<ConnectorResult<{ externalAdId: string }>> {
    return unsupported("Pembuatan iklan TikTok belum diimplementasikan pada fase ini.");
  }

  async updateBudget(): Promise<ConnectorResult<true>> {
    return unsupported("Perubahan budget TikTok belum diimplementasikan pada fase ini.");
  }

  async pauseCampaign(): Promise<ConnectorResult<true>> {
    return unsupported("Menjeda campaign TikTok belum diimplementasikan pada fase ini.");
  }
}
