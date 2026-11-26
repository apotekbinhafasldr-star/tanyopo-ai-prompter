import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => currentSupabase) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentSupabase: any;

import { recordProductMediaAction } from "@/features/products/actions";

const UUID = "3f2b8c1e-5d4a-4b7c-9e1f-0a1b2c3d4e5f";
const RANDOM_PATH = `t1/p1/${UUID}.jpg`;
const LEGACY_PATH = "t1/p1/1700000000-foto.jpg";
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

function buildSupabase(rows: Array<{ position: number; media_type?: string }>, insertError: { message: string } | null = null) {
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const insert = vi.fn(async () => ({ error: insertError }));
  const from = vi.fn(() => ({ select, insert }));
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://x/signed" }, error: null }));
  const remove = vi.fn(async () => ({ error: null }));
  const storageFrom = vi.fn(() => ({ createSignedUrl, remove }));
  return { from, select, limit, insert, storage: { from: storageFrom }, createSignedUrl, remove, storageFrom };
}

describe("recordProductMediaAction, flag MATI (perilaku lama)", () => {
  beforeEach(() => {
    vi.stubEnv("MEDIA_UPLOAD_HARDENING_ENABLED", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("memakai kueri lama (hanya kolom position, limit 1), tidak memverifikasi, tidak menyentuh Storage", async () => {
    currentSupabase = buildSupabase([{ position: 4 }]);
    const r = await recordProductMediaAction("p1", LEGACY_PATH, "IMAGE");
    expect(r).toEqual({ error: null });
    expect(currentSupabase.select).toHaveBeenCalledWith("position");
    expect(currentSupabase.limit).toHaveBeenCalledWith(1);
    expect(currentSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ storage_path: LEGACY_PATH, media_type: "IMAGE", position: 5, tenant_id: "t1", product_id: "p1" }),
    );
    expect(currentSupabase.storage.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tetap menerima VIDEO dan nama berkas bebas", async () => {
    currentSupabase = buildSupabase([]);
    expect(await recordProductMediaAction("p1", "t1/p1/123-klip.mp4", "VIDEO")).toEqual({ error: null });
    expect(currentSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({ media_type: "VIDEO", position: 0 }));
  });

  it("tetap menolak path milik produk/tenant lain", async () => {
    currentSupabase = buildSupabase([]);
    expect(await recordProductMediaAction("p1", "t2/p1/x.jpg", "IMAGE")).toEqual({ error: "Media tidak valid untuk produk ini." });
    expect(currentSupabase.insert).not.toHaveBeenCalled();
  });

  it("nilai flag selain persis \"true\" tetap MATI", async () => {
    vi.stubEnv("MEDIA_UPLOAD_HARDENING_ENABLED", "TRUE");
    currentSupabase = buildSupabase([]);
    expect(await recordProductMediaAction("p1", LEGACY_PATH, "IMAGE")).toEqual({ error: null });
    expect(currentSupabase.select).toHaveBeenCalledWith("position");
  });
});

describe("recordProductMediaAction, flag AKTIF", () => {
  beforeEach(() => {
    vi.stubEnv("MEDIA_UPLOAD_HARDENING_ENABLED", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JPEG_HEAD as unknown as BodyInit, { status: 206, headers: { "content-range": "bytes 0-11/2048" } })),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("jalur sah: verifikasi lolos lalu baris dicatat dengan posisi berikutnya", async () => {
    currentSupabase = buildSupabase([{ position: 2, media_type: "IMAGE" }]);
    expect(await recordProductMediaAction("p1", RANDOM_PATH, "IMAGE")).toEqual({ error: null });
    expect(currentSupabase.select).toHaveBeenCalledWith("position, media_type");
    expect(currentSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({ position: 3, media_type: "IMAGE" }));
    expect(currentSupabase.remove).not.toHaveBeenCalled();
  });

  it("menolak VIDEO dan path berformat lama/WebP tanpa mencatat", async () => {
    currentSupabase = buildSupabase([]);
    expect(await recordProductMediaAction("p1", RANDOM_PATH, "VIDEO")).toMatchObject({ error: expect.stringMatching(/hanya menerima foto/) });
    expect(await recordProductMediaAction("p1", LEGACY_PATH, "IMAGE")).toMatchObject({ error: expect.stringMatching(/tidak didukung/) });
    expect(await recordProductMediaAction("p1", `t1/p1/${UUID}.webp`, "IMAGE")).toMatchObject({ error: expect.stringMatching(/tidak didukung/) });
    expect(currentSupabase.insert).not.toHaveBeenCalled();
  });

  it("kuota: 20 foto menolak; 30 video lama TIDAK memblokir foto baru", async () => {
    currentSupabase = buildSupabase(Array.from({ length: 20 }, (_, i) => ({ position: 20 - i, media_type: "IMAGE" })));
    expect(await recordProductMediaAction("p1", RANDOM_PATH, "IMAGE")).toMatchObject({ error: expect.stringMatching(/Batas 20 foto/) });
    expect(currentSupabase.insert).not.toHaveBeenCalled();

    currentSupabase = buildSupabase(Array.from({ length: 30 }, (_, i) => ({ position: 30 - i, media_type: "VIDEO" })));
    expect(await recordProductMediaAction("p1", RANDOM_PATH, "IMAGE")).toEqual({ error: null });
  });

  it("kuota gagal-terbuka bila baris terpindai mencapai 50", async () => {
    currentSupabase = buildSupabase(Array.from({ length: 50 }, (_, i) => ({ position: 50 - i, media_type: "IMAGE" })));
    expect(await recordProductMediaAction("p1", RANDOM_PATH, "IMAGE")).toEqual({ error: null });
  });

  it("verifikasi gagal (timeout/jaringan): ditolak, objek dihapus, tidak dicatat (gagal-tertutup)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    }));
    currentSupabase = buildSupabase([]);
    const r = await recordProductMediaAction("p1", RANDOM_PATH, "IMAGE");
    expect(r.error).toMatch(/belum dapat diverifikasi/);
    expect(currentSupabase.remove).toHaveBeenCalledWith([RANDOM_PATH]);
    expect(currentSupabase.insert).not.toHaveBeenCalled();
  });

  it("isi bukan JPEG/PNG: ditolak dan objek dihapus", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(12).fill(0x41) as unknown as BodyInit, { status: 206 })));
    currentSupabase = buildSupabase([]);
    const r = await recordProductMediaAction("p1", RANDOM_PATH, "IMAGE");
    expect(r.error).toMatch(/tidak sesuai format/);
    expect(currentSupabase.remove).toHaveBeenCalledWith([RANDOM_PATH]);
  });
});
