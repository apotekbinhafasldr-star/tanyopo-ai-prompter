// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  evaluateStoredMedia,
  fetchObjectHead,
  STORAGE_CALL_TIMEOUT_MS,
  parseContentRangeTotal,
  withTimeout,
  verifyUploadedObject,
  type StorageBucketLike,
} from "@/lib/media/hardened-upload-server";

const UUID = "3f2b8c1e-5d4a-4b7c-9e1f-0a1b2c3d4e5f";
const JPG_PATH = `t1/p1/${UUID}.jpg`;
const PNG_PATH = `t1/p1/${UUID}.png`;
const WEBP_PATH = `t1/p1/${UUID}.webp`;
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP_HEAD = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

describe("evaluateStoredMedia", () => {
  it("menerima JPEG dan PNG yang tanda tangannya cocok dengan ekstensi", () => {
    expect(evaluateStoredMedia({ storagePath: JPG_PATH, head: JPEG_HEAD })).toEqual({ ok: true, mime: "image/jpeg" });
    expect(evaluateStoredMedia({ storagePath: PNG_PATH, head: PNG_HEAD })).toEqual({ ok: true, mime: "image/png" });
  });

  it("menolak mime/ekstensi WebP dengan pesan jenis tidak didukung", () => {
    const byPath = evaluateStoredMedia({ storagePath: WEBP_PATH, head: WEBP_HEAD });
    expect(byPath).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    if (!byPath.ok) expect(byPath.message).toMatch(/tidak didukung/i);
    // isi WebP yang menyamar dengan ekstensi .jpg tetap ditolak sebagai tidak didukung
    expect(evaluateStoredMedia({ storagePath: JPG_PATH, head: WEBP_HEAD })).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_FORMAT",
    });
  });

  it("menolak tanda tangan yang tidak cocok (PNG berekstensi .jpg, teks berekstensi .png)", () => {
    expect(evaluateStoredMedia({ storagePath: JPG_PATH, head: PNG_HEAD })).toMatchObject({
      ok: false,
      code: "SIGNATURE_MISMATCH",
    });
    expect(
      evaluateStoredMedia({ storagePath: PNG_PATH, head: Uint8Array.from(Array.from("<html>hello!!", (c) => c.charCodeAt(0))) }),
    ).toMatchObject({ ok: false, code: "SIGNATURE_MISMATCH" });
  });

  it("head null atau terlalu pendek = gagal-tertutup", () => {
    expect(evaluateStoredMedia({ storagePath: JPG_PATH, head: null })).toMatchObject({ ok: false, code: "VERIFY_FAILED" });
    expect(evaluateStoredMedia({ storagePath: JPG_PATH, head: Uint8Array.from([0xff]) })).toMatchObject({
      ok: false,
      code: "VERIFY_FAILED",
    });
  });

  it("menolak ukuran total > 8 MB bila diketahui", () => {
    expect(evaluateStoredMedia({ storagePath: JPG_PATH, head: JPEG_HEAD, totalBytes: 8 * 1024 * 1024 }).ok).toBe(true);
    expect(evaluateStoredMedia({ storagePath: JPG_PATH, head: JPEG_HEAD, totalBytes: 8 * 1024 * 1024 + 1 })).toMatchObject({
      ok: false,
      code: "OUTPUT_TOO_LARGE",
    });
  });
});

describe("parseContentRangeTotal", () => {
  it("membaca total dari Content-Range", () => {
    expect(parseContentRangeTotal("bytes 0-11/12345")).toBe(12345);
    expect(parseContentRangeTotal(null)).toBeNull();
    expect(parseContentRangeTotal("bytes 0-11/*")).toBeNull();
  });
});

function response(status: number, body: Uint8Array | null, headers: Record<string, string> = {}): Response {
  return new Response(body ? (body as unknown as BodyInit) : null, { status, headers });
}

describe("fetchObjectHead", () => {
  it("mengirim Range 12 byte dan AbortSignal, lalu mengembalikan head + total", async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Range).toBe("bytes=0-11");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return response(206, JPEG_HEAD, { "content-range": "bytes 0-11/4096" });
    });
    const r = await fetchObjectHead("https://x/signed", fetchMock);
    expect(r?.totalBytes).toBe(4096);
    expect(Array.from(r!.head)).toEqual(Array.from(JPEG_HEAD));
  });

  it("server yang mengabaikan Range (200 berkas utuh) hanya dibaca 12 byte pertama", async () => {
    const big = new Uint8Array(5000);
    big.set(JPEG_HEAD, 0);
    const r = await fetchObjectHead("https://x/signed", async () => response(200, big, { "content-length": "5000" }));
    expect(r?.head.length).toBe(12);
    expect(r?.totalBytes).toBe(5000);
  });

  it("status lain, galat jaringan, dan timeout = null (gagal-tertutup)", async () => {
    expect(await fetchObjectHead("https://x", async () => response(403, null))).toBeNull();
    expect(
      await fetchObjectHead("https://x", async () => {
        throw new Error("network");
      }),
    ).toBeNull();
    // Timeout: AbortSignal.timeout(5000) dipanggil, dan sinyal yang sudah habis membuat fetch ditolak.
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timeout", "TimeoutError")));
    try {
      const timeoutFetch = async (_u: string, init?: RequestInit) => {
        if (init?.signal?.aborted) throw init.signal.reason;
        return response(206, JPEG_HEAD);
      };
      expect(await fetchObjectHead("https://x", timeoutFetch)).toBeNull();
      expect(spy).toHaveBeenCalledWith(5000);
    } finally {
      spy.mockRestore();
    }
  });
});

function bucket(overrides: Partial<StorageBucketLike> = {}): StorageBucketLike & {
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/signed" }, error: null })),
    remove: vi.fn(async () => ({ error: null })),
    ...overrides,
  } as StorageBucketLike & { remove: ReturnType<typeof vi.fn> };
}

describe("verifyUploadedObject", () => {
  it("objek sah: lolos dan TIDAK dihapus", async () => {
    const b = bucket();
    const r = await verifyUploadedObject(b, JPG_PATH, async () => response(206, JPEG_HEAD, { "content-range": "bytes 0-11/999" }));
    expect(r).toEqual({ ok: true, mime: "image/jpeg" });
    expect(b.remove).not.toHaveBeenCalled();
  });

  it("tanda tangan salah: ditolak dan objek dihapus", async () => {
    const b = bucket();
    const r = await verifyUploadedObject(b, JPG_PATH, async () => response(206, PNG_HEAD));
    expect(r).toMatchObject({ ok: false, code: "SIGNATURE_MISMATCH" });
    expect(b.remove).toHaveBeenCalledWith([JPG_PATH]);
  });

  it("timeout/galat fetch: gagal-tertutup dan objek dihapus", async () => {
    const b = bucket();
    const r = await verifyUploadedObject(b, JPG_PATH, async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    expect(r).toMatchObject({ ok: false, code: "VERIFY_FAILED" });
    expect(b.remove).toHaveBeenCalledWith([JPG_PATH]);
  });

  it("signed URL gagal dibuat: gagal-tertutup dan objek dihapus", async () => {
    const b = bucket({ createSignedUrl: vi.fn(async () => ({ data: null, error: { message: "denied" } })) });
    const r = await verifyUploadedObject(b, JPG_PATH, async () => response(206, JPEG_HEAD));
    expect(r).toMatchObject({ ok: false, code: "VERIFY_FAILED" });
    expect(b.remove).toHaveBeenCalledTimes(1);
  });

  it("kegagalan menghapus tidak melempar galat", async () => {
    const b = bucket({
      remove: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const r = await verifyUploadedObject(b, JPG_PATH, async () => response(500, null));
    expect(r.ok).toBe(false);
  });

  it("WebP ditolak dan dihapus", async () => {
    const b = bucket();
    const r = await verifyUploadedObject(b, WEBP_PATH, async () => response(206, WEBP_HEAD));
    expect(r).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(b.remove).toHaveBeenCalled();
  });
});

describe("batas waktu pada createSignedUrl dan remove (gagal-tertutup)", () => {
  it("createSignedUrl yang menggantung ditolak sebagai VERIFY_FAILED setelah 5 detik", async () => {
    vi.useFakeTimers();
    try {
      const b = bucket({ createSignedUrl: vi.fn(() => new Promise(() => undefined)) as unknown as StorageBucketLike["createSignedUrl"] });
      const pending = verifyUploadedObject(b, JPG_PATH, async () => response(206, JPEG_HEAD));
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(STORAGE_CALL_TIMEOUT_MS + 100);
      expect(await pending).toMatchObject({ ok: false, code: "VERIFY_FAILED" });
      expect(b.remove).toHaveBeenCalledWith([JPG_PATH]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("remove yang menggantung tidak menahan hasil gagal-tertutup melebihi batas waktu", async () => {
    vi.useFakeTimers();
    try {
      const b = bucket({ remove: vi.fn(() => new Promise(() => undefined)) as unknown as StorageBucketLike["remove"] });
      const pending = verifyUploadedObject(b, JPG_PATH, async () => response(206, PNG_HEAD));
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(STORAGE_CALL_TIMEOUT_MS + 100);
      expect(await pending).toMatchObject({ ok: false, code: "SIGNATURE_MISMATCH" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("withTimeout meneruskan hasil bila selesai tepat waktu", async () => {
    expect(await withTimeout(Promise.resolve(7), 50)).toBe(7);
  });
});
