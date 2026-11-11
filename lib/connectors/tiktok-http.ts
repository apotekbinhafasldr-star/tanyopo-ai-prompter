import { ConnectorApiError } from "@/lib/connectors/types";

/**
 * Shared HTTP + error-mapping layer for the TikTok connectors.
 *
 * TikTok exposes TWO unrelated API families, and both go through here:
 *   - Open API v2 (open.tiktokapis.com): Login Kit, Content Posting API.
 *   - Marketing API (business-api.tiktok.com): ads.
 * This file knows nothing about either one's endpoints; it only provides
 * (a) a bounded retry policy, (b) a structured error with a stable `kind`,
 * and (c) parsers for the two response envelopes.
 *
 * Retry policy (deliberately conservative — a replayed write can duplicate
 * an object or a post):
 *   - HTTP 429: the request was refused, so it is always safe to retry.
 *   - HTTP 5xx / network error / timeout: retried ONLY when the caller marks
 *     the request `idempotent` (reads, token refresh, status polling). For a
 *     create call the outcome is unknown, so it is NOT replayed.
 *   - At most `maxAttempts` (default 3) tries, exponential backoff, honouring
 *     `Retry-After` when TikTok sends it. Nothing else is ever retried.
 *
 * Messages never include request data (URLs carry secrets in some Marketing
 * API calls). Only TikTok's own error text and `log_id` are kept.
 */

export type TikTokErrorKind =
  /** Access token invalid/expired: refresh, or reconnect if refresh fails. */
  | "AUTH_EXPIRED"
  /** Refresh token rejected/expired (or the refresh call was refused): the user must reconnect. */
  | "REFRESH_REJECTED"
  /** The user did not grant a scope the call needs. */
  | "SCOPE_MISSING"
  | "RATE_LIMITED"
  /** Content Posting: daily post / pending-share / active-user cap reached. */
  | "DAILY_CAP"
  /** Content Posting: client not audited, only private (SELF_ONLY) posting is allowed. */
  | "UNAUDITED_CLIENT"
  /** Content Posting: creator cannot post (banned). Do not retry. */
  | "USER_BANNED"
  /** Content Posting: PULL_FROM_URL domain/prefix is not verified in the developer portal. */
  | "URL_UNVERIFIED"
  /** Content Posting: privacy_level not in the creator's options. */
  | "PRIVACY_MISMATCH"
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "SERVER_ERROR"
  /** No HTTP answer (DNS, reset, timeout) or an unreadable body. */
  | "NETWORK"
  | "UNKNOWN";

const USER_MESSAGES: Record<TikTokErrorKind, string> = {
  AUTH_EXPIRED: "Sesi TikTok sudah tidak berlaku. Hubungkan ulang akun TikTok.",
  REFRESH_REJECTED: "Izin TikTok sudah kedaluwarsa atau dicabut. Hubungkan ulang akun TikTok.",
  SCOPE_MISSING: "Izin (scope) TikTok yang dibutuhkan belum diberikan. Hubungkan ulang dan setujui semua izin.",
  RATE_LIMITED: "TikTok membatasi jumlah permintaan. Coba lagi beberapa saat lagi.",
  DAILY_CAP: "Batas harian TikTok tercapai. Coba lagi besok.",
  UNAUDITED_CLIENT: "Aplikasi belum lolos audit TikTok Content Posting; hanya posting privat (SELF_ONLY) yang diizinkan.",
  USER_BANNED: "Akun TikTok ini tidak diizinkan memposting.",
  URL_UNVERIFIED: "Domain video belum diverifikasi di TikTok Developer Portal.",
  PRIVACY_MISMATCH: "Pengaturan privasi tidak sesuai pilihan yang diizinkan akun TikTok ini.",
  INVALID_REQUEST: "Permintaan ke TikTok tidak valid.",
  FORBIDDEN: "TikTok menolak permintaan ini.",
  SERVER_ERROR: "Server TikTok sedang bermasalah. Coba lagi nanti.",
  NETWORK: "TikTok tidak dapat dihubungi atau tidak merespons tepat waktu.",
  UNKNOWN: "TikTok mengembalikan kesalahan yang tidak dikenali.",
};

/** Stable Indonesian text for a kind (never contains provider text). */
export function tiktokUserMessage(kind: TikTokErrorKind): string {
  return USER_MESSAGES[kind];
}

const RECONNECT_KINDS: ReadonlySet<TikTokErrorKind> = new Set<TikTokErrorKind>([
  "AUTH_EXPIRED",
  "REFRESH_REJECTED",
  "SCOPE_MISSING",
]);

/**
 * A failed TikTok call. Extends `ConnectorApiError` so existing handlers
 * (`instanceof ConnectorApiError`, `describeSafeError`) keep working:
 * `status` is the HTTP status, `code` TikTok's own code, `type` the `kind`.
 * `message` is TikTok's text (display only — never log it).
 */
export class TikTokApiError extends ConnectorApiError {
  readonly kind: TikTokErrorKind;
  readonly logId?: string;

  constructor(
    message: string,
    details: { kind: TikTokErrorKind; status?: number; code?: number | string; logId?: string },
  ) {
    super("TIKTOK", message, { status: details.status, code: details.code, type: details.kind });
    this.name = "TikTokApiError";
    this.kind = details.kind;
    this.logId = details.logId;
  }

  /** True when waiting and replaying the same call may succeed. */
  get retryable(): boolean {
    return this.kind === "RATE_LIMITED" || this.kind === "SERVER_ERROR" || this.kind === "NETWORK";
  }

  /** True when only a new OAuth consent by the user can fix this. */
  get requiresReconnect(): boolean {
    return RECONNECT_KINDS.has(this.kind);
  }
}

/** Maps TikTok's string codes (Open API v2) and HTTP status to a kind. */
export function classifyTikTokError(input: { status?: number; code?: number | string }): TikTokErrorKind {
  const code = typeof input.code === "string" ? input.code.toLowerCase() : undefined;
  switch (code) {
    case "access_token_invalid":
      return "AUTH_EXPIRED";
    case "invalid_grant":
      return "REFRESH_REJECTED";
    case "scope_not_authorized":
    case "scope_permission_missed":
      return "SCOPE_MISSING";
    case "rate_limit_exceeded":
      return "RATE_LIMITED";
    case "spam_risk_too_many_posts":
    case "spam_risk_too_many_pending_share":
    case "reached_active_user_cap":
      return "DAILY_CAP";
    case "unaudited_client_can_only_post_to_private_accounts":
      return "UNAUDITED_CLIENT";
    case "spam_risk_user_banned_from_posting":
      return "USER_BANNED";
    case "url_ownership_unverified":
      return "URL_UNVERIFIED";
    case "privacy_level_option_mismatch":
      return "PRIVACY_MISMATCH";
    case "invalid_param":
    case "invalid_params":
    case "invalid_request":
    case "invalid_file_upload":
      return "INVALID_REQUEST";
    case "internal_error":
      return "SERVER_ERROR";
    default:
      break;
  }
  const status = input.status;
  if (status === 429) return "RATE_LIMITED";
  if (status === 401) return "AUTH_EXPIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 400) return "INVALID_REQUEST";
  if (status !== undefined && status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

export interface TikTokHttpOptions {
  /** Safe to replay after a 5xx / network error (reads, refresh, status polling). Default false. */
  idempotent?: boolean;
  /** Total tries including the first. Default 3, hard-capped at 5. */
  maxAttempts?: number;
  /** Per-try timeout. Default 20 s. */
  timeoutMs?: number;
  /** First backoff step. Default 500 ms (doubles each try). */
  baseDelayMs?: number;
  /** Backoff / Retry-After ceiling. Default 8 s. */
  maxDelayMs?: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const HARD_MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Delay before try number `attempt + 1`. `Retry-After` (seconds) wins, capped by `maxMs`. */
export function computeRetryDelayMs(
  attempt: number,
  retryAfter: string | null | undefined,
  baseMs = DEFAULT_BASE_DELAY_MS,
  maxMs = DEFAULT_MAX_DELAY_MS,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxMs);
  }
  return Math.min(baseMs * 2 ** (Math.max(1, attempt) - 1), maxMs);
}

export interface TikTokHttpResult {
  status: number;
  ok: boolean;
  /** Parsed JSON, or `undefined` when the body was empty/unreadable. */
  body: unknown;
}

/**
 * One logical request with the bounded retry policy above. Resolves with the
 * final HTTP answer (including 4xx/5xx — the caller maps those with the
 * envelope parsers) and throws `TikTokApiError(NETWORK)` only when no answer
 * could be obtained.
 */
export async function tiktokHttp(url: string, init: RequestInit, options: TikTokHttpOptions = {}): Promise<TikTokHttpResult> {
  const maxAttempts = Math.min(Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS), HARD_MAX_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = options.sleep ?? realSleep;
  const idempotent = options.idempotent === true;
  const delay = (attempt: number, retryAfter?: string | null) =>
    computeRetryDelayMs(attempt, retryAfter, options.baseDelayMs, options.maxDelayMs);

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      if (idempotent && attempt < maxAttempts) {
        await sleep(delay(attempt));
        continue;
      }
      throw new TikTokApiError(tiktokUserMessage("NETWORK"), { kind: "NETWORK" });
    }

    const retryableStatus = response.status === 429 || (idempotent && response.status >= 500);
    if (retryableStatus && attempt < maxAttempts) {
      await sleep(delay(attempt, response.headers?.get?.("retry-after")));
      continue;
    }

    const body: unknown = await response.json().catch(() => undefined);
    return { status: response.status, ok: response.ok, body };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Open API v2 body. Two shapes exist:
 *   - OAuth token/revoke: failure is `{ error, error_description, log_id }`.
 *   - Everything else: `{ data, error: { code, message, log_id } }` where
 *     `code === "ok"` means success (even on HTTP 200).
 * Returns the `data` object on success, throws `TikTokApiError` otherwise.
 */
export function unwrapOpenApi(result: TikTokHttpResult): Record<string, unknown> {
  const body = asRecord(result.body);
  const errorField = body.error;

  let code: string | undefined;
  let message: string | undefined;
  let logId: string | undefined;

  if (typeof errorField === "string") {
    code = errorField;
    message = str(body.error_description);
    logId = str(body.log_id);
  } else {
    const errorObject = asRecord(errorField);
    code = str(errorObject.code);
    message = str(errorObject.message);
    logId = str(errorObject.log_id);
  }

  const failed = !result.ok || (code !== undefined && code.toLowerCase() !== "ok");
  if (failed) {
    const kind = classifyTikTokError({ status: result.status, code });
    throw new TikTokApiError(message ?? tiktokUserMessage(kind), { kind, status: result.status, code, logId });
  }

  // OAuth token responses are flat (no `data` wrapper).
  return "data" in body ? asRecord(body.data) : body;
}

/**
 * Marketing API envelope: `{ code: number, message, request_id, data }`,
 * `code === 0` is success. Only the HTTP status is used for classification:
 * TikTok's official Marketing API error-code table could not be reached when
 * this was written (see docs/TIKTOK_INTEGRATION.md), so numeric codes are
 * carried through verbatim but not interpreted.
 */
export function unwrapMarketing(result: TikTokHttpResult): Record<string, unknown> {
  const body = asRecord(result.body);
  const code = typeof body.code === "number" ? body.code : undefined;

  if (!result.ok || code !== 0) {
    const kind = classifyTikTokError({ status: result.status });
    throw new TikTokApiError(str(body.message) ?? tiktokUserMessage(kind), {
      kind: !result.ok ? kind : "UNKNOWN",
      status: result.status,
      code,
      logId: str(body.request_id),
    });
  }
  return asRecord(body.data);
}
