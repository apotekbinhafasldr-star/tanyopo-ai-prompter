import "server-only";

import { serverEnv, isConnectorConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken, isTokenEncryptionConfigured } from "@/lib/crypto/token-cipher";
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

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const OAUTH_DIALOG_BASE = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

// ads_management/ads_read require Meta App Review at Advanced Access —
// see the "requires_approval" flag already recorded in
// prompter_platform_capabilities for these two. pages_show_list is what
// getAccountMetadata below needs to list connected Pages.
const OAUTH_SCOPES = ["pages_show_list", "ads_management", "ads_read", "business_management"];

function credentials() {
  return {
    appId: serverEnv.meta.appId,
    appSecret: serverEnv.meta.appSecret,
    redirectUri: serverEnv.meta.redirectUri,
  };
}

interface MetaTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
}

export class MetaConnector implements PlatformConnector {
  readonly platform = "META" as const;

  isConfigured(): boolean {
    return isConnectorConfigured(credentials());
  }

  buildAuthorizationUrl(tenantId: string): ConnectorResult<OAuthStartResult> {
    const { appId, redirectUri } = credentials();
    if (!this.isConfigured() || !appId || !redirectUri) {
      return notConfigured(
        "Meta belum dikonfigurasi. Tambahkan META_APP_ID, META_APP_SECRET, dan META_REDIRECT_URI.",
      );
    }

    const state = generateOAuthState();
    const url = new URL(OAUTH_DIALOG_BASE);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", OAUTH_SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    // tenantId is not embedded in the state itself (state is compared
    // byte-for-byte against the httpOnly cookie the route handler sets,
    // not decoded) — see lib/connectors/oauth-state.ts.
    void tenantId;

    return ok({ authorizationUrl: url.toString(), state });
  }

  async handleCallback(
    params: OAuthCallbackParams,
  ): Promise<ConnectorResult<ConnectedAccountMetadata>> {
    const { appId, appSecret, redirectUri } = credentials();
    if (!this.isConfigured() || !appId || !appSecret || !redirectUri) {
      return notConfigured("Meta belum dikonfigurasi.");
    }
    if (!statesMatch(params.expectedState, params.state)) {
      return connectorError("State OAuth tidak cocok — kemungkinan permintaan CSRF. Coba hubungkan lagi.");
    }
    if (!isTokenEncryptionConfigured()) {
      return notConfigured(
        "TOKEN_ENCRYPTION_KEY belum dikonfigurasi — token tidak akan pernah disimpan tanpa dienkripsi.",
      );
    }

    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    try {
      const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
      tokenUrl.searchParams.set("client_id", appId);
      tokenUrl.searchParams.set("redirect_uri", redirectUri);
      tokenUrl.searchParams.set("client_secret", appSecret);
      tokenUrl.searchParams.set("code", params.code);

      const tokenRes = await fetch(tokenUrl.toString());
      if (!tokenRes.ok) {
        return connectorError(`Meta menolak permintaan token (HTTP ${tokenRes.status}).`);
      }
      const token = (await tokenRes.json()) as MetaTokenResponse;

      // Exchange for a long-lived token (60 days) rather than persisting
      // the short-lived one the dialog callback issues.
      const longLivedUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
      longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
      longLivedUrl.searchParams.set("client_id", appId);
      longLivedUrl.searchParams.set("client_secret", appSecret);
      longLivedUrl.searchParams.set("fb_exchange_token", token.access_token);
      const longLivedRes = await fetch(longLivedUrl.toString());
      const longLived = longLivedRes.ok
        ? ((await longLivedRes.json()) as MetaTokenResponse)
        : token;

      const pagesRes = await fetch(
        `${GRAPH_BASE}/me/accounts?access_token=${encodeURIComponent(longLived.access_token)}`,
      );
      if (!pagesRes.ok) {
        return connectorError(`Gagal mengambil daftar Halaman Facebook (HTTP ${pagesRes.status}).`);
      }
      const pages = (await pagesRes.json()) as { data: MetaPage[] };
      const page = pages.data[0];
      if (!page) {
        return connectorError(
          "Tidak ada Halaman Facebook yang bisa dikelola akun ini. Hubungkan akun yang memiliki minimal satu Halaman.",
        );
      }

      const encrypted = encryptToken(longLived.access_token);
      if (!encrypted) return notConfigured("Enkripsi token gagal — TOKEN_ENCRYPTION_KEY tidak valid.");

      const expiresAt = longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
        : null;

      const { data: account, error: accountError } = await admin
        .from("prompter_connected_accounts")
        .upsert(
          {
            tenant_id: params.tenantId,
            platform: "META",
            external_account_id: page.id,
            external_account_name: page.name,
            status: "CONNECTED",
            scopes: OAUTH_SCOPES,
            expires_at: expiresAt,
            refreshable: true,
            last_refreshed_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,platform" },
        )
        .select("id")
        .single();

      if (accountError || !account) {
        return connectorError("Gagal menyimpan status koneksi Meta.");
      }

      const { error: credError } = await admin.from("prompter_oauth_credentials").upsert(
        {
          tenant_id: params.tenantId,
          connected_account_id: account.id,
          encrypted_access_token: encrypted,
        },
        { onConflict: "connected_account_id" },
      );
      if (credError) return connectorError("Gagal menyimpan kredensial Meta secara aman.");

      return ok({
        externalAccountId: page.id,
        externalAccountName: page.name,
        scopes: OAUTH_SCOPES,
        expiresAt,
        refreshable: true,
      });
    } catch (err) {
      return connectorError(err instanceof Error ? err.message : "Gagal menghubungkan akun Meta.");
    }
  }

  async disconnect(tenantId: string): Promise<ConnectorResult<true>> {
    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    const { error } = await admin
      .from("prompter_connected_accounts")
      .update({ status: "DISCONNECTED" })
      .eq("tenant_id", tenantId)
      .eq("platform", "META");
    // Credentials are deleted outright (not just marked disconnected) —
    // a disconnected account should never leave a usable token behind.
    const { data: account } = await admin
      .from("prompter_connected_accounts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("platform", "META")
      .maybeSingle();
    if (account) {
      await admin.from("prompter_oauth_credentials").delete().eq("connected_account_id", account.id);
    }

    if (error) return connectorError("Gagal memutuskan koneksi Meta.");
    return ok(true as const);
  }

  async verifyConnection(tenantId: string): Promise<ConnectorResult<ConnectedAccountMetadata>> {
    if (!this.isConfigured()) return notConfigured("Meta belum dikonfigurasi.");

    const token = await this.getDecryptedToken(tenantId);
    if (!token.ok) return token;

    try {
      const res = await fetch(`${GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(token.data)}`);
      const admin = createAdminClient();
      if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

      if (!res.ok) {
        await admin
          .from("prompter_connected_accounts")
          .update({ status: "ACTION_REQUIRED" })
          .eq("tenant_id", tenantId)
          .eq("platform", "META");
        return connectorError("Token Meta tidak lagi valid — perlu hubungkan ulang.");
      }

      await admin
        .from("prompter_connected_accounts")
        .update({ status: "CONNECTED", last_refreshed_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("platform", "META");

      return this.getAccountMetadata(tenantId);
    } catch (err) {
      return connectorError(err instanceof Error ? err.message : "Gagal memverifikasi koneksi Meta.");
    }
  }

  async getAccountMetadata(tenantId: string): Promise<ConnectorResult<ConnectedAccountMetadata>> {
    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    const { data, error } = await admin
      .from("prompter_connected_accounts")
      .select("external_account_id, external_account_name, scopes, expires_at, refreshable")
      .eq("tenant_id", tenantId)
      .eq("platform", "META")
      .maybeSingle();

    if (error) return connectorError("Gagal membaca status koneksi Meta.");
    if (!data) return notConfigured("Meta belum terhubung untuk tenant ini.");

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
    // requires_approval=true in the capability registry for READ_ANALYTICS
    // (Meta App Review, ads_read at Advanced Access) — not reachable
    // without that review regardless of code; the capability registry is
    // what the UI actually gates on (see lib/connectors/capability-registry.ts).
    return unsupported(
      "Meta Insights API memerlukan Meta App Review (ads_read Advanced Access) yang belum disetujui.",
    );
  }

  async publishContent(): Promise<ConnectorResult<{ externalId: string }>> {
    // prompter_platform_capabilities explicitly records PUBLISH_CONTENT as
    // enabled=false for META — Phase 3 covers the Marketing (ads) API
    // only, not organic Page posting.
    return unsupported("Publikasi konten organik Meta belum diimplementasikan pada fase ini.");
  }

  async createCampaign(): Promise<ConnectorResult<{ externalCampaignId: string }>> {
    return unsupported(
      "Pembuatan campaign Meta memerlukan Meta App Review (ads_management) yang belum disetujui.",
    );
  }

  async createAd(): Promise<ConnectorResult<{ externalAdId: string }>> {
    return unsupported(
      "Pembuatan iklan Meta memerlukan Meta App Review (ads_management) yang belum disetujui.",
    );
  }

  async updateBudget(): Promise<ConnectorResult<true>> {
    return unsupported(
      "Perubahan budget Meta memerlukan Meta App Review (ads_management) yang belum disetujui.",
    );
  }

  async pauseCampaign(): Promise<ConnectorResult<true>> {
    return unsupported(
      "Menjeda campaign Meta memerlukan Meta App Review (ads_management) yang belum disetujui.",
    );
  }

  private async getDecryptedToken(tenantId: string): Promise<ConnectorResult<string>> {
    const admin = createAdminClient();
    if (!admin) return notConfigured("SUPABASE_SECRET_KEY belum dikonfigurasi.");

    const { data: account } = await admin
      .from("prompter_connected_accounts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("platform", "META")
      .maybeSingle();
    if (!account) return notConfigured("Meta belum terhubung untuk tenant ini.");

    const { data: cred } = await admin
      .from("prompter_oauth_credentials")
      .select("encrypted_access_token")
      .eq("connected_account_id", account.id)
      .maybeSingle();
    if (!cred) return connectorError("Kredensial Meta tidak ditemukan — hubungkan ulang.");

    const token = decryptToken(cred.encrypted_access_token);
    if (!token) return connectorError("Gagal mendekripsi token Meta — hubungkan ulang.");

    return ok(token);
  }
}
