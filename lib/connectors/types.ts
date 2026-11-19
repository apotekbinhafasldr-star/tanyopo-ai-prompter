/**
 * Vendor-neutral ad-platform connector contract (product spec §28-30).
 * Every connector method that touches an external API is only ever called
 * after the caller has confirmed the connector `isConfigured()` and the
 * tenant has a live connection — a method called without that returns a
 * `ConnectorConfigError`, never a simulated success.
 */

import type { MetaCurrencyEvidence } from "@/lib/connectors/meta-account-evidence";

export class ConnectorConfigError extends Error {
  constructor(
    public readonly platform: string,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorConfigError";
  }
}

/**
 * A failed call to a platform's HTTP API. The human-readable `message` is the
 * provider's own text and may echo request data, so it is for the caller to
 * show or branch on and must NEVER be written to logs. Only the structured,
 * non-sensitive fields below are safe to log (see
 * lib/connectors/safe-error-log.ts).
 */
export class ConnectorApiError extends Error {
  readonly status?: number;
  readonly code?: number | string;
  readonly subcode?: number | string;
  readonly type?: string;
  /** Seconds from a `Retry-After` response header, when the provider sent one. Used only for back-off. */
  readonly retryAfterSeconds?: number;

  constructor(
    public readonly platform: string,
    message: string,
    details: {
      status?: number;
      code?: number | string;
      subcode?: number | string;
      type?: string;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "ConnectorApiError";
    this.status = details.status;
    this.code = details.code;
    this.subcode = details.subcode;
    this.type = details.type;
    this.retryAfterSeconds = details.retryAfterSeconds;
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
  /**
   * Explicit optimization goal chosen by the launch preflight. Meta's
   * connector refuses to create an ad set without one (and without a
   * verified billing-event pairing) instead of defaulting.
   */
  optimizationGoal?: string;
  /**
   * Meta only (Phase 1B), both or neither: an inclusive age range for targeting.
   * Other connectors ignore it. When omitted nothing is added to the request.
   */
  ageMin?: number;
  ageMax?: number;
  /**
   * Meta only: ad-set end time as UTC UNIX seconds (the planned run length, so a
   * daily budget cannot keep spending past it). Omitted = ongoing, as before.
   */
  endTimeUnixSeconds?: number;
  /**
   * Meta only (PR-1, DORMANT: no launch path sets it). Lifetime budget in minor
   * units, mutually exclusive with `dailyBudgetMinorUnits`: both at once is
   * refused before any request, and a lifetime budget needs a valid
   * `endTimeUnixSeconds`. Other connectors ignore it. To use it without a daily
   * budget, call `MetaConnector.createAdSet`, whose input type is `MetaAdSetInput`.
   */
  lifetimeBudgetMinorUnits?: number;
}

/**
 * Input accepted by `MetaConnector.createAdSet`: an `AdSetInput` whose daily
 * budget may be left out (only when `lifetimeBudgetMinorUnits` is used). Every
 * `AdSetInput` is also a valid `MetaAdSetInput`.
 */
export type MetaAdSetInput = Omit<AdSetInput, "dailyBudgetMinorUnits"> & { dailyBudgetMinorUnits?: number };

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
 * Meta only (PR-1, DORMANT). Pass `{ validateOnly: true }` as the extra argument
 * of a `MetaConnector.create*` method to send `execution_options: ["validate_only"]`.
 * Nothing in the launch path passes it.
 */
export interface MetaValidateOnlyOption {
  readonly validateOnly: true;
}

/**
 * Result of a validate-only create: Meta answered `{ success: true }` and
 * created NOTHING. There is deliberately no `id` here, and no id is ever invented.
 */
export interface MetaValidateOnlyResult {
  readonly validated: true;
}

/** Status values a Meta object may be set to. Nothing in production code may pass "ACTIVE" (tripwire test). */
export type MetaWritableStatus = "PAUSED" | "ACTIVE" | "ARCHIVED";

/** Raw Meta status fields of one object (campaign, ad set or ad). A field is null when absent or not a plain upper-case token. */
export interface MetaEntityStatus {
  status: string | null;
  configuredStatus: string | null;
  effectiveStatus: string | null;
}

/**
 * Outcome of a status write. Only structured, non-sensitive fields are carried;
 * the provider's message is never returned.
 *  - APPLIED: Meta answered `{ success: true }`.
 *  - REJECTED: Meta definitively refused (4xx other than 408/429); nothing changed.
 *  - UNCERTAIN: timeout, network failure, 408/429/5xx, or an unrecognised answer.
 *    The write may or may not have happened; it is NOT retried. Re-read the status.
 */
export type MetaSetStatusResult =
  | { kind: "APPLIED" }
  | { kind: "REJECTED"; httpStatus?: number; code?: number; subcode?: number }
  | { kind: "UNCERTAIN"; httpStatus?: number; code?: number; subcode?: number };

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

  /**
   * `adAccountId` is required here (not just on the create* methods)
   * because not every platform's objects are globally addressable by id
   * alone — Meta's Graph API is, but TikTok's and X's ad-management APIs
   * scope nearly every endpoint under the advertiser/account id. Meta's
   * implementation simply ignores the parameter.
   */
  getInsights(accessToken: string, adAccountId: string, externalCampaignId: string): Promise<ConnectorInsights>;
  pauseCampaign(accessToken: string, adAccountId: string, externalCampaignId: string): Promise<void>;

  /**
   * Meta only (PR-1, DORMANT, no caller in the launch path). All three are
   * optional so the TikTok/X connectors and existing mocks stay valid.
   * `getEntityStatus` is read-only; `setEntityStatus` is never retried;
   * `pauseObject` works on an ad, ad set or campaign id.
   */
  getEntityStatus?(accessToken: string, id: string): Promise<MetaEntityStatus | null>;
  setEntityStatus?(accessToken: string, id: string, status: MetaWritableStatus): Promise<MetaSetStatusResult>;
  pauseObject?(accessToken: string, id: string): Promise<MetaSetStatusResult>;

  /**
   * Meta only (Phase 1C-B). READ-ONLY currency evidence for one ad account.
   * Optional: a connector without it can never produce VERIFIED evidence.
   */
  getAdAccountCurrencyEvidence?(accessToken: string, adAccountId: string): Promise<MetaCurrencyEvidence>;
  updateBudget(
    accessToken: string,
    adAccountId: string,
    externalCampaignId: string,
    dailyBudgetMinorUnits: number,
  ): Promise<void>;
}
