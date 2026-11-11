import {
  TikTokApiError,
  tiktokHttp,
  tiktokUserMessage,
  unwrapOpenApi,
  type TikTokHttpOptions,
} from "@/lib/connectors/tiktok-http";

/**
 * TikTok Open API v2 client: Login Kit (OAuth + user info) and the Content
 * Posting API (Direct Post / Upload-to-inbox). This is NOT the Marketing/Ads
 * API — that is lib/connectors/tiktok-connector.ts. The two products use
 * different apps, credentials (Open API: `client_key`/`client_secret`;
 * Marketing: `app_id`/`secret`), hosts and token types, so they never share
 * a token or code path.
 *
 * Status: CODE READY + UNIT TEST PASS only. Nothing registers or calls this
 * client yet (no UI, no route, no connector registration), it has never run
 * against TikTok, and using it for real is EXTERNAL BLOCKED on TikTok
 * (app review, scope approval, and — for public posts — the Content Posting
 * audit). See docs/TIKTOK_INTEGRATION.md.
 *
 * Sources (accessed 2026-11-11), all https://developers.tiktok.com/doc/ :
 *   login-kit-web, oauth-user-access-token-management,
 *   content-posting-api-get-started, content-posting-api-reference-direct-post,
 *   content-posting-api-reference-upload-video,
 *   content-posting-api-reference-query-creator-info,
 *   content-posting-api-reference-get-video-status,
 *   content-posting-api-media-transfer-guide, content-sharing-guidelines,
 *   tiktok-api-v2-error-handling.
 *
 * Safety rails encoded here:
 *   - Publishing is SELF_ONLY unless the caller passes `clientAudited: true`
 *     (TikTok restricts unaudited clients to private posts and blocks the
 *     rest at /publish/video/init/ anyway; failing locally saves a call).
 *   - An audited Direct Post never defaults a privacy level (TikTok's audit
 *     rules forbid a pre-selected one): the caller must supply it and it must
 *     be one of the creator's `privacy_level_options`.
 */

export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_OPEN_API_BASE = "https://open.tiktokapis.com";

export const TIKTOK_SCOPES = {
  /** Login Kit identity (open_id, display name, avatar). */
  USER_INFO_BASIC: "user.info.basic",
  /** Content Posting API, Upload (send to the creator's inbox as a draft). */
  VIDEO_UPLOAD: "video.upload",
  /** Content Posting API, Direct Post (requires TikTok approval + audit for public posts). */
  VIDEO_PUBLISH: "video.publish",
} as const;

export type TikTokScope = (typeof TIKTOK_SCOPES)[keyof typeof TIKTOK_SCOPES];
export type TikTokCapability = "LOGIN" | "UPLOAD_INBOX" | "DIRECT_POST";

const SCOPES_BY_CAPABILITY: Record<TikTokCapability, readonly TikTokScope[]> = {
  LOGIN: [TIKTOK_SCOPES.USER_INFO_BASIC],
  UPLOAD_INBOX: [TIKTOK_SCOPES.USER_INFO_BASIC, TIKTOK_SCOPES.VIDEO_UPLOAD],
  DIRECT_POST: [TIKTOK_SCOPES.USER_INFO_BASIC, TIKTOK_SCOPES.VIDEO_PUBLISH],
};

/** Minimal scope list for a capability. Request only what the feature needs. */
export function scopesForCapability(capability: TikTokCapability): TikTokScope[] {
  return [...SCOPES_BY_CAPABILITY[capability]];
}

export interface TikTokOpenApiConfig {
  /** Login Kit "Client key" (called `client_key` on the wire). */
  clientKey: string;
  clientSecret: string;
  /** Must exactly match a redirect URI registered in the developer portal (https, no query/fragment). */
  redirectUri: string;
}

/**
 * Login Kit authorize URL. Unlike the old Marketing-API URL this MUST carry
 * `scope` (comma-separated) and `response_type=code`. The web flow needs no
 * PKCE (`code_verifier` is documented for mobile/desktop only).
 */
export function buildTikTokAuthorizeUrl(input: {
  clientKey: string;
  redirectUri: string;
  state: string;
  scopes: readonly string[];
}): string {
  if (input.scopes.length === 0) {
    throw new TikTokApiError("Daftar scope TikTok tidak boleh kosong.", { kind: "INVALID_REQUEST" });
  }
  const known = new Set<string>(Object.values(TIKTOK_SCOPES));
  for (const scope of input.scopes) {
    if (!known.has(scope)) {
      throw new TikTokApiError(`Scope TikTok tidak dikenal: ${scope.slice(0, 40)}`, { kind: "INVALID_REQUEST" });
    }
  }
  let redirect: URL;
  try {
    redirect = new URL(input.redirectUri);
  } catch {
    throw new TikTokApiError("TIKTOK_REDIRECT_URI bukan URL yang valid.", { kind: "INVALID_REQUEST" });
  }
  if (redirect.protocol !== "https:" || redirect.search !== "" || redirect.hash !== "") {
    throw new TikTokApiError("TIKTOK_REDIRECT_URI harus https tanpa query atau fragment.", { kind: "INVALID_REQUEST" });
  }

  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set("client_key", input.clientKey);
  url.searchParams.set("scope", input.scopes.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** `scope` on the token response / redirect is a comma-separated string. */
export function parseGrantedScopes(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  const have = new Set(granted);
  return required.filter((scope) => !have.has(scope));
}

export interface TikTokTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** TikTok user id for this app; stable, used as the external account id. */
  openId?: string;
  /** Access token expiry (docs: 24 h). */
  expiresAt?: Date;
  /** Refresh token expiry (docs: 365 days). After this the user must reconnect. */
  refreshExpiresAt?: Date;
  scopes: string[];
}

function toTokenSet(data: Record<string, unknown>, now: Date): TikTokTokenSet {
  const accessToken = typeof data.access_token === "string" ? data.access_token : undefined;
  if (!accessToken) {
    throw new TikTokApiError("Respons token TikTok tidak berisi access_token.", { kind: "UNKNOWN" });
  }
  const at = (seconds: unknown) =>
    typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
      ? new Date(now.getTime() + seconds * 1000)
      : undefined;
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    openId: typeof data.open_id === "string" ? data.open_id : undefined,
    expiresAt: at(data.expires_in),
    refreshExpiresAt: at(data.refresh_expires_in),
    scopes: parseGrantedScopes(data.scope),
  };
}

export type TikTokPrivacyLevel = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

export interface TikTokCreatorInfo {
  creatorUsername?: string;
  creatorNickname?: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec?: number;
}

export type TikTokPublishStatus =
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED"
  | "UNKNOWN";

export interface TikTokPublishStatusResult {
  status: TikTokPublishStatus;
  failReason?: string;
  /** From `publicaly_available_post_id` (unverified field name) when the post is public. */
  postIds: string[];
  /** True when replaying the publish could succeed (TikTok `internal`, pull failures). */
  retryable: boolean;
  terminal: boolean;
}

/** fail_reason values TikTok documents as temporary/retryable. */
const RETRYABLE_FAIL_REASONS: ReadonlySet<string> = new Set(["internal", "video_pull_failed", "photo_pull_failed"]);

export interface ChunkPlan {
  chunkSize: number;
  totalChunkCount: number;
  /** Inclusive byte ranges, in upload order (chunks must be sent sequentially). */
  ranges: { start: number; end: number }[];
}

const MIN_CHUNK = 5 * 1024 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;
const MAX_CHUNKS = 1000;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * Splits `totalBytes` per the media-transfer guide: under 5 MB goes in one
 * request; otherwise chunks are 5-64 MB, `total_chunk_count` is
 * floor(size / chunk_size) and the LAST chunk absorbs the remainder (up to
 * 128 MB). Max 1000 chunks, max video 4 GB.
 */
export function planChunks(totalBytes: number, preferredChunkSize = 10 * 1024 * 1024): ChunkPlan {
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) {
    throw new TikTokApiError("Ukuran video tidak valid.", { kind: "INVALID_REQUEST" });
  }
  if (totalBytes > MAX_VIDEO_BYTES) {
    throw new TikTokApiError("Video melebihi batas 4 GB TikTok.", { kind: "INVALID_REQUEST" });
  }
  if (totalBytes < MIN_CHUNK) {
    return { chunkSize: totalBytes, totalChunkCount: 1, ranges: [{ start: 0, end: totalBytes - 1 }] };
  }

  const chunkSize = Math.min(Math.max(Math.floor(preferredChunkSize), MIN_CHUNK), MAX_CHUNK);
  const totalChunkCount = Math.floor(totalBytes / chunkSize);
  if (totalChunkCount > MAX_CHUNKS) {
    throw new TikTokApiError("Video terlalu besar untuk ukuran chunk ini (maks 1000 chunk).", { kind: "INVALID_REQUEST" });
  }

  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < totalChunkCount; i++) {
    const start = i * chunkSize;
    const end = i === totalChunkCount - 1 ? totalBytes - 1 : start + chunkSize - 1;
    ranges.push({ start, end });
  }
  return { chunkSize, totalChunkCount, ranges };
}

/**
 * Chooses the privacy level for a Direct Post.
 *  - Unaudited client: always SELF_ONLY (TikTok rule), and the creator must
 *    offer it.
 *  - Audited client: `requested` is mandatory (no default), and must be one
 *    of the creator's current `privacy_level_options`.
 */
export function resolvePrivacyLevel(input: {
  requested?: string;
  creatorOptions: readonly string[];
  clientAudited: boolean;
}): TikTokPrivacyLevel {
  if (!input.clientAudited) {
    if (!input.creatorOptions.includes("SELF_ONLY")) {
      throw new TikTokApiError(tiktokUserMessage("PRIVACY_MISMATCH"), { kind: "PRIVACY_MISMATCH" });
    }
    return "SELF_ONLY";
  }
  if (!input.requested) {
    throw new TikTokApiError("Pilih tingkat privasi secara eksplisit (tidak ada nilai bawaan).", {
      kind: "INVALID_REQUEST",
    });
  }
  if (!input.creatorOptions.includes(input.requested)) {
    throw new TikTokApiError(tiktokUserMessage("PRIVACY_MISMATCH"), { kind: "PRIVACY_MISMATCH" });
  }
  return input.requested as TikTokPrivacyLevel;
}

/** Everything needed to decide whether a stored token must be refreshed first. */
export interface StoredTikTokTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
}

const DEFAULT_REFRESH_SKEW_SECONDS = 300;

/** True when the access token is expired or within `skewSeconds` of expiring. Unknown expiry is treated as valid. */
export function accessTokenNeedsRefresh(
  tokens: Pick<StoredTikTokTokens, "expiresAt">,
  now: Date = new Date(),
  skewSeconds = DEFAULT_REFRESH_SKEW_SECONDS,
): boolean {
  if (!tokens.expiresAt) return false;
  return tokens.expiresAt.getTime() - skewSeconds * 1000 <= now.getTime();
}

export class TikTokOpenApiClient {
  constructor(
    private readonly config: TikTokOpenApiConfig,
    private readonly http: TikTokHttpOptions = {},
  ) {}

  private form(params: Record<string, string>): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    };
  }

  private bearerJson(accessToken: string, body: unknown): RequestInit {
    return {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    };
  }

  private bearerGet(accessToken: string): RequestInit {
    return { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } };
  }

  /** Authorization-code exchange. Not retried on 5xx: the code is single-use. */
  async exchangeCode(code: string, now: Date = new Date()): Promise<TikTokTokenSet> {
    const result = await tiktokHttp(
      `${TIKTOK_OPEN_API_BASE}/v2/oauth/token/`,
      this.form({
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
      }),
      { ...this.http, idempotent: false },
    );
    return toTokenSet(unwrapOpenApi(result), now);
  }

  /**
   * Refresh-token grant. TikTok may return a DIFFERENT refresh token: the
   * caller must persist the returned one (refresh tokens rotate). When the
   * response omits `refresh_token` the previous one is kept. A refused
   * refresh (invalid/expired refresh token, revoked grant) is reported as
   * `REFRESH_REJECTED` => the user must reconnect.
   */
  async refresh(refreshToken: string, now: Date = new Date()): Promise<TikTokTokenSet> {
    let data: Record<string, unknown>;
    try {
      const result = await tiktokHttp(
        `${TIKTOK_OPEN_API_BASE}/v2/oauth/token/`,
        this.form({
          client_key: this.config.clientKey,
          client_secret: this.config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        { ...this.http, idempotent: true },
      );
      data = unwrapOpenApi(result);
    } catch (error) {
      if (error instanceof TikTokApiError && ["AUTH_EXPIRED", "INVALID_REQUEST", "UNKNOWN", "FORBIDDEN"].includes(error.kind)) {
        throw new TikTokApiError(error.message, {
          kind: "REFRESH_REJECTED",
          status: error.status,
          code: error.code,
          logId: error.logId,
        });
      }
      throw error;
    }
    const tokens = toTokenSet(data, now);
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
  }

  /**
   * Returns usable tokens, refreshing first when the access token is
   * expired/near expiry. `refreshed` tells the caller to persist the result
   * (encrypted, tenant-scoped) before using it; the old refresh token is no
   * longer guaranteed valid once a refresh succeeded.
   */
  async ensureFreshTokens(
    tokens: StoredTikTokTokens,
    now: Date = new Date(),
  ): Promise<{ tokens: StoredTikTokTokens; refreshed: boolean }> {
    if (!accessTokenNeedsRefresh(tokens, now)) return { tokens, refreshed: false };

    if (!tokens.refreshToken || (tokens.refreshExpiresAt && tokens.refreshExpiresAt.getTime() <= now.getTime())) {
      throw new TikTokApiError(tiktokUserMessage("REFRESH_REJECTED"), { kind: "REFRESH_REJECTED" });
    }
    const next = await this.refresh(tokens.refreshToken, now);
    return {
      tokens: {
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        expiresAt: next.expiresAt ?? null,
        refreshExpiresAt: next.refreshExpiresAt ?? tokens.refreshExpiresAt ?? null,
      },
      refreshed: true,
    };
  }

  /** Revokes the access token (empty body on success). */
  async revoke(accessToken: string): Promise<void> {
    const result = await tiktokHttp(
      `${TIKTOK_OPEN_API_BASE}/v2/oauth/revoke/`,
      this.form({ client_key: this.config.clientKey, client_secret: this.config.clientSecret, token: accessToken }),
      { ...this.http, idempotent: true },
    );
    unwrapOpenApi(result);
  }

  /** Login Kit identity. `open_id` is the account id to store. */
  async getUserInfo(accessToken: string): Promise<{ openId: string; displayName?: string }> {
    const result = await tiktokHttp(
      `${TIKTOK_OPEN_API_BASE}/v2/user/info/?${new URLSearchParams({ fields: "open_id,display_name" })}`,
      this.bearerGet(accessToken),
      { ...this.http, idempotent: true },
    );
    const data = unwrapOpenApi(result);
    const user = (typeof data.user === "object" && data.user !== null ? data.user : {}) as Record<string, unknown>;
    if (typeof user.open_id !== "string" || !user.open_id) {
      throw new TikTokApiError("Respons user info TikTok tidak berisi open_id.", { kind: "UNKNOWN" });
    }
    return {
      openId: user.open_id,
      displayName: typeof user.display_name === "string" ? user.display_name : undefined,
    };
  }

  /** Limit: 20 requests/min per user token. Required before rendering a Direct Post screen. */
  async queryCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
    const result = await tiktokHttp(
      `${TIKTOK_OPEN_API_BASE}/v2/post/publish/creator_info/query/`,
      this.bearerJson(accessToken, {}),
      { ...this.http, idempotent: true },
    );
    const data = unwrapOpenApi(result);
    return {
      creatorUsername: typeof data.creator_username === "string" ? data.creator_username : undefined,
      creatorNickname: typeof data.creator_nickname === "string" ? data.creator_nickname : undefined,
      privacyLevelOptions: Array.isArray(data.privacy_level_options)
        ? data.privacy_level_options.filter((o): o is string => typeof o === "string")
        : [],
      commentDisabled: data.comment_disabled === true,
      duetDisabled: data.duet_disabled === true,
      stitchDisabled: data.stitch_disabled === true,
      maxVideoPostDurationSec:
        typeof data.max_video_post_duration_sec === "number" ? data.max_video_post_duration_sec : undefined,
    };
  }

  /**
   * Starts an Upload-to-inbox post (`video.upload`; the creator finishes and
   * publishes in TikTok; max 5 pending shares / 24 h; 6 init requests/min).
   * Not retried on 5xx: the outcome of an init is unknown.
   */
  async initInboxUpload(
    accessToken: string,
    source: { kind: "FILE_UPLOAD"; videoSize: number; plan: ChunkPlan } | { kind: "PULL_FROM_URL"; videoUrl: string },
  ): Promise<{ publishId: string; uploadUrl?: string }> {
    const result = await tiktokHttp(
      `${TIKTOK_OPEN_API_BASE}/v2/post/publish/inbox/video/init/`,
      this.bearerJson(accessToken, { source_info: this.sourceInfo(source) }),
      { ...this.http, idempotent: false },
    );
    return this.toInitResult(unwrapOpenApi(result));
  }

  /**
   * Starts a Direct Post (`video.publish`; 6 init requests/min). Privacy is
   * resolved with `resolvePrivacyLevel` against live creator info (see that
   * function for the unaudited => SELF_ONLY rule). Not retried on 5xx.
   */
  async initDirectPost(
    accessToken: string,
    input: {
      title?: string;
      source: { kind: "FILE_UPLOAD"; videoSize: number; plan: ChunkPlan } | { kind: "PULL_FROM_URL"; videoUrl: string };
      creatorInfo: TikTokCreatorInfo;
      requestedPrivacy?: string;
      clientAudited: boolean;
      videoDurationSec?: number;
      disableComment?: boolean;
      disableDuet?: boolean;
      disableStitch?: boolean;
    },
  ): Promise<{ publishId: string; uploadUrl?: string; privacyLevel: TikTokPrivacyLevel }> {
    if (input.title !== undefined && input.title.length > 2200) {
      throw new TikTokApiError("Judul/caption maksimal 2200 karakter.", { kind: "INVALID_REQUEST" });
    }
    const max = input.creatorInfo.maxVideoPostDurationSec;
    if (input.videoDurationSec !== undefined && max !== undefined && input.videoDurationSec > max) {
      throw new TikTokApiError("Durasi video melebihi batas akun TikTok ini.", { kind: "INVALID_REQUEST" });
    }
    const privacyLevel = resolvePrivacyLevel({
      requested: input.requestedPrivacy,
      creatorOptions: input.creatorInfo.privacyLevelOptions,
      clientAudited: input.clientAudited,
    });

    const result = await tiktokHttp(
      `${TIKTOK_OPEN_API_BASE}/v2/post/publish/video/init/`,
      this.bearerJson(accessToken, {
        post_info: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          privacy_level: privacyLevel,
          disable_comment: input.disableComment ?? input.creatorInfo.commentDisabled,
          disable_duet: input.disableDuet ?? input.creatorInfo.duetDisabled,
          disable_stitch: input.disableStitch ?? input.creatorInfo.stitchDisabled,
        },
        source_info: this.sourceInfo(input.source),
      }),
      { ...this.http, idempotent: false },
    );
    return { ...this.toInitResult(unwrapOpenApi(result)), privacyLevel };
  }

  /**
   * Uploads one chunk to the `upload_url` from init (valid 1 h). Chunks must
   * be sent in order. 206 = more expected, 201 = upload complete.
   * Content-Length is set by fetch itself (it is a forbidden header to set by hand).
   */
  async uploadChunk(
    uploadUrl: string,
    chunk: Uint8Array,
    range: { start: number; end: number },
    totalBytes: number,
    contentType = "video/mp4",
  ): Promise<"PARTIAL" | "COMPLETE"> {
    if (chunk.byteLength !== range.end - range.start + 1) {
      throw new TikTokApiError("Ukuran chunk tidak sesuai rentang byte.", { kind: "INVALID_REQUEST" });
    }
    const result = await tiktokHttp(
      uploadUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${range.start}-${range.end}/${totalBytes}`,
        },
        // Uint8Array is a valid fetch body; the cast only satisfies lib.dom's BufferSource typing.
        body: chunk as unknown as BodyInit,
      },
      { ...this.http, idempotent: true },
    );
    if (result.status === 201) return "COMPLETE";
    if (result.status === 206) return "PARTIAL";
    const kind = result.status === 416 ? "INVALID_REQUEST" : result.status >= 500 ? "SERVER_ERROR" : "UNKNOWN";
    throw new TikTokApiError(tiktokUserMessage(kind), { kind, status: result.status });
  }

  /** Limit: 30 requests/min per user token. Poll with backoff, or use webhooks. */
  async fetchPublishStatus(accessToken: string, publishId: string): Promise<TikTokPublishStatusResult> {
    const result = await tiktokHttp(
      `${TIKTOK_OPEN_API_BASE}/v2/post/publish/status/fetch/`,
      this.bearerJson(accessToken, { publish_id: publishId }),
      { ...this.http, idempotent: true },
    );
    const data = unwrapOpenApi(result);
    const known: TikTokPublishStatus[] = [
      "PROCESSING_UPLOAD",
      "PROCESSING_DOWNLOAD",
      "SEND_TO_USER_INBOX",
      "PUBLISH_COMPLETE",
      "FAILED",
    ];
    const status = known.find((s) => s === data.status) ?? "UNKNOWN";
    const failReason = typeof data.fail_reason === "string" ? data.fail_reason : undefined;
    // Field name (sic) as TikTok publishes it; NOT covered by the doc pages read on 2026-11-11 — verify against a live response.
    const ids = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id : [];
    return {
      status,
      failReason,
      postIds: ids.map((id) => String(id)),
      retryable: status === "FAILED" && failReason !== undefined && RETRYABLE_FAIL_REASONS.has(failReason),
      terminal: status === "FAILED" || status === "PUBLISH_COMPLETE" || status === "SEND_TO_USER_INBOX",
    };
  }

  private sourceInfo(
    source: { kind: "FILE_UPLOAD"; videoSize: number; plan: ChunkPlan } | { kind: "PULL_FROM_URL"; videoUrl: string },
  ): Record<string, unknown> {
    if (source.kind === "PULL_FROM_URL") {
      let url: URL;
      try {
        url = new URL(source.videoUrl);
      } catch {
        throw new TikTokApiError("URL video tidak valid.", { kind: "INVALID_REQUEST" });
      }
      if (url.protocol !== "https:") {
        throw new TikTokApiError("URL video harus https.", { kind: "INVALID_REQUEST" });
      }
      return { source: "PULL_FROM_URL", video_url: source.videoUrl };
    }
    return {
      source: "FILE_UPLOAD",
      video_size: source.videoSize,
      chunk_size: source.plan.chunkSize,
      total_chunk_count: source.plan.totalChunkCount,
    };
  }

  private toInitResult(data: Record<string, unknown>): { publishId: string; uploadUrl?: string } {
    if (typeof data.publish_id !== "string" || !data.publish_id) {
      throw new TikTokApiError("Respons init TikTok tidak berisi publish_id.", { kind: "UNKNOWN" });
    }
    return {
      publishId: data.publish_id,
      uploadUrl: typeof data.upload_url === "string" ? data.upload_url : undefined,
    };
  }
}
