import "server-only";

import { serverEnv } from "@/lib/env";
import { isConnectorConfigured } from "@/lib/env";
import {
  ConnectorConfigError,
  type ConnectorAccount,
  type ConnectorInsights,
  type ConnectorTokenResult,
  type PlatformConnector,
} from "@/lib/connectors/types";

/**
 * TikTok **Login Kit (web)** connector — identity only.
 *
 * This is deliberately NOT the TikTok for Business / Marketing API. The two
 * are separate TikTok products with different apps, credentials, hosts and
 * OAuth parameters (Login Kit: `client_key` + `https://www.tiktok.com/v2/auth/authorize/`;
 * Marketing API: `app_id` + `business-api.tiktok.com/portal/auth`). The
 * Marketing API connector (lib/connectors/tiktok-connector.ts) is kept in
 * the repo, unchanged, but is no longer registered in get-connector.ts — it
 * stays dormant until advertising gets its own connector and connection
 * identity (which will need a separate migration).
 *
 * Flow (official docs: developers.tiktok.com "Login Kit for Web" and "User
 * Access Token Management"):
 *   1. authorize  -> https://www.tiktok.com/v2/auth/authorize/
 *   2. callback   -> /api/connections/tiktok/callback (shared handler)
 *   3. token      -> POST https://open.tiktokapis.com/v2/oauth/token/ (form-urlencoded)
 *   4. identity   -> GET  https://open.tiktokapis.com/v2/user/info/ (data.user.open_id)
 *
 * Env mapping (names unchanged so no Netlify change is needed for them):
 * TIKTOK_APP_ID holds the Login Kit **Client Key**, TIKTOK_APP_SECRET holds
 * the **Client Secret**.
 *
 * Scope is `user.info.basic` only. Share Kit is a mobile SDK that needs no
 * OAuth scope, and the web "Share Video API" is retired (replaced by the
 * Content Posting API, `video.*` scopes) — so no Share Kit / `video.*` scope
 * is requested here and no Share Kit web flow exists.
 *
 * PKCE is not used: TikTok requires `code_verifier` only for mobile/desktop.
 */

const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";

/** The only scope requested — see the doc comment above. */
export const TIKTOK_LOGIN_KIT_SCOPES = ["user.info.basic"] as const;

/** Canonical callback path (the shared handler's route). */
export const TIKTOK_CALLBACK_PATH = "/api/connections/tiktok/callback";

const ADS_UNAVAILABLE_MESSAGE =
  "Iklan TikTok memerlukan konektor Marketing API (belum tersedia). Koneksi TikTok saat ini hanya untuk login akun.";

interface TikTokTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  open_id?: string;
  error?: string;
  error_description?: string;
  log_id?: string;
}

interface TikTokUserInfoResponse {
  data?: { user?: { open_id?: string; display_name?: string } };
  error?: { code?: string; message?: string; log_id?: string };
}

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function isCanonicalRedirectUri(redirectUri: string | undefined): boolean {
  if (!redirectUri) return false;
  try {
    return new URL(redirectUri).pathname === TIKTOK_CALLBACK_PATH;
  } catch {
    return false;
  }
}

export class TikTokLoginKitConnector implements PlatformConnector {
  readonly platform = "TIKTOK" as const;

  isConfigured(): boolean {
    return (
      isConnectorConfigured({
        clientKey: serverEnv.tiktok.appId,
        clientSecret: serverEnv.tiktok.appSecret,
        redirectUri: serverEnv.tiktok.redirectUri,
      }) && isCanonicalRedirectUri(serverEnv.tiktok.redirectUri)
    );
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new ConnectorConfigError(
        this.platform,
        `TikTok Login Kit belum dikonfigurasi. Isi TIKTOK_APP_ID (Client Key), TIKTOK_APP_SECRET (Client Secret), dan TIKTOK_REDIRECT_URI yang berakhir ${TIKTOK_CALLBACK_PATH}.`,
      );
    }
    return {
      clientKey: serverEnv.tiktok.appId!,
      clientSecret: serverEnv.tiktok.appSecret!,
      redirectUri: serverEnv.tiktok.redirectUri!,
    };
  }

  getAuthorizationUrl(state: string): string {
    const { clientKey, redirectUri } = this.requireConfig();
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_key", clientKey);
    url.searchParams.set("scope", TIKTOK_LOGIN_KIT_SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCodeForToken(code: string): Promise<ConnectorTokenResult> {
    const { clientKey, clientSecret, redirectUri } = this.requireConfig();

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as TikTokTokenResponse;

    // TikTok documents `error` / `error_description` / `log_id` on failure
    // but not the HTTP status, so both signals count as a failure. Only
    // TikTok's own description and log id are surfaced — never the request
    // (which carries the client secret and the code).
    if (!response.ok || body.error) {
      throw new Error(
        `TikTok token exchange gagal: ${body.error_description || body.error || `HTTP ${response.status}`}${
          body.log_id ? ` (log_id: ${body.log_id})` : ""
        }`,
      );
    }
    if (!body.access_token) {
      throw new Error("TikTok token exchange gagal: respons tidak berisi access_token.");
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt:
        typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : undefined,
      scopes: typeof body.scope === "string" ? body.scope.split(",").filter(Boolean) : [],
    };
  }

  /**
   * Best-effort remote revocation — never throws; the caller removes the
   * local rows regardless of this call's outcome.
   */
  async disconnect(accessToken: string): Promise<void> {
    try {
      const { clientKey, clientSecret } = this.requireConfig();
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ client_key: clientKey, client_secret: clientSecret, token: accessToken }),
      });
    } catch {
      // Best-effort by contract.
    }
  }

  /**
   * Login Kit has no ad accounts: the "account" is the TikTok user. The
   * shared callback stores `id` as `external_account_id` (= open_id).
   */
  async getAccounts(accessToken: string): Promise<ConnectorAccount[]> {
    const response = await fetch(`${USER_INFO_URL}?${new URLSearchParams({ fields: "open_id,display_name" })}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json().catch(() => ({}))) as TikTokUserInfoResponse;

    // The user-info response always carries an `error` object; "ok" is
    // TikTok's success marker — any other code is a failure.
    const errorCode = body.error?.code;
    if (!response.ok || (errorCode && errorCode.toLowerCase() !== "ok")) {
      throw new Error(
        `TikTok user info gagal: ${body.error?.message || errorCode || `HTTP ${response.status}`}${
          body.error?.log_id ? ` (log_id: ${body.error.log_id})` : ""
        }`,
      );
    }

    const user = body.data?.user;
    if (!user?.open_id) {
      throw new Error("TikTok user info gagal: respons tidak berisi open_id.");
    }

    return [{ id: user.open_id, name: user.display_name?.trim() || "Akun TikTok" }];
  }

  // --- Advertising: intentionally unavailable on this connector. -----------
  // Each throws before any network call so a Login Kit token can never be
  // sent to the Marketing API (launch-actions / sync-insights resolve this
  // connector for platform TIKTOK and surface this message).

  private adsUnavailable(): never {
    throw new ConnectorConfigError(this.platform, ADS_UNAVAILABLE_MESSAGE);
  }

  async createCampaign(): Promise<{ id: string }> {
    return this.adsUnavailable();
  }

  async createAdSet(): Promise<{ id: string }> {
    return this.adsUnavailable();
  }

  async createCreative(): Promise<{ id: string }> {
    return this.adsUnavailable();
  }

  async createAd(): Promise<{ id: string }> {
    return this.adsUnavailable();
  }

  async getInsights(): Promise<ConnectorInsights> {
    return this.adsUnavailable();
  }

  async pauseCampaign(): Promise<void> {
    this.adsUnavailable();
  }

  async updateBudget(): Promise<void> {
    this.adsUnavailable();
  }
}
