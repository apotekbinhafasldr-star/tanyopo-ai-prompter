import "server-only";

import { serverEnv } from "@/lib/env";
import { isConnectorConfigured } from "@/lib/env";
import type { MetaAdAccountSnapshot } from "@/lib/connectors/meta-readiness";
import {
  evaluateMetaAccountCurrencyEvidence,
  isWellFormedMetaAdAccountId,
  type MetaCurrencyEvidence,
} from "@/lib/connectors/meta-account-evidence";
import {
  META_VERIFIED_BILLING_EVENTS,
  resolveMetaAgeTargeting,
  resolveMetaCtaType,
  resolveMetaEndTime,
} from "@/lib/connectors/meta-connector-contract";
import { META_READ_MAX_RETRIES, decideMetaRetry, isMetaThrottleError } from "@/lib/connectors/meta-rate-limit";
import {
  ConnectorApiError,
  ConnectorConfigError,
  type AdInput,
  type CampaignInput,
  type ConnectorAccount,
  type ConnectorInsights,
  type ConnectorTokenResult,
  type CreativeInput,
  type MetaAdSetInput,
  type MetaEntityStatus,
  type MetaSetStatusResult,
  type MetaValidateOnlyOption,
  type MetaValidateOnlyResult,
  type MetaWritableStatus,
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
 * follow the documented Marketing API contracts as closely as possible, but
 * treat this as a first implementation to verify against a real ad account
 * before relying on it, not as battle-tested code.
 *
 * API version: v25.0. Meta's version table (developers.facebook.com/docs/
 * graph-api/changelog/versions, accessed 2026-11-11) lists v25.0 as the latest
 * Marketing API version, and lists Marketing API v21.0 (this file's previous
 * pin) as expired on 2025-09-09, v22.0 on 2026-02-19, v23.0 on 2026-06-09 and
 * v24.0 on 2026-10-06. Meta's versioning page says a call to an unavailable
 * version "may fail or be upgraded to the next available version" and that
 * affected endpoints, such as POST /{adset-id}, fail instead. Re-check the
 * table before each upgrade; this is a constant, not a per-tenant setting.
 */

const GRAPH_API_VERSION = "v25.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const DIALOG_BASE_URL = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

const SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list"];

/**
 * Facebook Login for Business Configuration IDs are numeric. Anything else
 * (typo, stray quote, a pasted URL) is rejected instead of being sent to Meta.
 */
const LOGIN_CONFIG_ID_PATTERN = /^\d{1,32}$/;

interface GraphErrorBody {
  error?: { message: string; type?: string; code?: number; error_subcode?: number };
}

/**
 * Timeout for the four CREATE calls only (campaign, ad set, creative, ad).
 * Netlify's synchronous function limit is 60s (not configurable here) and a
 * launch makes up to four sequential create calls plus database work, so each
 * gets 10s. A timeout, or a response body that cannot be read, surfaces as a
 * ConnectorApiError WITHOUT an HTTP status, which `classifyCreateFailure`
 * treats as UNCERTAIN (Meta may have created the object). There is no
 * automatic retry anywhere on this path.
 *
 * OAuth, account/page listing, insights, pause and budget calls deliberately
 * keep their previous behaviour: no timeout, errors propagate unchanged.
 */
const CREATE_TIMEOUT_MS = 10_000;

interface GraphFetchOptions {
  /** Set only for create operations. Enables the timeout and the strict body handling below. */
  create?: boolean;
  /**
   * Opt-in timeout for a READ call (F-2a readiness check). Uses the same strict
   * body handling as `create`. Absent = the previous no-timeout behaviour.
   */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Every Graph call goes through here. NON-create calls (read, pause, budget,
 * OAuth) are retried with exponential back-off, at most META_READ_MAX_RETRIES
 * times, and only when Meta answered with a documented throttling error (see
 * lib/connectors/meta-rate-limit.ts). The four CREATE calls are never retried:
 * Meta offers no idempotency key for them and launch reconciliation relies on
 * "no automatic retry" (a throttled create is reported as not created and the
 * Owner decides).
 */
async function graphFetch<T>(path: string, init?: RequestInit, options: GraphFetchOptions = {}): Promise<T> {
  const maxRetries = options.create ? 0 : META_READ_MAX_RETRIES;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await graphFetchOnce<T>(path, init, options);
    } catch (error) {
      const decision = decideMetaRetry(error, attempt, maxRetries);
      if (!decision.retry) throw error;
      await sleep(decision.delayMs);
    }
  }
}

async function graphFetchOnce<T>(path: string, init?: RequestInit, options: GraphFetchOptions = {}): Promise<T> {
  if (!options.create && options.timeoutMs === undefined) {
    // Previous behaviour, unchanged.
    const response = await fetch(`${GRAPH_BASE_URL}${path}`, init);
    const body = (await response.json().catch(() => ({}))) as T & GraphErrorBody;
    return interpretGraphResponse(response, body);
  }

  const timeout = AbortSignal.timeout(options.create ? CREATE_TIMEOUT_MS : (options.timeoutMs as number));
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  const timedOut = () => new ConnectorApiError("META", "Meta Graph API tidak merespons tepat waktu.", {});
  const isAbort = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

  // Timeout, abort or an unreadable body: we cannot tell whether Meta created
  // the object, so no status is reported (=> UNCERTAIN, never retried). The
  // provider text is never included; no token can reach these messages.
  let response: Response;
  try {
    response = await fetch(`${GRAPH_BASE_URL}${path}`, { ...init, signal });
  } catch (error) {
    if (isAbort(error)) throw timedOut();
    throw error;
  }

  let body: T & GraphErrorBody;
  try {
    body = (await response.json()) as T & GraphErrorBody;
  } catch (error) {
    if (isAbort(error)) throw timedOut();
    throw new ConnectorApiError("META", "Respons Meta Graph API tidak dapat dibaca.", {});
  }
  return interpretGraphResponse(response, body);
}

function interpretGraphResponse<T>(response: Response, body: T & GraphErrorBody): T {
  if (!response.ok || body.error) {
    // Same message as before; the structured fields let callers log a safe
    // summary without ever touching the (provider-supplied) message.
    throw new ConnectorApiError("META", body.error?.message ?? `Meta Graph API error (HTTP ${response.status}).`, {
      status: response.status,
      code: body.error?.code,
      subcode: body.error?.error_subcode,
      type: body.error?.type,
      retryAfterSeconds: readRetryAfterSeconds(response),
    });
  }

  return body;
}

/** `Retry-After` in whole seconds, or undefined (absent, an HTTP date, or a response without readable headers). */
function readRetryAfterSeconds(response: Response): number | undefined {
  try {
    const raw = response.headers.get("retry-after");
    if (typeof raw === "string" && /^\d{1,5}$/.test(raw.trim())) return Number(raw.trim());
  } catch {
    // Not every response object exposes headers (tests, proxies): back-off then uses its own schedule.
  }
  return undefined;
}

/** F-2a: timeout for the read-only readiness lookups. */
const READINESS_TIMEOUT_MS = 10_000;
/** Graph ad-account ids look like `act_<digits>`. Anything else is never put into a request path. */
const AD_ACCOUNT_ID_PATTERN = /^act_\d{1,32}$/;
/** F-2b: how many ad accounts one listing reads (a further page is reported as `truncated`). */
const AD_ACCOUNT_LIST_LIMIT = 50;

function stripActPrefix(value: string): string {
  return value.startsWith("act_") ? value.slice(4) : value;
}

/**
 * Outcome of the read-only readiness lookup. Anything other than OK means the
 * connector did NOT pick an account: more than one discoverable ad account is
 * never resolved by taking the first.
 */
export type MetaReadinessLookup =
  | { kind: "OK"; snapshot: MetaAdAccountSnapshot }
  | { kind: "NONE" }
  | { kind: "MULTIPLE" }
  | { kind: "MISMATCH" };

interface RawReadinessAdAccount {
  id?: unknown;
  name?: unknown;
  account_status?: unknown;
  currency?: unknown;
  is_prepay_account?: unknown;
  funding_source?: unknown;
}

/** One selectable ad account (F-2b). `snapshot.minDailyBudgetRaw` is always null here. */
export interface MetaAdAccountListItem {
  id: string;
  name: string;
  snapshot: MetaAdAccountSnapshot;
}

export interface MetaAdAccountListing {
  accounts: MetaAdAccountListItem[];
  truncated: boolean;
}

/** Display name only: control characters removed, bounded, never empty. */
function safeAccountName(value: unknown): string {
  const cleaned =
    typeof value === "string"
      ? Array.from(value, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
          .join("")
          .trim()
          .slice(0, 80)
      : "";
  return cleaned.length > 0 ? cleaned : "Akun iklan tanpa nama";
}

/** Normalises one raw `/adaccounts` row. The funding source ID is reduced to a boolean here. */
function toSnapshot(row: RawReadinessAdAccount): Omit<MetaAdAccountSnapshot, "minDailyBudgetRaw"> {
  return {
    accountStatus: typeof row.account_status === "number" ? row.account_status : null,
    currency: typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null,
    isPrepayAccount: typeof row.is_prepay_account === "boolean" ? row.is_prepay_account : null,
    hasFundingSource: typeof row.funding_source === "string" && row.funding_source.length > 0 ? true : null,
  };
}

/** optimization_goal -> billing_event pairs verified in Meta's docs (REACH only). Defined in the pure contract module. */
const VERIFIED_BILLING_EVENTS = META_VERIFIED_BILLING_EVENTS;

/**
 * PR-1 (DORMANT). Added to a create body ONLY when the caller passes the
 * validate-only option. Without it the payloads are byte-identical to before.
 */
const VALIDATE_ONLY_FIELDS = { execution_options: ["validate_only"] } as const;

/**
 * A validate-only create must come back as `{ success: true }` WITHOUT an `id`.
 * Anything else (an `id` would mean the object may really have been created,
 * or an unrecognised shape) is thrown WITHOUT an HTTP status, which
 * `classifyCreateFailure` reads as UNCERTAIN. No id is ever invented.
 */
function interpretValidateOnly(result: unknown): MetaValidateOnlyResult {
  const body = typeof result === "object" && result !== null ? (result as { id?: unknown; success?: unknown }) : {};
  if (body.id === undefined && (body as { success?: unknown }).success === true) return { validated: true };
  throw new ConnectorApiError("META", "Respons validate_only Meta tidak dikenali; objek mungkin sudah dibuat.", {});
}

/** Graph object ids (campaign, ad set, ad) are numeric strings. Anything else is never put into a request path. */
const META_OBJECT_ID_PATTERN = /^\d{1,32}$/;
const META_WRITABLE_STATUSES: ReadonlySet<string> = new Set(["PAUSED", "ACTIVE", "ARCHIVED"]);
/** Status fields Meta returns are upper-case tokens such as CAMPAIGN_PAUSED. Anything else is dropped. */
const META_STATUS_TOKEN_PATTERN = /^[A-Z_]{1,64}$/;
/**
 * Graph error codes 1 (unknown) and 2 (temporary service error) do not say
 * whether a write was applied (UNVERIFIED against Meta's error reference), so
 * a status write that ends in one is UNCERTAIN, not REJECTED.
 */
const META_AMBIGUOUS_ERROR_CODES: ReadonlySet<number> = new Set([1, 2]);

function statusToken(value: unknown): string | null {
  return typeof value === "string" && META_STATUS_TOKEN_PATTERN.test(value) ? value : null;
}

/** Structured, non-sensitive fields only. Never the provider message. */
function safeErrorFields(error: ConnectorApiError): { httpStatus?: number; code?: number; subcode?: number } {
  const fields: { httpStatus?: number; code?: number; subcode?: number } = {};
  if (typeof error.status === "number" && Number.isSafeInteger(error.status)) fields.httpStatus = error.status;
  if (typeof error.code === "number" && Number.isSafeInteger(error.code)) fields.code = error.code;
  if (typeof error.subcode === "number" && Number.isSafeInteger(error.subcode)) fields.subcode = error.subcode;
  return fields;
}

/**
 * Only a definitive 4xx rejection is REJECTED. A missing HTTP status (timeout,
 * network failure, unreadable body), 2xx with an error body, 408, 429, 5xx,
 * a throttle answer or an ambiguous error code is UNCERTAIN.
 */
function classifyStatusWriteFailure(error: unknown): MetaSetStatusResult {
  if (!(error instanceof ConnectorApiError)) return { kind: "UNCERTAIN" };
  const fields = safeErrorFields(error);
  const status = error.status;
  const definitive =
    typeof status === "number" &&
    status >= 400 &&
    status <= 499 &&
    status !== 408 &&
    status !== 429 &&
    !isMetaThrottleError(error) &&
    !(fields.code !== undefined && META_AMBIGUOUS_ERROR_CODES.has(fields.code));
  return definitive ? { kind: "REJECTED", ...fields } : { kind: "UNCERTAIN", ...fields };
}

/** Read failures keep the structured fields (for back-off and logging) but never the provider text. */
function toSafeReadError(error: unknown): ConnectorApiError {
  const message = "Gagal membaca status objek Meta.";
  if (!(error instanceof ConnectorApiError)) return new ConnectorApiError("META", message, {});
  return new ConnectorApiError("META", message, {
    status: error.status,
    code: error.code,
    subcode: error.subcode,
    type: error.type,
    retryAfterSeconds: error.retryAfterSeconds,
  });
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
    url.searchParams.set("response_type", "code");

    const rawConfigId = serverEnv.meta.loginConfigId;
    if (rawConfigId === undefined) {
      // Classic Facebook Login (previous behaviour): permissions via `scope`.
      url.searchParams.set("scope", SCOPES.join(","));
      return url.toString();
    }

    // Facebook Login for Business: the Configuration (created in the Meta
    // App Dashboard) defines the permissions, so `scope` is deliberately NOT
    // sent alongside it. response_type=code + override_default_response_type
    // keeps the server-side authorization-code flow (the callback is a
    // server route and cannot see a URL fragment).
    const configId = rawConfigId.trim();
    if (!LOGIN_CONFIG_ID_PATTERN.test(configId)) {
      throw new ConnectorConfigError(
        this.platform,
        "META_LOGIN_CONFIG_ID tidak valid. Isi dengan Configuration ID numerik dari Meta App Dashboard, atau kosongkan.",
      );
    }
    url.searchParams.set("config_id", configId);
    url.searchParams.set("override_default_response_type", "true");
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

  /**
   * Track B — Facebook Pages this token has admin access to
   * (`/me/accounts`, distinct from `/me/adaccounts` above — a Page is not
   * an ad account). Not part of the shared `PlatformConnector` interface:
   * TikTok/X have no equivalent concept, and forcing one onto them would
   * mean either a fake implementation or an interface every other
   * connector has to explicitly opt out of for no reason. Callers that
   * need this import `MetaConnector` directly rather than going through
   * `getConnector()`'s platform-agnostic return type.
   */
  async getPages(accessToken: string): Promise<ConnectorAccount[]> {
    this.requireConfig();
    const result = await graphFetch<{ data: { id: string; name: string }[] }>(
      `/me/accounts?${new URLSearchParams({ fields: "id,name", access_token: accessToken })}`,
    );
    return result.data.map((p) => ({ id: p.id, name: p.name }));
  }

  /**
   * F-2a — READ-ONLY ad-account readiness lookup. Two GET calls at most; it
   * writes nothing, creates nothing and never touches budgets, so it is not a
   * budget-write call site (see tests/unit/lib/budget-write-callsites.test.ts).
   * Not part of the shared `PlatformConnector` interface, like `getPages`.
   *
   *  1. `GET /me/adaccounts?fields=id,account_status,currency,is_prepay_account,funding_source&limit=2`
   *     — `limit=2` is enough to tell "exactly one" from "more than one"; a
   *     `paging.next` also counts as more than one.
   *  2. Only when exactly one account came back AND it is the account LINOE
   *     stored at connection time: `GET /{act_id}?fields=min_daily_budget`, in
   *     its own request because it is optional — if Meta does not offer that
   *     field to this token the failure is swallowed and the value stays null,
   *     instead of failing the whole check.
   *
   * `funding_source` is requested only to learn whether one exists; its ID is
   * reduced to a boolean here and is never returned, stored or logged.
   * `funding_source_details` is deliberately NOT requested (it needs the
   * MANAGE task on the ad account and carries payment-method details).
   *
   * Errors propagate as `ConnectorApiError` (structured fields only matter:
   * see `classifyGraphFailure`).
   */
  async getAccountReadinessSnapshot(
    accessToken: string,
    expectedAdAccountId: string,
    options: { selectionConfirmed?: boolean } = {},
  ): Promise<MetaReadinessLookup> {
    this.requireConfig();
    // F-2b: with several accounts, the stored one is evaluated ONLY when the
    // Owner explicitly confirmed it (and it must still be in Meta's list).
    // Without that confirmation the F-2a behaviour is unchanged: limit=2, and
    // more than one account is MULTIPLE (never "the first one").
    const confirmed = options.selectionConfirmed === true;

    const list = await graphFetch<{ data?: RawReadinessAdAccount[]; paging?: { next?: unknown } }>(
      `/me/adaccounts?${new URLSearchParams({
        fields: "id,account_status,currency,is_prepay_account,funding_source",
        limit: confirmed ? String(AD_ACCOUNT_LIST_LIMIT) : "2",
        access_token: accessToken,
      })}`,
      undefined,
      { timeoutMs: READINESS_TIMEOUT_MS },
    );

    const rows = Array.isArray(list.data) ? list.data : [];
    if (rows.length === 0) return { kind: "NONE" };
    if (!confirmed && (rows.length > 1 || list.paging?.next)) return { kind: "MULTIPLE" };

    const expectedBare = typeof expectedAdAccountId === "string" ? stripActPrefix(expectedAdAccountId) : "";
    const row = confirmed
      ? rows.find((r) => typeof r.id === "string" && stripActPrefix(r.id) === expectedBare)
      : rows[0];
    if (!row) return { kind: "MISMATCH" };
    const id = typeof row.id === "string" ? row.id : "";
    if (
      !AD_ACCOUNT_ID_PATTERN.test(id) ||
      typeof expectedAdAccountId !== "string" ||
      stripActPrefix(id) !== stripActPrefix(expectedAdAccountId)
    ) {
      return { kind: "MISMATCH" };
    }

    let minDailyBudgetRaw: number | null = null;
    try {
      const extra = await graphFetch<{ min_daily_budget?: unknown }>(
        `/${id}?${new URLSearchParams({ fields: "min_daily_budget", access_token: accessToken })}`,
        undefined,
        { timeoutMs: READINESS_TIMEOUT_MS },
      );
      const raw = extra.min_daily_budget;
      if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) minDailyBudgetRaw = raw;
      else if (typeof raw === "string" && /^\d{1,15}$/.test(raw)) minDailyBudgetRaw = Number(raw);
    } catch {
      // Optional and informational only: never affects the readiness state.
      minDailyBudgetRaw = null;
    }

    return { kind: "OK", snapshot: { ...toSnapshot(row), minDailyBudgetRaw } };
  }

  /**
   * F-2b — READ-ONLY list of the ad accounts this token can access, for the
   * account picker. One GET (`/me/adaccounts`, up to 50). Per account it keeps
   * the id, a display name and the same normalised facts as the readiness
   * check; the funding source ID is reduced to a boolean and never returned.
   * Rows with a malformed id are dropped; duplicates are collapsed. `truncated`
   * means Meta has further pages that were not read.
   */
  async listAdAccounts(accessToken: string): Promise<MetaAdAccountListing> {
    this.requireConfig();
    const list = await graphFetch<{ data?: RawReadinessAdAccount[]; paging?: { next?: unknown } }>(
      `/me/adaccounts?${new URLSearchParams({
        fields: "id,name,account_status,currency,is_prepay_account,funding_source",
        limit: String(AD_ACCOUNT_LIST_LIMIT),
        access_token: accessToken,
      })}`,
      undefined,
      { timeoutMs: READINESS_TIMEOUT_MS },
    );

    const accounts: MetaAdAccountListItem[] = [];
    const seen = new Set<string>();
    for (const row of Array.isArray(list.data) ? list.data : []) {
      const id = typeof row.id === "string" ? row.id : "";
      if (!AD_ACCOUNT_ID_PATTERN.test(id) || seen.has(id)) continue;
      seen.add(id);
      accounts.push({ id, name: safeAccountName(row.name), snapshot: { ...toSnapshot(row), minDailyBudgetRaw: null } });
    }
    return { accounts, truncated: Boolean(list.paging?.next) };
  }

  /**
   * Phase 1C-B — READ-ONLY currency evidence for ONE ad account: a single
   * `GET /{act_id}?fields=id,currency,account_status`. It writes nothing,
   * creates nothing and touches no budget, so it is not a budget-write call
   * site. The id comes from the tenant's stored connection; a malformed id
   * never reaches a request path. The response is judged by the pure
   * `evaluateMetaAccountCurrencyEvidence`: any unexpected shape is UNVERIFIED
   * and there is no default currency. Transport errors propagate as
   * `ConnectorApiError`; the caller treats them as "not verified" and must not
   * log the provider text.
   */
  async getAdAccountCurrencyEvidence(accessToken: string, adAccountId: string): Promise<MetaCurrencyEvidence> {
    this.requireConfig();
    if (!isWellFormedMetaAdAccountId(adAccountId)) return { kind: "UNVERIFIED", reason: "ACCOUNT_ID_INVALID" };
    const raw = await graphFetch<unknown>(
      `/${adAccountId}?${new URLSearchParams({ fields: "id,currency,account_status", access_token: accessToken })}`,
      undefined,
      { timeoutMs: READINESS_TIMEOUT_MS },
    );
    return evaluateMetaAccountCurrencyEvidence(raw, adAccountId);
  }

  createCampaign(accessToken: string, adAccountId: string, input: CampaignInput, options: MetaValidateOnlyOption): Promise<MetaValidateOnlyResult>;
  createCampaign(accessToken: string, adAccountId: string, input: CampaignInput): Promise<{ id: string }>;
  async createCampaign(
    accessToken: string,
    adAccountId: string,
    input: CampaignInput,
    options?: MetaValidateOnlyOption,
  ): Promise<{ id: string } | MetaValidateOnlyResult> {
    this.requireConfig();
    const validateOnly = options?.validateOnly === true;
    const result = await graphFetch<{ id: string }>(`/${adAccountId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        objective: input.objective,
        status: "PAUSED",
        special_ad_categories: [],
        // Marketing API v24.0+: required when the budget is set on the ad set
        // (we send no campaign-level budget). "false" = no budget sharing between
        // ad sets; omitting it is rejected by Meta (error 4834011). Source:
        // developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/guides/adset-budget-sharing,
        // accessed 2026-11-11. Not yet exercised against a live account.
        is_adset_budget_sharing_enabled: false,
        ...(validateOnly ? VALIDATE_ONLY_FIELDS : {}),
        access_token: accessToken,
      }),
    }, { create: true });
    return validateOnly ? interpretValidateOnly(result) : result;
  }

  createAdSet(accessToken: string, adAccountId: string, input: MetaAdSetInput, options: MetaValidateOnlyOption): Promise<MetaValidateOnlyResult>;
  createAdSet(accessToken: string, adAccountId: string, input: MetaAdSetInput): Promise<{ id: string }>;
  async createAdSet(
    accessToken: string,
    adAccountId: string,
    input: MetaAdSetInput,
    options?: MetaValidateOnlyOption,
  ): Promise<{ id: string } | MetaValidateOnlyResult> {
    this.requireConfig();
    const validateOnly = options?.validateOnly === true;
    // No default: the goal must be chosen explicitly by the launch preflight
    // and must have a billing event verified against Meta's documentation.
    const goal = input.optimizationGoal;
    const billingEvent =
      typeof goal === "string" && Object.prototype.hasOwnProperty.call(VERIFIED_BILLING_EVENTS, goal)
        ? VERIFIED_BILLING_EVENTS[goal]
        : undefined;
    if (!billingEvent) {
      throw new ConnectorConfigError(
        this.platform,
        "Optimization goal Meta belum ditentukan atau belum terverifikasi. Ad set tidak dibuat.",
      );
    }
    // Optional age range (Phase 1B). Absent -> nothing added (unchanged). Present but
    // invalid -> refuse before any request, like the goal check above.
    const age = resolveMetaAgeTargeting(input.ageMin, input.ageMax);
    if (!age.ok) {
      throw new ConnectorConfigError(
        this.platform,
        "Rentang umur targeting tidak valid (harus bilangan bulat 18-65, minimum tidak melebihi maksimum). Ad set tidak dibuat.",
      );
    }
    // Optional planned end (UTC UNIX seconds). Absent -> nothing added (ongoing, as before).
    // Present but invalid -> refuse before any request. Only ONE budget is ever sent
    // (daily_budget): Meta's docs do not say daily and lifetime may be combined.
    const end = resolveMetaEndTime(input.endTimeUnixSeconds);
    if (!end.ok) {
      throw new ConnectorConfigError(
        this.platform,
        "Waktu berakhir ad set tidak valid (harus UNIX timestamp positif). Ad set tidak dibuat.",
      );
    }
    // PR-1 (DORMANT): an optional lifetime budget, mutually exclusive with the daily
    // budget. Meta's Ad Set reference says lifetime_budget must come with end_time;
    // whether that is a hard limit, and whether the IDR unit is what we assume, is
    // UNVERIFIED. The launch path never sets it, so the payload there is unchanged.
    let budgetFields: { daily_budget: number | undefined } | { lifetime_budget: number };
    if (input.lifetimeBudgetMinorUnits === undefined) {
      budgetFields = { daily_budget: input.dailyBudgetMinorUnits };
    } else {
      if (input.dailyBudgetMinorUnits !== undefined) {
        throw new ConnectorConfigError(
          this.platform,
          "Budget harian dan budget total tidak boleh dikirim bersamaan. Ad set tidak dibuat.",
        );
      }
      const lifetime = input.lifetimeBudgetMinorUnits;
      if (typeof lifetime !== "number" || !Number.isSafeInteger(lifetime) || lifetime < 1) {
        throw new ConnectorConfigError(this.platform, "Budget total ad set tidak valid (harus bilangan bulat positif). Ad set tidak dibuat.");
      }
      if (end.value === null) {
        throw new ConnectorConfigError(this.platform, "Budget total ad set membutuhkan waktu berakhir yang valid. Ad set tidak dibuat.");
      }
      budgetFields = { lifetime_budget: lifetime };
    }
    const result = await graphFetch<{ id: string }>(`/${adAccountId}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        campaign_id: input.campaignId,
        ...budgetFields,
        ...(end.value !== null ? { end_time: end.value } : {}),
        billing_event: billingEvent,
        optimization_goal: input.optimizationGoal,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: { geo_locations: { countries: input.targetingCountries }, ...(age.value ?? {}) },
        status: "PAUSED",
        ...(validateOnly ? VALIDATE_ONLY_FIELDS : {}),
        access_token: accessToken,
      }),
    }, { create: true });
    return validateOnly ? interpretValidateOnly(result) : result;
  }

  /**
   * Requires a Facebook Page, a landing link and an image URL. Nothing is
   * defaulted: no Tanyopo fallback link, no empty image. `picture` (a URL)
   * is the documented link_data image field; `image_url` is not one.
   * The link must equal the call-to-action link.
   */
  createCreative(accessToken: string, adAccountId: string, input: CreativeInput, options: MetaValidateOnlyOption): Promise<MetaValidateOnlyResult>;
  createCreative(accessToken: string, adAccountId: string, input: CreativeInput): Promise<{ id: string }>;
  async createCreative(
    accessToken: string,
    adAccountId: string,
    input: CreativeInput,
    options?: MetaValidateOnlyOption,
  ): Promise<{ id: string } | MetaValidateOnlyResult> {
    this.requireConfig();
    const validateOnly = options?.validateOnly === true;
    if (!input.pageId) {
      throw new ConnectorConfigError(
        this.platform,
        `Belum ada Facebook Page yang dipilih untuk membuat creative "${input.name}".`,
      );
    }
    if (!input.linkUrl) {
      throw new ConnectorConfigError(this.platform, `URL landing belum tersedia untuk creative "${input.name}".`);
    }
    if (!input.imageUrl) {
      throw new ConnectorConfigError(this.platform, `Gambar belum tersedia untuk creative "${input.name}".`);
    }

    const result = await graphFetch<{ id: string }>(`/${adAccountId}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        object_story_spec: {
          page_id: input.pageId,
          link_data: {
            message: input.primaryText,
            name: input.headline,
            link: input.linkUrl,
            picture: input.imageUrl,
            call_to_action: { type: resolveMetaCtaType(input.cta), value: { link: input.linkUrl } },
          },
        },
        ...(validateOnly ? VALIDATE_ONLY_FIELDS : {}),
        access_token: accessToken,
      }),
    }, { create: true });
    return validateOnly ? interpretValidateOnly(result) : result;
  }

  createAd(accessToken: string, adAccountId: string, input: AdInput, options: MetaValidateOnlyOption): Promise<MetaValidateOnlyResult>;
  createAd(accessToken: string, adAccountId: string, input: AdInput): Promise<{ id: string }>;
  async createAd(
    accessToken: string,
    adAccountId: string,
    input: AdInput,
    options?: MetaValidateOnlyOption,
  ): Promise<{ id: string } | MetaValidateOnlyResult> {
    this.requireConfig();
    const validateOnly = options?.validateOnly === true;
    const result = await graphFetch<{ id: string }>(`/${adAccountId}/ads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        adset_id: input.adSetId,
        creative: { creative_id: input.creativeId },
        status: "PAUSED",
        ...(validateOnly ? VALIDATE_ONLY_FIELDS : {}),
        access_token: accessToken,
      }),
    }, { create: true });
    return validateOnly ? interpretValidateOnly(result) : result;
  }

  /** `adAccountId` is unused — Meta's Graph API objects are globally addressable by id alone. */
  async getInsights(accessToken: string, _adAccountId: string, externalCampaignId: string): Promise<ConnectorInsights> {
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

  async pauseCampaign(accessToken: string, _adAccountId: string, externalCampaignId: string): Promise<void> {
    this.requireConfig();
    await graphFetch(`/${externalCampaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED", access_token: accessToken }),
    });
  }

  /**
   * PR-1 (DORMANT, no caller) — READ-ONLY status of one campaign, ad set or ad:
   * `GET /{id}?fields=status,configured_status,effective_status`. Uses the
   * existing back-off for throttled reads. Returns null when the id is not a
   * numeric Graph id (no request is made) or the answer has an unexpected
   * shape: unknown is never guessed. A failed call throws a ConnectorApiError
   * carrying only the structured fields, never the provider text.
   */
  async getEntityStatus(accessToken: string, id: string): Promise<MetaEntityStatus | null> {
    this.requireConfig();
    if (typeof id !== "string" || !META_OBJECT_ID_PATTERN.test(id)) return null;
    let raw: unknown;
    try {
      raw = await graphFetch<unknown>(
        `/${id}?${new URLSearchParams({ fields: "status,configured_status,effective_status", access_token: accessToken })}`,
        undefined,
        { timeoutMs: READINESS_TIMEOUT_MS },
      );
    } catch (error) {
      throw toSafeReadError(error);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const row = raw as { status?: unknown; configured_status?: unknown; effective_status?: unknown };
    const parsed: MetaEntityStatus = {
      status: statusToken(row.status),
      configuredStatus: statusToken(row.configured_status),
      effectiveStatus: statusToken(row.effective_status),
    };
    return parsed.status === null && parsed.configuredStatus === null && parsed.effectiveStatus === null ? null : parsed;
  }

  /**
   * PR-1 (DORMANT, no caller) — sets the status of one campaign, ad set or ad.
   * NEVER retried: it goes through the same no-retry path as the create calls
   * (`create: true`: one request, 10 s timeout). A timeout, network failure,
   * 408/429/5xx or an unrecognised answer is returned as UNCERTAIN (not
   * thrown, not repeated); a definitive 4xx is REJECTED. The provider message
   * is never returned or logged. An invalid id or status throws
   * ConnectorConfigError before any request. Setting ACTIVE starts spending:
   * a tripwire test forbids any production caller doing that.
   */
  async setEntityStatus(accessToken: string, id: string, status: MetaWritableStatus): Promise<MetaSetStatusResult> {
    this.requireConfig();
    if (typeof id !== "string" || !META_OBJECT_ID_PATTERN.test(id)) {
      throw new ConnectorConfigError(this.platform, "ID objek Meta tidak valid. Status tidak diubah.");
    }
    if (typeof status !== "string" || !META_WRITABLE_STATUSES.has(status)) {
      throw new ConnectorConfigError(this.platform, "Status Meta tidak dikenali. Status tidak diubah.");
    }
    let body: unknown;
    try {
      body = await graphFetch<unknown>(
        `/${id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, access_token: accessToken }),
        },
        { create: true },
      );
    } catch (error) {
      return classifyStatusWriteFailure(error);
    }
    const applied = typeof body === "object" && body !== null && (body as { success?: unknown }).success === true;
    return applied ? { kind: "APPLIED" } : { kind: "UNCERTAIN" };
  }

  /** PR-1 (DORMANT, no caller) — pauses an ad, ad set or campaign by id. Same semantics as `setEntityStatus` with PAUSED. */
  async pauseObject(accessToken: string, id: string): Promise<MetaSetStatusResult> {
    return this.setEntityStatus(accessToken, id, "PAUSED");
  }

  /** Assumes Campaign Budget Optimization is enabled — sets budget at the campaign level. */
  async updateBudget(
    accessToken: string,
    _adAccountId: string,
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
