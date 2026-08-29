/**
 * Vendor-neutral ad-platform connector contract (product spec §28-30).
 * Every connector method that touches an external API is only ever called
 * after the caller has confirmed the connector `isConfigured()` and the
 * tenant has a live connection — a method called without that returns a
 * `ConnectorConfigError`, never a simulated success.
 */

export class ConnectorConfigError extends Error {
  constructor(
    public readonly platform: string,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorConfigError";
  }
}

export interface ConnectorAccount {
  id: string;
  name: string;
}

export interface ConnectorTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

export interface ConnectorInsights {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  /** Untouched platform response, kept for marketing_metrics.raw_data. */
  raw: unknown;
}

export interface CampaignInput {
  name: string;
  objective: string;
  dailyBudgetMinorUnits: number;
}

export interface AdSetInput {
  campaignId: string;
  name: string;
  dailyBudgetMinorUnits: number;
  targetingCountries: string[];
}

export interface CreativeInput {
  name: string;
  headline: string;
  primaryText: string;
  cta: string;
  linkUrl?: string;
  imageUrl?: string;
  /** Facebook Page the ad runs "as". Required by Meta; no Page picker UI exists yet. */
  pageId?: string;
}

export interface AdInput {
  name: string;
  adSetId: string;
  creativeId: string;
}

/**
 * Implemented today: `lib/connectors/meta-connector.ts`. `TikTokConnector`
 * and `XConnector` (Phase 6) will implement this same interface — nothing
 * here assumes feature parity between platforms, since a method a platform
 * genuinely can't do simply throws `ConnectorConfigError` from that
 * connector rather than being present with fake behavior.
 */
export interface PlatformConnector {
  readonly platform: "META" | "TIKTOK" | "X";

  isConfigured(): boolean;

  /** Builds the OAuth authorization URL to redirect the user to. */
  getAuthorizationUrl(state: string): string;

  /** Exchanges an OAuth `code` for a token server-side. */
  exchangeCodeForToken(code: string): Promise<ConnectorTokenResult>;

  /** Best-effort remote token revocation; local cleanup happens regardless of this call's outcome. */
  disconnect(accessToken: string, externalAccountId: string): Promise<void>;

  getAccounts(accessToken: string): Promise<ConnectorAccount[]>;

  createCampaign(accessToken: string, adAccountId: string, input: CampaignInput): Promise<{ id: string }>;
  createAdSet(accessToken: string, adAccountId: string, input: AdSetInput): Promise<{ id: string }>;
  createCreative(accessToken: string, adAccountId: string, input: CreativeInput): Promise<{ id: string }>;
  createAd(accessToken: string, adAccountId: string, input: AdInput): Promise<{ id: string }>;

  getInsights(accessToken: string, externalCampaignId: string): Promise<ConnectorInsights>;
  pauseCampaign(accessToken: string, externalCampaignId: string): Promise<void>;
  updateBudget(accessToken: string, externalCampaignId: string, dailyBudgetMinorUnits: number): Promise<void>;
}
