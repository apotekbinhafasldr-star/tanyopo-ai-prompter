import { ConnectorApiError } from "@/lib/connectors/types";

/**
 * Klien X API v2 murni: `fetch` disuntik (tes memakai fetch palsu, tanpa
 * jaringan), tanpa state global, tanpa cache token — token SELALU dioper per
 * panggilan sehingga satu tenant tidak bisa memakai token tenant lain.
 *
 * Sumber (dokumentasi resmi X, diakses 2026-11-11):
 * - Token/refresh/revoke: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md
 * - POST /2/tweets: https://docs.x.com/x-api/posts/create-post.md
 * - Media upload v2: https://docs.x.com/x-api/media/quickstart/media-upload-chunked.md
 * - Metrik: https://docs.x.com/x-api/fundamentals/metrics.md
 * - GET /2/users/me: https://docs.x.com/x-api/users/get-my-user.md
 *
 * Belum pernah dijalankan terhadap X sungguhan (UNIT TEST PASS saja).
 */

export const X_API_BASE_URL = "https://api.x.com";
export const X_TOKEN_URL = `${X_API_BASE_URL}/2/oauth2/token`;
export const X_REVOKE_URL = `${X_API_BASE_URL}/2/oauth2/revoke`;

/** Scope minimum untuk posting organik + gambar/video + identitas + refresh token. */
export const X_PUBLISH_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"] as const;

/** Dokumen X: segmen APPEND dijaga <= 5 MB (maksimum server 8 MB). */
export const X_MAX_APPEND_SEGMENT_BYTES = 5 * 1024 * 1024;
/** Dokumen X: maksimal 4 foto, ATAU 1 GIF, ATAU 1 video per post. */
export const X_MAX_MEDIA_PER_POST = 4;

export type XFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type XSleep = (ms: number) => Promise<void>;

export interface XClientOptions {
  fetch: XFetch;
  sleep?: XSleep;
  /** Jumlah percobaan ulang untuk panggilan idempoten (APPEND, STATUS, GET). Default 2. */
  maxRetries?: number;
  /** Batas polling STATUS media. Default 30. */
  maxStatusPolls?: number;
  now?: () => number;
}

export type XMediaCategory = "tweet_image" | "tweet_gif" | "tweet_video";

/** Batas ukuran per kategori dari dokumen X (video: 8 GB akun biasa; batas Premium diperiksa X sendiri). */
const MEDIA_MAX_BYTES: Record<XMediaCategory, number> = {
  tweet_image: 5 * 1024 * 1024,
  tweet_gif: 15 * 1024 * 1024,
  tweet_video: 8 * 1024 * 1024 * 1024,
};

export interface XTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  scopes: string[];
}

export interface XRateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Detik epoch kapan jendela di-reset. */
  resetAt?: number;
}

export class XRateLimitError extends ConnectorApiError {
  readonly rateLimit: XRateLimitInfo;

  constructor(message: string, rateLimit: XRateLimitInfo) {
    super("X", message, { status: 429 });
    this.name = "XRateLimitError";
    this.rateLimit = rateLimit;
  }
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function readRateLimit(response: Response): XRateLimitInfo {
  const num = (name: string) => {
    const raw = response.headers.get(name);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    limit: num("x-rate-limit-limit"),
    remaining: num("x-rate-limit-remaining"),
    resetAt: num("x-rate-limit-reset"),
  };
}

interface XErrorBody {
  error?: string;
  error_description?: string;
  title?: string;
  detail?: string;
  message?: string;
  code?: number;
  errors?: { message?: string; code?: number }[];
}

interface XProcessingInfo {
  state?: string;
  check_after_secs?: number;
}

interface XRawToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function describeError(body: XErrorBody, status: number, fallback: string): { message: string; code?: number } {
  const message =
    body.error_description ?? body.detail ?? body.message ?? body.errors?.[0]?.message ?? body.title ?? body.error;
  return { message: message ?? `${fallback} (HTTP ${status}).`, code: body.code ?? body.errors?.[0]?.code };
}

export function createXClient(options: XClientOptions) {
  const doFetch = options.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? 2;
  const maxStatusPolls = options.maxStatusPolls ?? 30;
  const now = options.now ?? (() => Date.now());

  /**
   * `retry: true` hanya untuk panggilan idempoten. POST /2/tweets TIDAK PERNAH
   * diulang otomatis: pengulangan setelah timeout/5xx bisa menggandakan post.
   */
  async function call<T>(
    url: string,
    init: RequestInit,
    opts: { retry: boolean; label: string },
  ): Promise<{ body: T; response: Response }> {
    let attempt = 0;
    for (;;) {
      const response = await doFetch(url, init);
      const body = (await response.json().catch(() => ({}))) as T & XErrorBody;
      if (response.ok) return { body, response };

      const retryable = response.status === 429 || response.status >= 500;
      if (opts.retry && retryable && attempt < maxRetries) {
        attempt += 1;
        const rate = readRateLimit(response);
        const waitMs =
          response.status === 429 && rate.resetAt !== undefined
            ? Math.min(Math.max(rate.resetAt * 1000 - now(), 1000), 60_000)
            : 500 * 2 ** attempt;
        await sleep(waitMs);
        continue;
      }

      const { message, code } = describeError(body, response.status, `${opts.label} gagal`);
      if (response.status === 429) throw new XRateLimitError(message, readRateLimit(response));
      throw new ConnectorApiError("X", message, { status: response.status, code });
    }
  }

  const bearer = (token: string): Record<string, string> => {
    if (!token) throw new Error("Access token X kosong.");
    return { Authorization: `Bearer ${token}` };
  };

  function parseToken(body: XRawToken): XTokenSet {
    if (!body.access_token) throw new ConnectorApiError("X", "Respons token X tidak berisi access_token.");
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: body.expires_in,
      scopes: body.scope ? body.scope.split(" ") : [],
    };
  }

  const formHeaders = (clientId: string, clientSecret: string) => ({
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: basicAuth(clientId, clientSecret),
  });

  return {
    /** Kode otorisasi kedaluwarsa 30 detik setelah diterima (dokumen X) — tidak diulang otomatis. */
    async exchangeCode(input: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      code: string;
      codeVerifier: string;
    }): Promise<XTokenSet> {
      if (!input.codeVerifier) throw new Error("code_verifier wajib (PKCE).");
      const { body } = await call<XRawToken>(
        X_TOKEN_URL,
        {
          method: "POST",
          headers: formHeaders(input.clientId, input.clientSecret),
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: input.code,
            redirect_uri: input.redirectUri,
            code_verifier: input.codeVerifier,
            client_id: input.clientId,
          }),
        },
        { retry: false, label: "Penukaran kode X" },
      );
      return parseToken(body);
    },

    async refreshToken(input: { clientId: string; clientSecret: string; refreshToken: string }): Promise<XTokenSet> {
      const { body } = await call<XRawToken>(
        X_TOKEN_URL,
        {
          method: "POST",
          headers: formHeaders(input.clientId, input.clientSecret),
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: input.refreshToken }),
        },
        // Refresh token bisa berotasi: jangan diulang otomatis.
        { retry: false, label: "Refresh token X" },
      );
      return parseToken(body);
    },

    async revokeToken(input: {
      clientId: string;
      clientSecret: string;
      token: string;
      hint?: "access_token" | "refresh_token";
    }): Promise<void> {
      await call(
        X_REVOKE_URL,
        {
          method: "POST",
          headers: formHeaders(input.clientId, input.clientSecret),
          body: new URLSearchParams({ token: input.token, token_type_hint: input.hint ?? "access_token" }),
        },
        { retry: false, label: "Revoke token X" },
      );
    },

    async getMe(accessToken: string): Promise<{ id: string; name: string; username: string }> {
      const { body } = await call<{ data?: { id: string; name: string; username: string } }>(
        `${X_API_BASE_URL}/2/users/me`,
        { method: "GET", headers: bearer(accessToken) },
        { retry: true, label: "Baca akun X" },
      );
      if (!body.data?.id) throw new ConnectorApiError("X", "Respons /2/users/me X tidak berisi id.");
      return body.data;
    },

    /**
     * Mengunggah media lewat protokol v2 (initialize -> append -> finalize ->
     * STATUS). Mengembalikan media_id untuk `media.media_ids` di createPost.
     */
    async uploadMedia(
      accessToken: string,
      input: { bytes: Uint8Array; mediaType: string; category: XMediaCategory },
    ): Promise<{ mediaId: string }> {
      const total = input.bytes.byteLength;
      if (total === 0) throw new Error("Berkas media kosong.");
      if (total > MEDIA_MAX_BYTES[input.category]) {
        throw new Error(`Ukuran media melebihi batas X untuk ${input.category}.`);
      }
      const auth = bearer(accessToken);

      const init = await call<{ data?: { id?: string } }>(
        `${X_API_BASE_URL}/2/media/upload/initialize`,
        {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ media_type: input.mediaType, total_bytes: total, media_category: input.category }),
        },
        { retry: false, label: "Inisialisasi unggah media X" },
      );
      const mediaId = init.body.data?.id;
      if (!mediaId) throw new ConnectorApiError("X", "Respons initialize media X tidak berisi id.");

      const encodedId = encodeURIComponent(mediaId);
      let segmentIndex = 0;
      for (let offset = 0; offset < total; offset += X_MAX_APPEND_SEGMENT_BYTES) {
        const chunk = input.bytes.slice(offset, offset + X_MAX_APPEND_SEGMENT_BYTES);
        const form = new FormData();
        form.set("segment_index", String(segmentIndex));
        form.set("media", new Blob([chunk as BlobPart], { type: "application/octet-stream" }));
        // APPEND per segment_index idempoten -> boleh diulang.
        await call(
          `${X_API_BASE_URL}/2/media/upload/${encodedId}/append`,
          { method: "POST", headers: auth, body: form },
          { retry: true, label: "Append media X" },
        );
        segmentIndex += 1;
      }

      const fin = await call<{ data?: { processing_info?: XProcessingInfo } }>(
        `${X_API_BASE_URL}/2/media/upload/${encodedId}/finalize`,
        { method: "POST", headers: auth },
        { retry: false, label: "Finalize media X" },
      );

      let info = fin.body.data?.processing_info;
      for (let polls = 0; info && info.state !== "succeeded"; polls += 1) {
        if (info.state === "failed") throw new ConnectorApiError("X", "Pemrosesan media di X gagal.");
        if (polls >= maxStatusPolls) {
          throw new ConnectorApiError("X", "Pemrosesan media X melewati batas waktu tunggu.");
        }
        await sleep(Math.max(info.check_after_secs ?? 1, 1) * 1000);
        const status = await call<{ data?: { processing_info?: XProcessingInfo } }>(
          `${X_API_BASE_URL}/2/media/upload?command=STATUS&media_id=${encodedId}`,
          { method: "GET", headers: auth },
          { retry: true, label: "Status media X" },
        );
        info = status.body.data?.processing_info;
      }
      return { mediaId };
    },

    /** Tanpa retry otomatis (lihat komentar `call`). Pemanggil menangani XRateLimitError. */
    async createPost(
      accessToken: string,
      input: { text?: string; mediaIds?: string[] },
    ): Promise<{ id: string; text: string }> {
      const text = input.text?.trim() ?? "";
      const mediaIds = input.mediaIds ?? [];
      if (!text && mediaIds.length === 0) throw new Error("Post X butuh teks atau media.");
      if (mediaIds.length > X_MAX_MEDIA_PER_POST) {
        throw new Error(`Maksimal ${X_MAX_MEDIA_PER_POST} media_id per post X.`);
      }
      const payload: Record<string, unknown> = {};
      if (text) payload.text = text;
      if (mediaIds.length) payload.media = { media_ids: mediaIds };

      const { body } = await call<{ data?: { id: string; text: string } }>(
        `${X_API_BASE_URL}/2/tweets`,
        {
          method: "POST",
          headers: { ...bearer(accessToken), "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        { retry: false, label: "Buat post X" },
      );
      if (!body.data?.id) throw new ConnectorApiError("X", "Respons POST /2/tweets X tidak berisi id.");
      return body.data;
    },

    /**
     * Metrik organik post milik pengguna (butuh konteks pengguna; hanya post
     * <= 30 hari menurut dokumen). Bukan metrik iklan.
     */
    async getPostMetrics(
      accessToken: string,
      postId: string,
    ): Promise<{ raw: unknown; impressions: number; likes: number; replies: number; reposts: number; linkClicks: number }> {
      if (!/^\d{1,19}$/.test(postId)) throw new Error("ID post X tidak valid.");
      const { body } = await call<{
        data?: {
          public_metrics?: {
            like_count?: number;
            reply_count?: number;
            retweet_count?: number;
            impression_count?: number;
          };
          organic_metrics?: { impression_count?: number; url_link_clicks?: number };
        };
      }>(
        `${X_API_BASE_URL}/2/tweets/${postId}?tweet.fields=public_metrics,organic_metrics`,
        { method: "GET", headers: bearer(accessToken) },
        { retry: true, label: "Baca metrik post X" },
      );
      const pub = body.data?.public_metrics ?? {};
      const org = body.data?.organic_metrics ?? {};
      return {
        raw: body,
        impressions: org.impression_count ?? pub.impression_count ?? 0,
        likes: pub.like_count ?? 0,
        replies: pub.reply_count ?? 0,
        reposts: pub.retweet_count ?? 0,
        linkClicks: org.url_link_clicks ?? 0,
      };
    },
  };
}

export type XClient = ReturnType<typeof createXClient>;

/**
 * Estimasi biaya dari tabel harga resmi (snapshot 2026-11-11, "subject to
 * change"; sumber https://docs.x.com/x-api/getting-started/pricing.md).
 * Hanya perkiraan USD untuk tampilan/guard internal, BUKAN tagihan.
 */
export const X_PRICING_SNAPSHOT_USD = {
  asOf: "2026-11-11",
  postCreate: 0.015,
  postCreateWithUrl: 0.2,
  postRead: 0.005,
  ownedRead: 0.001,
  userRead: 0.01,
} as const;

export function estimateXPostCostUsd(input: { containsUrl: boolean }): number {
  return input.containsUrl ? X_PRICING_SNAPSHOT_USD.postCreateWithUrl : X_PRICING_SNAPSHOT_USD.postCreate;
}
