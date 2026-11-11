// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIKTOK_SCOPES,
  TikTokOpenApiClient,
  accessTokenNeedsRefresh,
  buildTikTokAuthorizeUrl,
  missingScopes,
  parseGrantedScopes,
  planChunks,
  resolvePrivacyLevel,
  scopesForCapability,
  type TikTokCreatorInfo,
} from "@/lib/connectors/tiktok-content-posting";
import { TikTokApiError } from "@/lib/connectors/tiktok-http";

const CONFIG = { clientKey: "ck_test", clientSecret: "cs_secret", redirectUri: "https://app.example.com/api/connections/tiktok/callback" };
const NOW = new Date("2026-11-11T00:00:00Z");
const MB = 1024 * 1024;

const sleepLog: number[] = [];
const FAST = { sleep: async (ms: number) => void sleepLog.push(ms) };

function client() {
  return new TikTokOpenApiClient(CONFIG, FAST);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(...responses: Response[]) {
  const queue = [...responses];
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function callOf(mock: ReturnType<typeof stubFetch>, index = 0) {
  const [url, init] = mock.mock.calls[index];
  return { url: String(url), init: (init ?? {}) as RequestInit & { headers: Record<string, string> } };
}

const OK = { code: "ok", message: "", log_id: "L" };

const CREATOR: TikTokCreatorInfo = {
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxVideoPostDurationSec: 600,
};

afterEach(() => {
  vi.unstubAllGlobals();
  sleepLog.length = 0;
});

describe("authorize URL", () => {
  it("sends scope (comma-separated), response_type=code, client_key, redirect_uri and state", () => {
    const url = new URL(
      buildTikTokAuthorizeUrl({
        clientKey: "ck_test",
        redirectUri: CONFIG.redirectUri,
        state: "st",
        scopes: scopesForCapability("UPLOAD_INBOX"),
      }),
    );
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("ck_test");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.upload");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });

  it("requests the minimum scopes per capability", () => {
    expect(scopesForCapability("LOGIN")).toEqual(["user.info.basic"]);
    expect(scopesForCapability("DIRECT_POST")).toEqual(["user.info.basic", "video.publish"]);
    expect(scopesForCapability("LOGIN")).not.toContain(TIKTOK_SCOPES.VIDEO_PUBLISH);
  });

  it("rejects empty or unknown scopes and invalid redirect URIs", () => {
    const base = { clientKey: "k", redirectUri: CONFIG.redirectUri, state: "s" };
    expect(() => buildTikTokAuthorizeUrl({ ...base, scopes: [] })).toThrow(TikTokApiError);
    expect(() => buildTikTokAuthorizeUrl({ ...base, scopes: ["video.delete_everything"] })).toThrow(TikTokApiError);
    expect(() => buildTikTokAuthorizeUrl({ ...base, redirectUri: "http://app.example.com/cb", scopes: ["user.info.basic"] })).toThrow(/https/);
    expect(() => buildTikTokAuthorizeUrl({ ...base, redirectUri: "https://app.example.com/cb?x=1", scopes: ["user.info.basic"] })).toThrow(TikTokApiError);
    expect(() => buildTikTokAuthorizeUrl({ ...base, redirectUri: "not a url", scopes: ["user.info.basic"] })).toThrow(TikTokApiError);
  });

  it("parses and diffs granted scopes", () => {
    expect(parseGrantedScopes("user.info.basic, video.upload")).toEqual(["user.info.basic", "video.upload"]);
    expect(parseGrantedScopes(undefined)).toEqual([]);
    expect(missingScopes(["user.info.basic"], ["user.info.basic", "video.publish"])).toEqual(["video.publish"]);
  });
});

describe("token exchange and refresh", () => {
  const tokenBody = {
    access_token: "at1",
    refresh_token: "rt1",
    open_id: "oid",
    expires_in: 86400,
    refresh_expires_in: 31536000,
    scope: "user.info.basic,video.upload",
    token_type: "Bearer",
  };

  it("posts form-urlencoded to the v2 token endpoint and computes both expiries", async () => {
    const mock = stubFetch(json(tokenBody));
    const tokens = await client().exchangeCode("the-code", NOW);

    const { url, init } = callOf(mock);
    expect(url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("client_key")).toBe("ck_test");
    expect(form.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(form.has("code_verifier")).toBe(false);

    expect(tokens.accessToken).toBe("at1");
    expect(tokens.refreshToken).toBe("rt1");
    expect(tokens.openId).toBe("oid");
    expect(tokens.scopes).toEqual(["user.info.basic", "video.upload"]);
    expect(tokens.expiresAt?.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(tokens.refreshExpiresAt?.toISOString()).toBe("2027-11-11T00:00:00.000Z");
  });

  it("does not replay the single-use code after a 5xx", async () => {
    const mock = stubFetch(json({ error: "internal_error", error_description: "x" }, 500));
    await expect(client().exchangeCode("c", NOW)).rejects.toMatchObject({ kind: "SERVER_ERROR" });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("surfaces TikTok's OAuth error without the secret", async () => {
    stubFetch(json({ error: "invalid_request", error_description: "Authorization code expired", log_id: "LG" }, 400));
    const error = await client().exchangeCode("c", NOW).catch((e) => e);
    expect(error).toBeInstanceOf(TikTokApiError);
    expect(error.kind).toBe("INVALID_REQUEST");
    expect(error.logId).toBe("LG");
    expect(JSON.stringify({ m: error.message, c: error.code })).not.toContain("cs_secret");
  });

  it("rejects a response without access_token", async () => {
    stubFetch(json({ open_id: "x" }));
    await expect(client().exchangeCode("c", NOW)).rejects.toThrow(/access_token/);
  });

  it("refresh uses grant_type=refresh_token and returns the ROTATED refresh token", async () => {
    const mock = stubFetch(json({ ...tokenBody, access_token: "at2", refresh_token: "rt2" }));
    const tokens = await client().refresh("rt1", NOW);
    const form = new URLSearchParams(String(callOf(mock).init.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt1");
    expect(tokens.accessToken).toBe("at2");
    expect(tokens.refreshToken).toBe("rt2");
  });

  it("refresh keeps the old refresh token when the response omits one", async () => {
    stubFetch(json({ access_token: "at2", expires_in: 86400 }));
    const tokens = await client().refresh("rt1", NOW);
    expect(tokens.refreshToken).toBe("rt1");
  });

  it("a refused refresh is REFRESH_REJECTED and requires reconnect (not a plain 400)", async () => {
    stubFetch(json({ error: "invalid_grant", error_description: "refresh token expired" }, 400));
    const error = await client().refresh("rt1", NOW).catch((e) => e);
    expect(error.kind).toBe("REFRESH_REJECTED");
    expect(error.requiresReconnect).toBe(true);

    stubFetch(json({ error: "invalid_request", error_description: "bad" }, 400));
    const other = await client().refresh("rt1", NOW).catch((e) => e);
    expect(other.kind).toBe("REFRESH_REJECTED");
  });

  it("refresh is retried on 5xx (idempotent) but a 5xx stays a retryable error, not a reconnect", async () => {
    const mock = stubFetch(json({}, 503), json({}, 503), json({}, 503));
    const error = await client().refresh("rt1", NOW).catch((e) => e);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(error.kind).toBe("SERVER_ERROR");
    expect(error.requiresReconnect).toBe(false);
  });
});

describe("ensureFreshTokens", () => {
  it("does nothing while the access token is valid", async () => {
    const mock = stubFetch();
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: new Date(NOW.getTime() + 3600_000) };
    const result = await client().ensureFreshTokens(tokens, NOW);
    expect(result).toEqual({ tokens, refreshed: false });
    expect(mock).not.toHaveBeenCalled();
  });

  it("treats a missing expiry as valid (cannot know) and a near-expiry as stale", () => {
    expect(accessTokenNeedsRefresh({ expiresAt: null }, NOW)).toBe(false);
    expect(accessTokenNeedsRefresh({ expiresAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe(true);
    expect(accessTokenNeedsRefresh({ expiresAt: new Date(NOW.getTime() + 3600_000) }, NOW)).toBe(false);
  });

  it("refreshes an expired token and returns what must be persisted", async () => {
    stubFetch(json({ access_token: "a2", refresh_token: "r2", expires_in: 86400, refresh_expires_in: 31536000 }));
    const result = await client().ensureFreshTokens(
      { accessToken: "a1", refreshToken: "r1", expiresAt: new Date(NOW.getTime() - 1000) },
      NOW,
    );
    expect(result.refreshed).toBe(true);
    expect(result.tokens.accessToken).toBe("a2");
    expect(result.tokens.refreshToken).toBe("r2");
    expect(result.tokens.expiresAt?.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("requires reconnect, without any network call, when the refresh token is missing or expired", async () => {
    const mock = stubFetch();
    const expired = { accessToken: "a", refreshToken: "r", expiresAt: new Date(NOW.getTime() - 1), refreshExpiresAt: new Date(NOW.getTime() - 1) };
    await expect(client().ensureFreshTokens(expired, NOW)).rejects.toMatchObject({ kind: "REFRESH_REJECTED" });
    await expect(client().ensureFreshTokens({ accessToken: "a", expiresAt: new Date(NOW.getTime() - 1) }, NOW)).rejects.toMatchObject({
      kind: "REFRESH_REJECTED",
    });
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("revoke and user info", () => {
  it("revoke posts the token and tolerates the documented empty success body", async () => {
    const mock = stubFetch(new Response("", { status: 200 }));
    await client().revoke("at1");
    const { url, init } = callOf(mock);
    expect(url).toBe("https://open.tiktokapis.com/v2/oauth/revoke/");
    expect(new URLSearchParams(String(init.body)).get("token")).toBe("at1");
  });

  it("getUserInfo sends a Bearer header (never the token in the URL) and returns open_id", async () => {
    const mock = stubFetch(json({ data: { user: { open_id: "oid", display_name: "Toko A" } }, error: OK }));
    const user = await client().getUserInfo("at1");
    const { url, init } = callOf(mock);
    expect(url).toContain("/v2/user/info/?fields=open_id%2Cdisplay_name");
    expect(url).not.toContain("at1");
    expect(init.headers.Authorization).toBe("Bearer at1");
    expect(user).toEqual({ openId: "oid", displayName: "Toko A" });
  });

  it("getUserInfo fails when open_id is missing and maps access_token_invalid", async () => {
    stubFetch(json({ data: { user: {} }, error: OK }));
    await expect(client().getUserInfo("t")).rejects.toThrow(/open_id/);
    stubFetch(json({ error: { code: "access_token_invalid", message: "expired", log_id: "L" } }, 401));
    const expired = await client().getUserInfo("t").catch((e) => e);
    expect(expired.kind).toBe("AUTH_EXPIRED");
    expect(expired.requiresReconnect).toBe(true);
  });
});

describe("creator info and privacy resolution", () => {
  it("queryCreatorInfo maps the documented fields", async () => {
    const mock = stubFetch(
      json({
        data: {
          creator_username: "toko_a",
          creator_nickname: "Toko A",
          privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
          comment_disabled: true,
          duet_disabled: false,
          stitch_disabled: true,
          max_video_post_duration_sec: 300,
        },
        error: OK,
      }),
    );
    const info = await client().queryCreatorInfo("at1");
    expect(callOf(mock).url).toBe("https://open.tiktokapis.com/v2/post/publish/creator_info/query/");
    expect(info).toMatchObject({
      creatorNickname: "Toko A",
      privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      commentDisabled: true,
      duetDisabled: false,
      stitchDisabled: true,
      maxVideoPostDurationSec: 300,
    });
  });

  it("unaudited clients are forced to SELF_ONLY whatever was requested", () => {
    expect(resolvePrivacyLevel({ requested: "PUBLIC_TO_EVERYONE", creatorOptions: CREATOR.privacyLevelOptions, clientAudited: false })).toBe(
      "SELF_ONLY",
    );
    expect(resolvePrivacyLevel({ creatorOptions: CREATOR.privacyLevelOptions, clientAudited: false })).toBe("SELF_ONLY");
  });

  it("audited clients must choose explicitly, from the creator's options", () => {
    expect(resolvePrivacyLevel({ requested: "MUTUAL_FOLLOW_FRIENDS", creatorOptions: CREATOR.privacyLevelOptions, clientAudited: true })).toBe(
      "MUTUAL_FOLLOW_FRIENDS",
    );
    expect(() => resolvePrivacyLevel({ creatorOptions: CREATOR.privacyLevelOptions, clientAudited: true })).toThrow(/eksplisit/);
    try {
      resolvePrivacyLevel({ requested: "FOLLOWER_OF_CREATOR", creatorOptions: CREATOR.privacyLevelOptions, clientAudited: true });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as TikTokApiError).kind).toBe("PRIVACY_MISMATCH");
    }
  });
});

describe("planChunks", () => {
  it("files under 5 MB go in one request", () => {
    expect(planChunks(3 * MB)).toEqual({ chunkSize: 3 * MB, totalChunkCount: 1, ranges: [{ start: 0, end: 3 * MB - 1 }] });
  });

  it("splits per the guide: floor(size / chunk), last chunk absorbs the remainder", () => {
    const total = 50_000_123;
    const plan = planChunks(total, 10_000_000);
    expect(plan.chunkSize).toBe(10_000_000);
    expect(plan.totalChunkCount).toBe(5);
    expect(plan.ranges[0]).toEqual({ start: 0, end: 9_999_999 });
    expect(plan.ranges[4]).toEqual({ start: 40_000_000, end: total - 1 });
    expect(plan.ranges[4].end - plan.ranges[4].start + 1).toBe(10_000_123);
    // ranges are contiguous and cover every byte exactly once
    for (let i = 1; i < plan.ranges.length; i++) expect(plan.ranges[i].start).toBe(plan.ranges[i - 1].end + 1);
  });

  it("clamps chunk size to 5-64 MB and rejects >4 GB and bad sizes", () => {
    expect(planChunks(100 * MB, 1 * MB).chunkSize).toBe(5 * MB);
    expect(planChunks(1000 * MB, 500 * MB).chunkSize).toBe(64 * MB);
    expect(() => planChunks(4 * 1024 * MB + 1)).toThrow(/4 GB/);
    expect(() => planChunks(0)).toThrow(TikTokApiError);
    expect(() => planChunks(1.5)).toThrow(TikTokApiError);
  });
});

describe("Direct Post / inbox init", () => {
  const fileSource = { kind: "FILE_UPLOAD" as const, videoSize: 3 * MB, plan: planChunks(3 * MB) };

  it("initDirectPost on an unaudited client forces SELF_ONLY in the request body", async () => {
    const mock = stubFetch(json({ data: { publish_id: "p1", upload_url: "https://upload.example/u" }, error: OK }));
    const result = await client().initDirectPost("at1", {
      title: "Halo",
      source: fileSource,
      creatorInfo: CREATOR,
      requestedPrivacy: "PUBLIC_TO_EVERYONE",
      clientAudited: false,
    });
    const { url, init } = callOf(mock);
    expect(url).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
    const body = JSON.parse(String(init.body));
    expect(body.post_info.privacy_level).toBe("SELF_ONLY");
    expect(body.post_info.title).toBe("Halo");
    expect(body.post_info.disable_duet).toBe(true); // inherited from creator settings
    expect(body.source_info).toEqual({ source: "FILE_UPLOAD", video_size: 3 * MB, chunk_size: 3 * MB, total_chunk_count: 1 });
    expect(init.headers.Authorization).toBe("Bearer at1");
    expect(result).toEqual({ publishId: "p1", uploadUrl: "https://upload.example/u", privacyLevel: "SELF_ONLY" });
  });

  it("validates locally before any network call (caption length, duration, https URL, privacy)", async () => {
    const mock = stubFetch();
    const base = { source: fileSource, creatorInfo: CREATOR, clientAudited: false };
    await expect(client().initDirectPost("t", { ...base, title: "x".repeat(2201) })).rejects.toThrow(/2200/);
    await expect(client().initDirectPost("t", { ...base, videoDurationSec: 601 })).rejects.toThrow(/Durasi/);
    await expect(
      client().initDirectPost("t", { ...base, source: { kind: "PULL_FROM_URL", videoUrl: "http://insecure.example/v.mp4" } }),
    ).rejects.toThrow(/https/);
    await expect(
      client().initDirectPost("t", { ...base, creatorInfo: { ...CREATOR, privacyLevelOptions: ["PUBLIC_TO_EVERYONE"] } }),
    ).rejects.toMatchObject({ kind: "PRIVACY_MISMATCH" });
    expect(mock).not.toHaveBeenCalled();
  });

  it("an audited client with no explicit privacy is refused (no default)", async () => {
    const mock = stubFetch();
    await expect(client().initDirectPost("t", { source: fileSource, creatorInfo: CREATOR, clientAudited: true })).rejects.toThrow(/eksplisit/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("PULL_FROM_URL sends video_url; init is not replayed after 5xx", async () => {
    const mock = stubFetch(json({ error: { code: "internal_error", message: "x", log_id: "L" } }, 500));
    await expect(
      client().initDirectPost("t", {
        source: { kind: "PULL_FROM_URL", videoUrl: "https://cdn.example.com/v.mp4" },
        creatorInfo: CREATOR,
        clientAudited: false,
      }),
    ).rejects.toMatchObject({ kind: "SERVER_ERROR" });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(callOf(mock).init.body)).source_info).toEqual({
      source: "PULL_FROM_URL",
      video_url: "https://cdn.example.com/v.mp4",
    });
  });

  it("init retries 429 (request refused) and then succeeds", async () => {
    const mock = stubFetch(json({ error: { code: "rate_limit_exceeded", message: "slow", log_id: "L" } }, 429), json({ data: { publish_id: "p2" }, error: OK }));
    const result = await client().initInboxUpload("at1", { kind: "PULL_FROM_URL", videoUrl: "https://cdn.example.com/v.mp4" });
    expect(result.publishId).toBe("p2");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(sleepLog.length).toBe(1);
  });

  it("maps the Direct Post audit and cap errors", async () => {
    stubFetch(
      json({ error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "m", log_id: "L" } }, 403),
      json({ error: { code: "reached_active_user_cap", message: "m", log_id: "L" } }, 403),
      json({ error: { code: "scope_not_authorized", message: "m", log_id: "L" } }, 401),
    );
    const input = { source: fileSource, creatorInfo: CREATOR, clientAudited: false };
    await expect(client().initDirectPost("t", input)).rejects.toMatchObject({ kind: "UNAUDITED_CLIENT" });
    await expect(client().initDirectPost("t", input)).rejects.toMatchObject({ kind: "DAILY_CAP" });
    const scopeError = await client().initDirectPost("t", input).catch((e) => e);
    expect(scopeError.kind).toBe("SCOPE_MISSING");
    expect(scopeError.requiresReconnect).toBe(true);
  });

  it("initInboxUpload posts only source_info to the inbox endpoint (no post_info, no privacy)", async () => {
    const mock = stubFetch(json({ data: { publish_id: "p3", upload_url: "https://upload.example/u" }, error: OK }));
    const result = await client().initInboxUpload("at1", fileSource);
    const { url, init } = callOf(mock);
    expect(url).toBe("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/");
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(["source_info"]);
    expect(result).toEqual({ publishId: "p3", uploadUrl: "https://upload.example/u" });
  });

  it("init without publish_id is an error", async () => {
    stubFetch(json({ data: {}, error: OK }));
    await expect(client().initInboxUpload("t", fileSource)).rejects.toThrow(/publish_id/);
  });
});

describe("uploadChunk", () => {
  const url = "https://upload.example/u?token=abc";

  it("PUTs the bytes with Content-Range and reports 206 as PARTIAL, 201 as COMPLETE", async () => {
    const mock = stubFetch(new Response(null, { status: 206 }), new Response(null, { status: 201 }));
    const chunk = new Uint8Array(10);
    expect(await client().uploadChunk(url, chunk, { start: 0, end: 9 }, 20)).toBe("PARTIAL");
    expect(await client().uploadChunk(url, chunk, { start: 10, end: 19 }, 20)).toBe("COMPLETE");
    const first = callOf(mock, 0);
    expect(first.url).toBe(url);
    expect(first.init.method).toBe("PUT");
    expect(first.init.headers["Content-Range"]).toBe("bytes 0-9/20");
    expect(first.init.headers["Content-Type"]).toBe("video/mp4");
    expect(callOf(mock, 1).init.headers["Content-Range"]).toBe("bytes 10-19/20");
  });

  it("rejects a chunk whose length does not match its range before any network call", async () => {
    const mock = stubFetch();
    await expect(client().uploadChunk(url, new Uint8Array(5), { start: 0, end: 9 }, 20)).rejects.toThrow(/Ukuran chunk/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("maps 416 (range mismatch) and other statuses to errors", async () => {
    stubFetch(new Response(null, { status: 416 }));
    await expect(client().uploadChunk(url, new Uint8Array(1), { start: 0, end: 0 }, 1)).rejects.toMatchObject({ kind: "INVALID_REQUEST" });
    stubFetch(new Response(null, { status: 200 }));
    await expect(client().uploadChunk(url, new Uint8Array(1), { start: 0, end: 0 }, 1)).rejects.toMatchObject({ kind: "UNKNOWN" });
  });
});

describe("fetchPublishStatus", () => {
  it("maps statuses and marks terminal / retryable outcomes", async () => {
    const mock = stubFetch(
      json({ data: { status: "PROCESSING_UPLOAD" }, error: OK }),
      json({ data: { status: "SEND_TO_USER_INBOX" }, error: OK }),
      json({ data: { status: "FAILED", fail_reason: "internal" }, error: OK }),
      json({ data: { status: "FAILED", fail_reason: "spam_risk" }, error: OK }),
      json({ data: { status: "SURPRISE" }, error: OK }),
    );
    const c = client();
    expect(await c.fetchPublishStatus("at", "p1")).toMatchObject({ status: "PROCESSING_UPLOAD", terminal: false, retryable: false });
    expect(await c.fetchPublishStatus("at", "p1")).toMatchObject({ status: "SEND_TO_USER_INBOX", terminal: true });
    expect(await c.fetchPublishStatus("at", "p1")).toMatchObject({ status: "FAILED", failReason: "internal", retryable: true, terminal: true });
    expect(await c.fetchPublishStatus("at", "p1")).toMatchObject({ status: "FAILED", failReason: "spam_risk", retryable: false });
    expect(await c.fetchPublishStatus("at", "p1")).toMatchObject({ status: "UNKNOWN", terminal: false });
    expect(callOf(mock).url).toBe("https://open.tiktokapis.com/v2/post/publish/status/fetch/");
    expect(JSON.parse(String(callOf(mock).init.body))).toEqual({ publish_id: "p1" });
  });

  it("status polling is replayed on 5xx (read-only)", async () => {
    const mock = stubFetch(json({}, 502), json({ data: { status: "PUBLISH_COMPLETE" }, error: OK }));
    const result = await client().fetchPublishStatus("at", "p1");
    expect(result.status).toBe("PUBLISH_COMPLETE");
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
