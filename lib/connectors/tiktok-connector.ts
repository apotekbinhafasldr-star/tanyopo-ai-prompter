import "server-only";

import { serverEnv, isConnectorConfigured } from "@/lib/env";
import { TikTokApiError, tiktokHttp, unwrapMarketing, type TikTokHttpOptions } from "@/lib/connectors/tiktok-http";
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
 * This is the ADS product only. TikTok's organic features (Login Kit,
 * Content Posting API) are a different product with different credentials,
 * host and tokens — see lib/connectors/tiktok-content-posting.ts and
 * docs/TIKTOK_INTEGRATION.md. A token from one must never be sent to the other.
 *
 * Authorization: the portal URL takes only `app_id`, `redirect_uri` and
 * `state` (there is no `scope` parameter on this flow — Marketing API
 * permissions are configured on the app in the TikTok for Business developer
 * portal and granted when the advertiser approves). The official Marketing
 * API docs (business-api.tiktok.com/portal/docs) could NOT be reached when
 * this was hardened (accessed 2026-11-11: blocked), so endpoint shapes, token
 * lifetime/refresh and numeric error codes remain UNVERIFIED.
 *
 * HTTP behaviour (lib/connectors/tiktok-http.ts): HTTP 429 is retried (max 3
 * tries, exponential backoff, Retry-After honoured); 5xx / network errors are
 * retried only for read-only or absolute-state calls; create calls are never
 * replayed (the outcome of a failed create is unknown). Failures are thrown as
 * `TikTokApiError` (a `ConnectorApiError`) with a stable `kind`.
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

/**
 * One Marketing API call. The HTTP options decide whether a 5xx / network
 * error may be replayed (`idempotent`); HTTP 429 is always retried.
 */
async function tiktokFetch(
  path: string,
  init: RequestInit & { accessToken?: string },
  options: TikTokHttpOptions,
): Promise<Record<string, unknown>> {
  const { accessToken, ...requestInit } = init;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(requestInit.headers as Record<string, string> | undefined),
  };
  if (accessToken) {
    headers["Access-Token"] = accessToken;
  }

  const result = await tiktokHttp(`${API_BASE_URL}${path}`, { ...requestInit, headers }, options);
  return unwrapMarketing(result);
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TikTokApiError(`Respons TikTok tidak berisi ${what}.`, { kind: "UNKNOWN" });
  }
  return value;
}

export class TikTokConnector implements PlatformConnector {
  readonly platform = "TIKTOK" as const;

  /** `http` is for tests (fast backoff, fake sleep); production uses the defaults. */
  constructor(private readonly http: Omit<TikTokHttpOptions, "idempotent"> = {}) {}

  private reads(): TikTokHttpOptions {
    return { ...this.http, idempotent: true };
  }

  private writes(): TikTokHttpOptions {
    return { ...this.http, idempotent: false };
  }

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

    // Single-use code: never replayed after a 5xx / network error.
    const data = await tiktokFetch(
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
      this.writes(),
    );

    return {
      accessToken: requireString(data.access_token, "access_token"),
      scopes: Array.isArray(data.scope) ? data.scope.filter((s): s is string => typeof s === "string") : [],
      // TikTok's Marketing API access tokens are long-lived and not
      // documented with a standard expires_in — no expiry is set here
      // rather than guessing one.
    };
  }

  async disconnect(accessToken: string): Promise<void> {
    const { appId, appSecret } = this.requireConfig();
    await tiktokFetch(
      "/oauth2/revoke/",
      {
        method: "POST",
        body: JSON.stringify({ app_id: appId, secret: appSecret, access_token: accessToken }),
      },
      this.reads(),
    );
  }

  async getAccounts(accessToken: string): Promise<ConnectorAccount[]> {
    const { appId, appSecret } = this.requireConfig();
    const data = await tiktokFetch(
      `/oauth2/advertiser/get/?${new URLSearchParams({ app_id: appId, secret: appSecret })}`,
      { accessToken },
      this.reads(),
    );
    return rows(data.list).flatMap((a) => {
      const id = typeof a.advertiser_id === "number" ? String(a.advertiser_id) : a.advertiser_id;
      if (typeof id !== "string" || id.length === 0) return [];
      return [{ id, name: typeof a.advertiser_name === "string" ? a.advertiser_name : id }];
    });
  }

  async createCampaign(
    accessToken: string,
    adAccountId: string,
    input: CampaignInput,
  ): Promise<{ id: string }> {
    this.requireConfig();
    const data = await tiktokFetch(
      "/campaign/create/",
      {
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
      },
      this.writes(),
    );
    return { id: requireString(data.campaign_id, "campaign_id") };
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
    const data = await tiktokFetch(
      "/ad/create/",
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          advertiser_id: adAccountId,
          adgroup_id: input.adSetId,
          creatives: [{ ad_name: input.name, creative_id: input.creativeId }],
          operation_status: "DISABLE",
        }),
      },
      this.writes(),
    );
    const adIds = Array.isArray(data.ad_ids) ? data.ad_ids : [];
    return { id: requireString(adIds[0], "ad_ids") };
  }

  async getInsights(
    accessToken: string,
    adAccountId: string,
    externalCampaignId: string,
  ): Promise<ConnectorInsights> {
    this.requireConfig();
    // Read-only report (POST only because of the filter body): safe to replay.
    const data = await tiktokFetch(
      "/report/integrated/get/",
      {
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
      },
      this.reads(),
    );
    const first = rows(data.list)[0];
    const metrics = (typeof first?.metrics === "object" && first.metrics !== null ? first.metrics : {}) as Record<
      string,
      unknown
    >;
    const num = (value: unknown) => {
      const n = Number(value ?? 0);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      spend: num(metrics.spend),
      impressions: num(metrics.impressions),
      reach: num(metrics.reach),
      clicks: num(metrics.clicks),
      raw: data,
    };
  }

  async pauseCampaign(accessToken: string, adAccountId: string, externalCampaignId: string): Promise<void> {
    this.requireConfig();
    // Sets an absolute state (DISABLE), so replaying it is harmless.
    await tiktokFetch(
      "/campaign/update/status/",
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          advertiser_id: adAccountId,
          campaign_ids: [externalCampaignId],
          operation_status: "DISABLE",
        }),
      },
      this.reads(),
    );
  }

  async updateBudget(
    accessToken: string,
    adAccountId: string,
    externalCampaignId: string,
    dailyBudgetMinorUnits: number,
  ): Promise<void> {
    this.requireConfig();
    // Sets an absolute budget value, so replaying it is harmless.
    await tiktokFetch(
      "/campaign/update/",
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          advertiser_id: adAccountId,
          campaign_id: externalCampaignId,
          budget: dailyBudgetMinorUnits,
        }),
      },
      this.reads(),
    );
  }
}
