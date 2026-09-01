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
 * TikTok for Business Marketing API connector (product spec §29, Phase 6).
 *
 * Every write call creates the object in `operation_status: "DISABLE"`
 * (TikTok's paused-equivalent state) — same defense-in-depth as the Meta
 * connector: nothing here can start spending money on its own.
 *
 * IMPORTANT: like the Meta connector, this has not been exercised against
 * a live TikTok Business account — this environment has neither
 * TIKTOK_APP_ID/TIKTOK_APP_SECRET nor network access to
 * business-api.tiktok.com. Request/response shapes follow the documented
 * Marketing API v1.3 contracts as closely as possible; treat this as a
 * first implementation to verify, not battle-tested code.
 *
 * Known incomplete step, disclosed rather than worked around: TikTok's
 * targeting API takes numeric `location_id` values from TikTok's own
 * location catalog, not ISO country codes — this app has no verified
 * mapping from `AdSetInput.targetingCountries` (ISO codes) to those IDs.
 * Guessing a number would risk silently targeting the wrong location with
 * real budget, which is worse than stopping — so `createAdSet` throws
 * `ConnectorConfigError` until a verified mapping exists.
 */

const API_VERSION = "v1.3";
const API_BASE_URL = `https://business-api.tiktok.com/open_api/${API_VERSION}`;
const AUTH_DIALOG_URL = "https://business-api.tiktok.com/portal/auth";

interface TikTokEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

async function tiktokFetch<T>(
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const { accessToken, ...requestInit } = init;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(requestInit.headers as Record<string, string> | undefined),
  };
  if (accessToken) {
    headers["Access-Token"] = accessToken;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...requestInit, headers });
  const body = (await response.json().catch(() => ({}))) as TikTokEnvelope<T>;

  if (!response.ok || body.code !== 0) {
    throw new Error(body.message || `TikTok Marketing API error (HTTP ${response.status}).`);
  }

  return body.data;
}

export class TikTokConnector implements PlatformConnector {
  readonly platform = "TIKTOK" as const;

  isConfigured(): boolean {
    return isConnectorConfigured({
      appId: serverEnv.tiktok.appId,
      appSecret: serverEnv.tiktok.appSecret,
      redirectUri: serverEnv.tiktok.redirectUri,
    });
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new ConnectorConfigError(
        this.platform,
        "TikTok connector belum dikonfigurasi. Tambahkan TIKTOK_APP_ID, TIKTOK_APP_SECRET, dan TIKTOK_REDIRECT_URI.",
      );
    }
    return {
      appId: serverEnv.tiktok.appId!,
      appSecret: serverEnv.tiktok.appSecret!,
      redirectUri: serverEnv.tiktok.redirectUri!,
    };
  }

  getAuthorizationUrl(state: string): string {
    const { appId, redirectUri } = this.requireConfig();
    const url = new URL(AUTH_DIALOG_URL);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCodeForToken(code: string): Promise<ConnectorTokenResult> {
    const { appId, appSecret } = this.requireConfig();

    const data = await tiktokFetch<{ access_token: string; scope?: string[] }>(
      "/oauth2/access_token/",
      {
        method: "POST",
        body: JSON.stringify({
          app_id: appId,
          secret: appSecret,
          auth_code: code,
          grant_type: "authorization_code",
        }),
      },
    );

    return {
      accessToken: data.access_token,
      scopes: data.scope ?? [],
      // TikTok's Marketing API access tokens are long-lived and not
      // documented with a standard expires_in — no expiry is set here
      // rather than guessing one.
    };
  }

  async disconnect(accessToken: string): Promise<void> {
    const { appId, appSecret } = this.requireConfig();
    await tiktokFetch("/oauth2/revoke/", {
      method: "POST",
      body: JSON.stringify({ app_id: appId, secret: appSecret, access_token: accessToken }),
    });
  }

  async getAccounts(accessToken: string): Promise<ConnectorAccount[]> {
    const { appId, appSecret } = this.requireConfig();
    const data = await tiktokFetch<{ list: { advertiser_id: string; advertiser_name: string }[] }>(
      `/oauth2/advertiser/get/?${new URLSearchParams({ app_id: appId, secret: appSecret })}`,
      { accessToken },
    );
    return data.list.map((a) => ({ id: a.advertiser_id, name: a.advertiser_name }));
  }

  async createCampaign(
    accessToken: string,
    adAccountId: string,
    input: CampaignInput,
  ): Promise<{ id: string }> {
    this.requireConfig();
    const data = await tiktokFetch<{ campaign_id: string }>("/campaign/create/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        advertiser_id: adAccountId,
        campaign_name: input.name,
        objective_type: input.objective,
        budget_mode: "BUDGET_MODE_DAY",
        budget: input.dailyBudgetMinorUnits,
        operation_status: "DISABLE",
      }),
    });
    return { id: data.campaign_id };
  }

  /**
   * See the class-level doc comment: TikTok targeting requires numeric
   * `location_id`s from TikTok's own catalog, and this app has no
   * verified mapping from ISO country codes to them. Stops here rather
   * than guessing.
   */
  async createAdSet(): Promise<{ id: string }> {
    this.requireConfig();
    throw new ConnectorConfigError(
      this.platform,
      "TikTok memerlukan location_id numerik dari katalog lokasi TikTok, bukan kode negara ISO — belum ada pemetaan yang terverifikasi. Peluncuran campaign TikTok akan tersedia setelah pemetaan lokasi diverifikasi.",
    );
  }

  /** No asset-upload flow exists in this app yet — TikTok ad creatives require an already-uploaded video or image id. */
  async createCreative(_accessToken: string, _adAccountId: string, input: CreativeInput): Promise<{ id: string }> {
    this.requireConfig();
    throw new ConnectorConfigError(
      this.platform,
      `Belum ada aset video/gambar yang diunggah untuk membuat creative "${input.name}". Unggah aset TikTok akan tersedia pada iterasi berikutnya.`,
    );
  }

  async createAd(accessToken: string, adAccountId: string, input: AdInput): Promise<{ id: string }> {
    this.requireConfig();
    const data = await tiktokFetch<{ ad_ids: string[] }>("/ad/create/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        advertiser_id: adAccountId,
        adgroup_id: input.adSetId,
        creatives: [{ ad_name: input.name, creative_id: input.creativeId }],
        operation_status: "DISABLE",
      }),
    });
    return { id: data.ad_ids[0] };
  }

  async getInsights(
    accessToken: string,
    adAccountId: string,
    externalCampaignId: string,
  ): Promise<ConnectorInsights> {
    this.requireConfig();
    const data = await tiktokFetch<{
      list: { metrics: { spend?: string; impressions?: string; reach?: string; clicks?: string } }[];
    }>("/report/integrated/get/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        advertiser_id: adAccountId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: ["campaign_id"],
        metrics: ["spend", "impressions", "reach", "clicks"],
        filtering: [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify([externalCampaignId]) }],
      }),
    });
    const row = data.list[0]?.metrics;
    return {
      spend: Number(row?.spend ?? 0),
      impressions: Number(row?.impressions ?? 0),
      reach: Number(row?.reach ?? 0),
      clicks: Number(row?.clicks ?? 0),
      raw: data,
    };
  }

  async pauseCampaign(accessToken: string, adAccountId: string, externalCampaignId: string): Promise<void> {
    this.requireConfig();
    await tiktokFetch("/campaign/update/status/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        advertiser_id: adAccountId,
        campaign_ids: [externalCampaignId],
        operation_status: "DISABLE",
      }),
    });
  }

  async updateBudget(
    accessToken: string,
    adAccountId: string,
    externalCampaignId: string,
    dailyBudgetMinorUnits: number,
  ): Promise<void> {
    this.requireConfig();
    await tiktokFetch("/campaign/update/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        advertiser_id: adAccountId,
        campaign_id: externalCampaignId,
        budget: dailyBudgetMinorUnits,
      }),
    });
  }
}
