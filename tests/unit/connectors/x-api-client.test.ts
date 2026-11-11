// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ConnectorApiError } from "@/lib/connectors/types";
import {
  X_MAX_APPEND_SEGMENT_BYTES,
  XRateLimitError,
  createXClient,
  estimateXPostCostUsd,
  type XFetch,
} from "@/lib/connectors/x-api-client";

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Fetch palsu berurutan: setiap panggilan mengambil respons berikutnya; mencatat semua permintaan. */
function fakeFetch(responses: (Response | ((c: Call) => Response))[]) {
  const calls: Call[] = [];
  const fn: XFetch = async (url, init = {}) => {
    const call = { url, init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`Panggilan tak terduga ke ${url}`);
    return typeof next === "function" ? next(call) : next;
  };
  return { fn, calls };
}

const noSleep = async () => {};

describe("createXClient — OAuth", () => {
  it("menukar kode dengan PKCE: host api.x.com, Basic auth, code_verifier terkirim", async () => {
    const { fn, calls } = fakeFetch([
      json(200, { access_token: "AT", refresh_token: "RT", expires_in: 7200, scope: "tweet.read tweet.write" }),
    ]);
    const client = createXClient({ fetch: fn, sleep: noSleep });
    const tokens = await client.exchangeCode({
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "https://app/cb",
      code: "code1",
      codeVerifier: "ver",
    });
    expect(tokens).toEqual({
      accessToken: "AT",
      refreshToken: "RT",
      expiresInSeconds: 7200,
      scopes: ["tweet.read", "tweet.write"],
    });
    expect(calls[0].url).toBe("https://api.x.com/2/oauth2/token");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("cid:sec").toString("base64")}`);
    const body = calls[0].init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("ver");
    expect(body.get("code")).toBe("code1");
  });

  it("menolak penukaran tanpa code_verifier sebelum jaringan", async () => {
    const { fn, calls } = fakeFetch([]);
    const client = createXClient({ fetch: fn });
    await expect(
      client.exchangeCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x", codeVerifier: "" }),
    ).rejects.toThrow(/code_verifier/);
    expect(calls).toHaveLength(0);
  });

  it("tidak mengulang penukaran kode saat gagal 500 dan mengembalikan error_description", async () => {
    const { fn, calls } = fakeFetch([json(500, { error: "server_error", error_description: "boom" })]);
    const client = createXClient({ fetch: fn, sleep: noSleep });
    await expect(
      client.exchangeCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x", codeVerifier: "v" }),
    ).rejects.toMatchObject({ message: "boom", status: 500 });
    expect(calls).toHaveLength(1);
  });

  it("refresh token memakai grant_type=refresh_token dan tidak diulang otomatis", async () => {
    const { fn, calls } = fakeFetch([json(200, { access_token: "AT2", refresh_token: "RT2", expires_in: 7200 })]);
    const client = createXClient({ fetch: fn });
    const tokens = await client.refreshToken({ clientId: "c", clientSecret: "s", refreshToken: "RT" });
    expect(tokens.accessToken).toBe("AT2");
    expect((calls[0].init.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
    expect((calls[0].init.body as URLSearchParams).get("refresh_token")).toBe("RT");
  });

  it("revoke memanggil /2/oauth2/revoke", async () => {
    const { fn, calls } = fakeFetch([json(200, { revoked: true })]);
    await createXClient({ fetch: fn }).revokeToken({ clientId: "c", clientSecret: "s", token: "AT" });
    expect(calls[0].url).toBe("https://api.x.com/2/oauth2/revoke");
    expect((calls[0].init.body as URLSearchParams).get("token")).toBe("AT");
  });

  it("respons token tanpa access_token ditolak", async () => {
    const { fn } = fakeFetch([json(200, {})]);
    await expect(
      createXClient({ fetch: fn }).refreshToken({ clientId: "c", clientSecret: "s", refreshToken: "r" }),
    ).rejects.toBeInstanceOf(ConnectorApiError);
  });
});

describe("createXClient — identitas & posting", () => {
  it("getMe memakai Bearer dan GET /2/users/me", async () => {
    const { fn, calls } = fakeFetch([json(200, { data: { id: "42", name: "Toko", username: "toko" } })]);
    const me = await createXClient({ fetch: fn }).getMe("AT");
    expect(me).toEqual({ id: "42", name: "Toko", username: "toko" });
    expect(calls[0].url).toBe("https://api.x.com/2/users/me");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  });

  it("createPost teks saja: JSON {text}", async () => {
    const { fn, calls } = fakeFetch([json(201, { data: { id: "1", text: "halo" } })]);
    const post = await createXClient({ fetch: fn }).createPost("AT", { text: "  halo " });
    expect(post).toEqual({ id: "1", text: "halo" });
    expect(calls[0].url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: "halo" });
  });

  it("createPost dengan media: media.media_ids", async () => {
    const { fn, calls } = fakeFetch([json(201, { data: { id: "1", text: "" } })]);
    await createXClient({ fetch: fn }).createPost("AT", { mediaIds: ["m1", "m2"] });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ media: { media_ids: ["m1", "m2"] } });
  });

  it("createPost menolak kosong dan >4 media sebelum jaringan", async () => {
    const { fn, calls } = fakeFetch([]);
    const client = createXClient({ fetch: fn });
    await expect(client.createPost("AT", { text: "  " })).rejects.toThrow();
    await expect(client.createPost("AT", { mediaIds: ["1", "2", "3", "4", "5"] })).rejects.toThrow(/Maksimal 4/);
    await expect(client.createPost("", { text: "x" })).rejects.toThrow(/kosong/);
    expect(calls).toHaveLength(0);
  });

  it("createPost TIDAK diulang pada 503 (hindari post ganda)", async () => {
    const { fn, calls } = fakeFetch([json(503, { title: "Service Unavailable", detail: "down" }), json(201, { data: { id: "9", text: "x" } })]);
    await expect(createXClient({ fetch: fn, sleep: noSleep }).createPost("AT", { text: "x" })).rejects.toMatchObject({
      status: 503,
    });
    expect(calls).toHaveLength(1);
  });

  it("createPost 429 melempar XRateLimitError dengan info reset, tanpa retry", async () => {
    const { fn, calls } = fakeFetch([
      json(429, { title: "Too Many Requests", detail: "Rate limit exceeded" }, {
        "x-rate-limit-limit": "100",
        "x-rate-limit-remaining": "0",
        "x-rate-limit-reset": "1800000000",
      }),
    ]);
    const err = await createXClient({ fetch: fn }).createPost("AT", { text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(XRateLimitError);
    expect(err.rateLimit).toEqual({ limit: 100, remaining: 0, resetAt: 1800000000 });
    expect(calls).toHaveLength(1);
  });

  it("respons 201 tanpa id ditolak", async () => {
    const { fn } = fakeFetch([json(201, {})]);
    await expect(createXClient({ fetch: fn }).createPost("AT", { text: "x" })).rejects.toBeInstanceOf(ConnectorApiError);
  });
});

describe("createXClient — unggah media v2", () => {
  it("gambar kecil: initialize -> append(segment 0) -> finalize, tanpa polling", async () => {
    const { fn, calls } = fakeFetch([
      json(200, { data: { id: "mid", media_key: "k", expires_after_secs: 86400 } }),
      json(200, {}),
      json(200, { data: { id: "mid" } }),
    ]);
    const out = await createXClient({ fetch: fn }).uploadMedia("AT", {
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      category: "tweet_image",
    });
    expect(out).toEqual({ mediaId: "mid" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.x.com/2/media/upload/initialize",
      "https://api.x.com/2/media/upload/mid/append",
      "https://api.x.com/2/media/upload/mid/finalize",
    ]);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      media_type: "image/png",
      total_bytes: 3,
      media_category: "tweet_image",
    });
    const form = calls[1].init.body as FormData;
    expect(form.get("segment_index")).toBe("0");
    expect(form.get("media")).toBeInstanceOf(Blob);
  });

  it("memecah berkas > 5 MB menjadi segmen berindeks berurutan", async () => {
    const size = X_MAX_APPEND_SEGMENT_BYTES * 2 + 10;
    const { fn, calls } = fakeFetch([
      json(200, { data: { id: "v1" } }),
      json(200, {}),
      json(200, {}),
      json(200, {}),
      json(200, { data: { id: "v1" } }),
    ]);
    await createXClient({ fetch: fn }).uploadMedia("AT", {
      bytes: new Uint8Array(size),
      mediaType: "video/mp4",
      category: "tweet_video",
    });
    const appends = calls.filter((c) => c.url.endsWith("/append"));
    expect(appends.map((c) => (c.init.body as FormData).get("segment_index"))).toEqual(["0", "1", "2"]);
    const sizes = appends.map((c) => ((c.init.body as FormData).get("media") as Blob).size);
    expect(sizes).toEqual([X_MAX_APPEND_SEGMENT_BYTES, X_MAX_APPEND_SEGMENT_BYTES, 10]);
  });

  it("video: polling STATUS sampai succeeded, menghormati check_after_secs", async () => {
    const sleep = vi.fn(async () => {});
    const { fn, calls } = fakeFetch([
      json(200, { data: { id: "v" } }),
      json(200, {}),
      json(200, { data: { id: "v", processing_info: { state: "pending", check_after_secs: 3 } } }),
      json(200, { data: { processing_info: { state: "in_progress", check_after_secs: 2 } } }),
      json(200, { data: { processing_info: { state: "succeeded" } } }),
    ]);
    const out = await createXClient({ fetch: fn, sleep }).uploadMedia("AT", {
      bytes: new Uint8Array(10),
      mediaType: "video/mp4",
      category: "tweet_video",
    });
    expect(out.mediaId).toBe("v");
    expect(sleep.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([3000, 2000]);
    expect(calls[3].url).toBe("https://api.x.com/2/media/upload?command=STATUS&media_id=v");
    expect(calls[3].init.method).toBe("GET");
  });

  it("pemrosesan gagal di X -> error", async () => {
    const { fn } = fakeFetch([
      json(200, { data: { id: "v" } }),
      json(200, {}),
      json(200, { data: { processing_info: { state: "failed" } } }),
    ]);
    await expect(
      createXClient({ fetch: fn, sleep: noSleep }).uploadMedia("AT", {
        bytes: new Uint8Array(1),
        mediaType: "video/mp4",
        category: "tweet_video",
      }),
    ).rejects.toThrow(/gagal/);
  });

  it("polling dibatasi (maxStatusPolls) agar tidak menggantung", async () => {
    const pending = () => json(200, { data: { processing_info: { state: "pending", check_after_secs: 1 } } });
    const { fn } = fakeFetch([json(200, { data: { id: "v" } }), json(200, {}), pending(), pending(), pending()]);
    await expect(
      createXClient({ fetch: fn, sleep: noSleep, maxStatusPolls: 2 }).uploadMedia("AT", {
        bytes: new Uint8Array(1),
        mediaType: "video/mp4",
        category: "tweet_video",
      }),
    ).rejects.toThrow(/batas waktu/);
  });

  it("APPEND diulang pada 429 setelah menunggu reset, lalu lanjut", async () => {
    const sleep = vi.fn(async () => {});
    const { fn, calls } = fakeFetch([
      json(200, { data: { id: "m" } }),
      json(429, { title: "Too Many Requests" }, { "x-rate-limit-reset": "1000" }),
      json(200, {}),
      json(200, { data: { id: "m" } }),
    ]);
    await createXClient({ fetch: fn, sleep, now: () => 998_000 }).uploadMedia("AT", {
      bytes: new Uint8Array(1),
      mediaType: "image/png",
      category: "tweet_image",
    });
    expect(calls.filter((c) => c.url.endsWith("/append"))).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("menolak berkas kosong atau melebihi batas kategori sebelum jaringan", async () => {
    const { fn, calls } = fakeFetch([]);
    const client = createXClient({ fetch: fn });
    await expect(
      client.uploadMedia("AT", { bytes: new Uint8Array(0), mediaType: "image/png", category: "tweet_image" }),
    ).rejects.toThrow(/kosong/);
    await expect(
      client.uploadMedia("AT", {
        bytes: new Uint8Array(5 * 1024 * 1024 + 1),
        mediaType: "image/png",
        category: "tweet_image",
      }),
    ).rejects.toThrow(/melebihi/);
    expect(calls).toHaveLength(0);
  });
});

describe("createXClient — metrik, isolasi tenant, biaya", () => {
  it("getPostMetrics meminta field organik dan memetakan hasil; ID tidak valid ditolak", async () => {
    const { fn, calls } = fakeFetch([
      json(200, {
        data: {
          public_metrics: { like_count: 3, reply_count: 1, retweet_count: 2, impression_count: 100 },
          organic_metrics: { impression_count: 90, url_link_clicks: 4 },
        },
      }),
    ]);
    const client = createXClient({ fetch: fn });
    const m = await client.getPostMetrics("AT", "123");
    expect(calls[0].url).toBe("https://api.x.com/2/tweets/123?tweet.fields=public_metrics,organic_metrics");
    expect(m).toMatchObject({ impressions: 90, likes: 3, replies: 1, reposts: 2, linkClicks: 4 });
    await expect(client.getPostMetrics("AT", "../users")).rejects.toThrow(/tidak valid/);
  });

  it("isolasi tenant: dua klien paralel selalu memakai token masing-masing, tanpa cache bersama", async () => {
    const seen: string[] = [];
    const fn: XFetch = async (_url, init) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      seen.push(auth);
      await Promise.resolve();
      return json(201, { data: { id: auth.slice(-1), text: "x" } });
    };
    const client = createXClient({ fetch: fn });
    const [a, b] = await Promise.all([
      client.createPost("tokenA", { text: "a" }),
      client.createPost("tokenB", { text: "b" }),
    ]);
    expect(a.id).toBe("A");
    expect(b.id).toBe("B");
    expect(seen.sort()).toEqual(["Bearer tokenA", "Bearer tokenB"]);
  });

  it("estimasi biaya mengikuti snapshot harga (URL jauh lebih mahal)", () => {
    expect(estimateXPostCostUsd({ containsUrl: false })).toBe(0.015);
    expect(estimateXPostCostUsd({ containsUrl: true })).toBe(0.2);
  });
});
