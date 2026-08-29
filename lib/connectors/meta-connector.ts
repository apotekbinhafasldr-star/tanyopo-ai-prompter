import "server-only";

import { serverEnv } from "@/lib/env";
import { isConnectorConfigured } from "@/lib/env";
import {
  ConnectorConfigError,
  type AdInput,
  type AdSetInput,
  type CampaignInput,
  type ConnectorAccount,
  type ConnectorInsights,
  type ConnectorTokenResult,
  type CreativeInput,
  type PlatformConnector,
} from "@/lib/connectors/types";

/**
 * Meta (Facebook & Instagram) Marketing API connector.
 *
 * Every write call creates the object in `PAUSED` state — nothing this
 * connector does can start spending money on its own; a separate,
 * explicit "resume" step (not yet built) would be needed to go live. This
 * is deliberate defense in depth on top of Budget Guard and the Approval
 * Center.
 *
 * IMPORTANT: this code has not been exercised against a live Meta ad
 * account — this environment has neither META_APP_ID/META_APP_SECRET nor
 * network access to graph.facebook.com. The request/response shapes below
 * follow the documented Marketing API v21.0 contracts as closely as
 * possible, but treat this as a first implementation to verify against a
 * real ad account before relying on it, not as battle-tested code.
 */

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const DIALOG_BASE_URL = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

const SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list"];

interface GraphErrorBody {
  error?: { message: string; type?: string; code?: number };
}

async function graphFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, init);
  const body = (await response.json().catch(() => ({}))) as T & GraphErrorBody;

  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `Meta Graph API error (HTTP ${response.status}).`);
  }

  return body;
}

export class MetaConnector implements PlatformConnector {
  readonly platform = "META" as const;

  isConfigured(): boolean {
    return isConnectorConfigured({
      appId: serverEnv.meta.appId,
      appSecret: serverEnv.meta.appSecret,
      redirectUri: serverEnv.meta.redirectUri,
    });
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new ConnectorConfigError(
        this.platform,
        "Meta connector belum dikonfigurasi. Tambahkan META_APP_ID, META_APP_SECRET, dan META_REDIRECT_URI.",
      );
    }
    return {
      appId: serverEnv.meta.appId!,
      appSecret: serverEnv.meta.appSecret!,
      redirectUri: serverEnv.meta.redirectUri!,
    };
  }

  getAuthorizationUrl(state: string): string {
    const { appId, redirectUri } = this.requireConfig();
    const url = new URL(DIALOG_BASE_URL);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  async exchangeCodeForToken(code: string): Promise<ConnectorTokenResult> {
    const { appId, appSecret, redirectUri } = this.requireConfig();

    const shortLived = await graphFetch<{ access_token: string }>(
      `/oauth/access_token?${new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      })}`,
    );

    const longLived = await graphFetch<{ access_token: string; expires_in?: number }>(
      `/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLived.access_token,
      })}`,
    );

    const debug = await graphFetch<{ data: { scopes: string[] } }>(
      `/debug_token?${new URLSearchParams({
        input_token: longLived.access_token,
        access_token: `${appId}|${appSecret}`,
      })}`,
    );

    return {
      accessToken: longLived.access_token,
      scopes: debug.data.scopes,
      expiresAt: longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000)
        : undefined,
    };
  }

  async disconnect(accessToken: string): Promise<void> {
    this.requireConfig();
    await graphFetch(`/me/permissions?${new URLSearchParams({ access_token: accessToken })}`, {
      method: "DELETE",
    });
  }

  async getAccounts(accessToken: string): Promise<ConnectorAccount[]> {
    this.requireConfig();
    const result = await graphFetch<{ data: { id: string; name: string }[] }>(
      `/me/adaccounts?${new URLSearchParams({ fields: "id,name", access_token: accessToken })}`,
    );
    return result.data.map((a) => ({ id: a.id, name: a.name }));
  }

  async createCampaign(
    accessToken: string,
    adAccountId: string,
    input: CampaignInput,
  ): Promise<{ id: string }> {
    this.requireConfig();
    return graphFetch(`/${adAccountId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        objective: input.objective,
        status: "PAUSED",
        special_ad_categories: [],
        access_token: accessToken,
      }),
    });
  }

  async createAdSet(
    accessToken: string,
    adAccountId: string,
    input: AdSetInput,
  ): Promise<{ id: string }> {
    this.requireConfig();
    return graphFetch(`/${adAccountId}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        campaign_id: input.campaignId,
        daily_budget: input.dailyBudgetMinorUnits,
        billing_event: "IMPRESSIONS",
        optimization_goal: "REACH",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: { geo_locations: { countries: input.targetingCountries } },
        status: "PAUSED",
        access_token: accessToken,
      }),
    });
  }

  /**
   * Requires a Facebook Page to run the creative "as". Page selection
   * (its own OAuth step + picker UI) isn't built yet, so `input.pageId`
   * is never populated by any caller today — this throws a config error
   * rather than guessing a page ID, but the connector call itself is
   * otherwise a real, complete Graph API request.
   */
  async createCreative(
    accessToken: string,
    adAccountId: string,
    input: CreativeInput,
  ): Promise<{ id: string }> {
    this.requireConfig();
    if (!input.pageId) {
      throw new ConnectorConfigError(
        this.platform,
        `Belum ada Facebook Page terhubung untuk membuat creative "${input.name}". Pemilihan Page akan tersedia pada iterasi berikutnya.`,
      );
    }

    return graphFetch(`/${adAccountId}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        object_story_spec: {
          page_id: input.pageId,
          link_data: {
            message: input.primaryText,
            name: input.headline,
            link: input.linkUrl ?? "https://tanyopo.ai",
            image_url: input.imageUrl,
            call_to_action: input.linkUrl
              ? { type: "LEARN_MORE", value: { link: input.linkUrl } }
              : undefined,
          },
        },
        access_token: accessToken,
      }),
    });
  }

  async createAd(accessToken: string, adAccountId: string, input: AdInput): Promise<{ id: string }> {
    this.requireConfig();
    return graphFetch(`/${adAccountId}/ads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        adset_id: input.adSetId,
        creative: { creative_id: input.creativeId },
        status: "PAUSED",
        access_token: accessToken,
      }),
    });
  }

  async getInsights(accessToken: string, externalCampaignId: string): Promise<ConnectorInsights> {
    this.requireConfig();
    const result = await graphFetch<{
      data: { spend?: string; impressions?: string; reach?: string; clicks?: string }[];
    }>(
      `/${externalCampaignId}/insights?${new URLSearchParams({
        fields: "spend,impressions,reach,clicks",
        access_token: accessToken,
      })}`,
    );
    const row = result.data[0];
    return {
      spend: Number(row?.spend ?? 0),
      impressions: Number(row?.impressions ?? 0),
      reach: Number(row?.reach ?? 0),
      clicks: Number(row?.clicks ?? 0),
      raw: result,
    };
  }

  async pauseCampaign(accessToken: string, externalCampaignId: string): Promise<void> {
    this.requireConfig();
    await graphFetch(`/${externalCampaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED", access_token: accessToken }),
    });
  }

  /** Assumes Campaign Budget Optimization is enabled — sets budget at the campaign level. */
  async updateBudget(
    accessToken: string,
    externalCampaignId: string,
    dailyBudgetMinorUnits: number,
  ): Promise<void> {
    this.requireConfig();
    await graphFetch(`/${externalCampaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_budget: dailyBudgetMinorUnits, access_token: accessToken }),
    });
  }
}
