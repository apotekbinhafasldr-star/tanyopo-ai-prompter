import "server-only";

import { serverEnv, isConnectorConfigured } from "@/lib/env";
import {
  ConnectorConfigError,
  type AdInput,
  type CampaignInput,
  type ConnectorAccount,
  type ConnectorInsights,
  type ConnectorTokenResult,
  type CreativeInput,
  type PlatformConnector,
} from "@/lib/connectors/types";

/**
 * X (formerly Twitter) Ads API connector (product spec §29, Phase 6).
 *
 * Every write call creates the object with `entity_status: "PAUSED"` —
 * same defense-in-depth as the Meta/TikTok connectors: nothing here can
 * start spending money on its own.
 *
 * IMPORTANT: like the other two connectors, this has not been exercised
 * against a live X Ads account — this environment has neither
 * X_CLIENT_ID/X_CLIENT_SECRET nor network access to ads-api.twitter.com.
 * Request/response shapes follow the documented Ads API v12 contracts as
 * closely as possible; treat this as a first implementation to verify.
 *
 * Known incomplete steps, disclosed rather than worked around:
 * - **No PKCE.** X's OAuth 2.0 documentation states `code_challenge` is
 *   required for every client type, not just public ones. This connector
 *   implements plain Authorization Code (no PKCE) — the authorization
 *   request will likely be rejected by X until that's added. Adding it
 *   would mean threading a `code_verifier` through the shared OAuth
 *   callback flow (`lib/connectors/oauth-callback.ts`), which every other
 *   connector would then have to ignore — deferred rather than done
 *   speculatively without the ability to verify it against a real X app.
 * - **No verified location targeting.** Same reasoning as TikTok:
 *   `createAdSet`'s targeting needs X's own numeric location ids, not ISO
 *   country codes, and guessing one risks real budget on the wrong
 *   location — it throws `ConnectorConfigError` instead.
 * - **No tweet-composition flow.** X Promoted Tweets require an existing
 *   tweet id to promote; this app has no organic-posting feature, so
 *   `createCreative` throws `ConnectorConfigError` rather than inventing one.
 */

const ADS_API_BASE_URL = "https://ads-api.twitter.com/12";
const AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const REVOKE_URL = "https://api.twitter.com/2/oauth2/revoke";

const SCOPES = ["ads.read", "ads.write", "offline.access"];

/** X Ads API budget/spend fields are denominated in micros of the local currency (1 unit = 1,000,000 micros). */
const MICROS_PER_UNIT = 1_000_000;

interface XErrorBody {
  errors?: { message: string; code?: number }[];
}

async function adsApiFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ADS_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & XErrorBody;

  if (!response.ok || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message ?? `X Ads API error (HTTP ${response.status}).`);
  }

  return body;
}

export class XConnector implements PlatformConnector {
  readonly platform = "X" as const;

  isConfigured(): boolean {
    return isConnectorConfigured({
      clientId: serverEnv.x.clientId,
      clientSecret: serverEnv.x.clientSecret,
      redirectUri: serverEnv.x.redirectUri,
    });
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new ConnectorConfigError(
        this.platform,
        "X connector belum dikonfigurasi. Tambahkan X_CLIENT_ID, X_CLIENT_SECRET, dan X_REDIRECT_URI.",
      );
    }
    return {
      clientId: serverEnv.x.clientId!,
      clientSecret: serverEnv.x.clientSecret!,
      redirectUri: serverEnv.x.redirectUri!,
    };
  }

  private basicAuthHeader(clientId: string, clientSecret: string): string {
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  getAuthorizationUrl(state: string): string {
    const { clientId, redirectUri } = this.requireConfig();
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCodeForToken(code: string): Promise<ConnectorTokenResult> {
    const { clientId, clientSecret, redirectUri } = this.requireConfig();

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: this.basicAuthHeader(clientId, clientSecret),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error_description?: string;
    };

    if (!response.ok || !body.access_token) {
      throw new Error(body.error_description ?? `X token exchange gagal (HTTP ${response.status}).`);
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      scopes: body.scope ? body.scope.split(" ") : SCOPES,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
    };
  }

  async disconnect(accessToken: string): Promise<void> {
    const { clientId, clientSecret } = this.requireConfig();
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: this.basicAuthHeader(clientId, clientSecret),
      },
      body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }),
    });
  }

  async getAccounts(accessToken: string): Promise<ConnectorAccount[]> {
    this.requireConfig();
    const data = await adsApiFetch<{ data: { id: string; name: string }[] }>("/accounts", accessToken);
    return data.data.map((a) => ({ id: a.id, name: a.name }));
  }

  /**
   * X requires a `funding_instrument_id` on every campaign. There is no
   * funding-instrument picker UI in this app, so — same simplification
   * already used for ad-account selection across every connector — this
   * fetches the ad account's own funding instruments and uses the first
   * one, rather than asking the caller to supply one that doesn't exist
   * anywhere in this app yet.
   */
  private async getFirstFundingInstrumentId(accessToken: string, adAccountId: string): Promise<string> {
    const data = await adsApiFetch<{ data: { id: string }[] }>(
      `/accounts/${adAccountId}/funding_instruments`,
      accessToken,
    );
    const fundingInstrument = data.data[0];
    if (!fundingInstrument) {
      throw new ConnectorConfigError(
        this.platform,
        "Tidak ditemukan funding instrument pada akun iklan X ini — tambahkan metode pembayaran di X Ads Manager terlebih dahulu.",
      );
    }
    return fundingInstrument.id;
  }

  async createCampaign(
    accessToken: string,
    adAccountId: string,
    input: CampaignInput,
  ): Promise<{ id: string }> {
    this.requireConfig();
    const fundingInstrumentId = await this.getFirstFundingInstrumentId(accessToken, adAccountId);

    const data = await adsApiFetch<{ data: { id: string } }>(`/accounts/${adAccountId}/campaigns`, accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: input.name,
        funding_instrument_id: fundingInstrumentId,
        entity_status: "PAUSED",
        daily_budget_amount_local_micro: String(input.dailyBudgetMinorUnits * MICROS_PER_UNIT),
        standard_delivery: "true",
      }),
    });
    return { id: data.data.id };
  }

  /**
   * See the class-level doc comment: X's targeting_criteria needs numeric
   * location ids from X's own catalog, and this app has no verified
   * mapping from ISO country codes to them. Stops here rather than
   * guessing.
   */
  async createAdSet(): Promise<{ id: string }> {
    this.requireConfig();
    throw new ConnectorConfigError(
      this.platform,
      "X memerlukan location_id numerik dari katalog lokasi X, bukan kode negara ISO — belum ada pemetaan yang terverifikasi. Peluncuran campaign X akan tersedia setelah pemetaan lokasi diverifikasi.",
    );
  }

  /** X Promoted Tweets require an existing tweet id — this app has no tweet-composition/posting flow. */
  async createCreative(_accessToken: string, _adAccountId: string, input: CreativeInput): Promise<{ id: string }> {
    this.requireConfig();
    throw new ConnectorConfigError(
      this.platform,
      `Belum ada tweet yang bisa dipromosikan untuk creative "${input.name}". Membuat tweet dari dalam aplikasi ini akan tersedia pada iterasi berikutnya.`,
    );
  }

  async createAd(accessToken: string, adAccountId: string, input: AdInput): Promise<{ id: string }> {
    this.requireConfig();
    const data = await adsApiFetch<{ data: { id: string } }>(
      `/accounts/${adAccountId}/promoted_tweets`,
      accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ line_item_id: input.adSetId, tweet_ids: input.creativeId }),
      },
    );
    return { id: data.data.id };
  }

  /**
   * X's stats API has no field in the ENGAGEMENT metric group directly
   * comparable to Meta/TikTok's "reach" — rather than guess a field name
   * that might silently report the wrong number, `reach` is left at 0.
   */
  async getInsights(
    accessToken: string,
    adAccountId: string,
    externalCampaignId: string,
  ): Promise<ConnectorInsights> {
    this.requireConfig();
    const params = new URLSearchParams({
      entity: "CAMPAIGN",
      entity_ids: externalCampaignId,
      metric_groups: "ENGAGEMENT,BILLING",
      placement: "ALL_ON_TWITTER",
      granularity: "TOTAL",
    });
    const data = await adsApiFetch<{
      data: { id_data: { metrics: Record<string, number[] | null> }[] }[];
    }>(`/stats/accounts/${adAccountId}?${params}`, accessToken);

    const metrics = data.data[0]?.id_data[0]?.metrics ?? {};
    const sum = (values: number[] | null | undefined) => (values ?? []).reduce((a, b) => a + b, 0);

    return {
      spend: sum(metrics.billed_charge_local_micro) / MICROS_PER_UNIT,
      impressions: sum(metrics.impressions),
      reach: 0,
      clicks: sum(metrics.clicks),
      raw: data,
    };
  }

  async pauseCampaign(accessToken: string, adAccountId: string, externalCampaignId: string): Promise<void> {
    this.requireConfig();
    await adsApiFetch(`/accounts/${adAccountId}/campaigns/${externalCampaignId}`, accessToken, {
      method: "PUT",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ entity_status: "PAUSED" }),
    });
  }

  async updateBudget(
    accessToken: string,
    adAccountId: string,
    externalCampaignId: string,
    dailyBudgetMinorUnits: number,
  ): Promise<void> {
    this.requireConfig();
    await adsApiFetch(`/accounts/${adAccountId}/campaigns/${externalCampaignId}`, accessToken, {
      method: "PUT",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        daily_budget_amount_local_micro: String(dailyBudgetMinorUnits * MICROS_PER_UNIT),
      }),
    });
  }
}
