import type {
  ConnectorCapability,
  ConnectorPlatform,
  StoredConnectionStatus,
} from "@/types/database";

export type { ConnectorCapability, ConnectorPlatform, StoredConnectionStatus };

/**
 * Every connector operation returns one of these three shapes — never a
 * bare success/failure boolean, and never a fabricated success. See
 * docs/INTEGRATIONS.md "A method called without the underlying
 * credentials configured returns a typed configuration error."
 */
export type ConnectorResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "NOT_CONFIGURED"; message: string }
  | { ok: false; reason: "UNSUPPORTED"; message: string }
  | { ok: false; reason: "ERROR"; message: string };

export function ok<T>(data: T): ConnectorResult<T> {
  return { ok: true, data };
}
export function notConfigured(message: string): ConnectorResult<never> {
  return { ok: false, reason: "NOT_CONFIGURED", message };
}
export function unsupported(message: string): ConnectorResult<never> {
  return { ok: false, reason: "UNSUPPORTED", message };
}
export function connectorError(message: string): ConnectorResult<never> {
  return { ok: false, reason: "ERROR", message };
}

/** Non-secret account metadata safe to render in the Connection Center. */
export interface ConnectedAccountMetadata {
  externalAccountId: string;
  externalAccountName: string | null;
  scopes: string[];
  expiresAt: string | null;
  refreshable: boolean;
}

export interface OAuthStartResult {
  authorizationUrl: string;
  state: string;
  /** PKCE code_verifier (X/OAuth 2.0) — undefined for platforms that don't use PKCE. */
  codeVerifier?: string;
}

export interface OAuthCallbackParams {
  tenantId: string;
  code: string;
  state: string;
  /** The state value the app itself issued at OAuth start, for CSRF comparison. */
  expectedState: string;
  /** Echoed back from the cookie set at /start, for PKCE-based platforms. */
  codeVerifier?: string;
}

export interface AnalyticsQuery {
  since: string;
  until: string;
}

export interface AnalyticsResult {
  impressions: number;
  clicks: number;
  spend: number;
  currency: string;
}

export interface CampaignDraftInput {
  name: string;
  objective: string;
  dailyBudget: number | null;
  totalBudget: number | null;
  currency: string;
}

export interface AdDraftInput {
  campaignExternalId: string;
  headline: string;
  primaryText: string;
  cta: string;
}

/**
 * The typed adapter every ad platform implements, per
 * docs/INTEGRATIONS.md "Planned connector architecture." Business logic
 * (Connection Center, future campaign publishing) only ever calls this
 * interface — never a vendor SDK directly.
 *
 * Every method that would touch real money or public content
 * (createCampaign/createAd/updateBudget/pauseCampaign/publishContent) is
 * part of the contract now so the shape is settled, but this task
 * (Connection Center recovery) never calls them — no ad is created, no
 * budget is spent, no content is published by this codebase yet.
 */
export interface PlatformConnector {
  readonly platform: ConnectorPlatform;

  /** True only when this connector has the app id/secret/redirect it needs. */
  isConfigured(): boolean;

  /** Builds the provider's OAuth authorization URL + a fresh CSRF state token. */
  buildAuthorizationUrl(tenantId: string): ConnectorResult<OAuthStartResult>;

  /** Exchanges the OAuth callback code for a token and persists it, encrypted. */
  handleCallback(params: OAuthCallbackParams): Promise<ConnectorResult<ConnectedAccountMetadata>>;

  /** Revokes the connection and deletes stored credentials for this tenant. */
  disconnect(tenantId: string): Promise<ConnectorResult<true>>;

  /** Re-verifies the stored token still works, updating status accordingly. */
  verifyConnection(tenantId: string): Promise<ConnectorResult<ConnectedAccountMetadata>>;

  getAccountMetadata(tenantId: string): Promise<ConnectorResult<ConnectedAccountMetadata>>;

  readAnalytics(tenantId: string, query: AnalyticsQuery): Promise<ConnectorResult<AnalyticsResult>>;

  publishContent(tenantId: string, body: unknown): Promise<ConnectorResult<{ externalId: string }>>;

  createCampaign(
    tenantId: string,
    input: CampaignDraftInput,
  ): Promise<ConnectorResult<{ externalCampaignId: string }>>;

  createAd(tenantId: string, input: AdDraftInput): Promise<ConnectorResult<{ externalAdId: string }>>;

  updateBudget(
    tenantId: string,
    campaignExternalId: string,
    dailyBudget: number,
  ): Promise<ConnectorResult<true>>;

  pauseCampaign(tenantId: string, campaignExternalId: string): Promise<ConnectorResult<true>>;
}
