// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  HARDENED_MAX_IMAGES_PER_PRODUCT,
  HARDENED_MAX_INPUT_BYTES,
  HARDENED_MAX_OUTPUT_BYTES,
  HARDENED_QUOTA_SCAN_LIMIT,
  MAX_DECODED_PIXELS,
  UPLOAD_ERROR_MESSAGES,
  buildRandomMediaPath,
  countImageRows,
  evaluateImageQuota,
  isRandomMediaPath,
  mimeFromPathExtension,
  storedMimeFor,
  validateDecodedPixels,
  validateInputFile,
  validateOutputSize,
} from "@/lib/media/media-upload-validation";

const MB = 1024 * 1024;
const UUID = "3f2b8c1e-5d4a-4b7c-9e1f-0a1b2c3d4e5f";

describe("validateInputFile (batas masukan klien 25 MB)", () => {
  it("menerima 12 MB JPG", () => {
    expect(validateInputFile({ name: "a.jpg", type: "image/jpeg", size: 12 * MB })).toEqual({
      ok: true,
      mime: "image/jpeg",
    });
  });

  it("menerima tepat 25 MB, menolak 26 MB dengan pesan khusus berkas > 25 MB", () => {
    expect(validateInputFile({ name: "a.png", type: "image/png", size: HARDENED_MAX_INPUT_BYTES }).ok).toBe(true);
    const r = validateInputFile({ name: "a.png", type: "image/png", size: 26 * MB });
    expect(r).toMatchObject({ ok: false, code: "INPUT_TOO_LARGE" });
    if (!r.ok) expect(r.message).toContain("25 MB");
  });

  it("menerima WebP sebagai masukan", () => {
    expect(validateInputFile({ name: "a.webp", type: "image/webp", size: MB })).toMatchObject({
      ok: true,
      mime: "image/webp",
    });
  });

  it("menolak HEIC/HEIF dan format lain sebagai format tidak didukung", () => {
    for (const type of ["image/heic", "image/heif", "image/gif", "application/pdf", "video/mp4"]) {
      const r = validateInputFile({ name: "x", type, size: MB });
      expect(r).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    }
    const heic = validateInputFile({ name: "IMG_1.HEIC", type: "image/heic", size: MB });
    if (!heic.ok) expect(heic.message).toContain("HEIC");
  });

  it("memakai ekstensi hanya bila type kosong (beberapa peramban Android)", () => {
    expect(validateInputFile({ name: "foto.JPG", type: "", size: MB })).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(validateInputFile({ name: "foto.heic", type: "", size: MB })).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_FORMAT",
    });
    // type terisi yang tak dikenal tidak diselamatkan oleh ekstensi
    expect(validateInputFile({ name: "foto.jpg", type: "image/heic", size: MB }).ok).toBe(false);
  });

  it("menolak berkas kosong sebagai tidak terbaca", () => {
    expect(validateInputFile({ name: "a.jpg", type: "image/jpeg", size: 0 })).toMatchObject({
      ok: false,
      code: "UNREADABLE",
    });
  });
});

describe("validateOutputSize (batas hasil 8 MB)", () => {
  it("menerima tepat 8 MB, menolak 8 MB + 1 byte", () => {
    expect(validateOutputSize(HARDENED_MAX_OUTPUT_BYTES).ok).toBe(true);
    expect(validateOutputSize(HARDENED_MAX_OUTPUT_BYTES + 1)).toMatchObject({ ok: false, code: "OUTPUT_TOO_LARGE" });
  });
  it("pesan hasil akhir > 8 MB berbeda dari pesan masukan > 25 MB", () => {
    expect(UPLOAD_ERROR_MESSAGES.OUTPUT_TOO_LARGE).toContain("8 MB");
    expect(UPLOAD_ERROR_MESSAGES.OUTPUT_TOO_LARGE).not.toBe(UPLOAD_ERROR_MESSAGES.INPUT_TOO_LARGE);
  });
});

describe("validateDecodedPixels (150 megapiksel)", () => {
  it("menerima tepat 150 MP, menolak di atasnya", () => {
    expect(validateDecodedPixels(15000, 10000).ok).toBe(true);
    expect(MAX_DECODED_PIXELS).toBe(150_000_000);
    expect(validateDecodedPixels(15001, 10000)).toMatchObject({ ok: false, code: "TOO_MANY_PIXELS" });
  });
  it("dimensi tidak valid = tidak terbaca", () => {
    expect(validateDecodedPixels(0, 100)).toMatchObject({ ok: false, code: "UNREADABLE" });
    expect(validateDecodedPixels(Number.NaN, 100)).toMatchObject({ ok: false, code: "UNREADABLE" });
  });
});

describe("pesan galat terpisah per sebab", () => {
  it("setiap sebab punya pesan unik, Bahasa Indonesia, dan tidak ada pesan generik 'Kecilkan foto'", () => {
    const messages = Object.values(UPLOAD_ERROR_MESSAGES);
    expect(new Set(messages).size).toBe(messages.length);
    for (const m of messages) expect(m).not.toMatch(/kecilkan foto/i);
    expect(UPLOAD_ERROR_MESSAGES.BROWSER_UNSUPPORTED).not.toBe(UPLOAD_ERROR_MESSAGES.UNREADABLE);
    expect(UPLOAD_ERROR_MESSAGES.UPLOAD_FAILED).toMatch(/jaringan|koneksi/i);
    expect(UPLOAD_ERROR_MESSAGES.TOO_MANY_PIXELS).toContain("150 megapiksel");
    expect(UPLOAD_ERROR_MESSAGES.VIDEO_NOT_ALLOWED).toContain("foto JPG, PNG, atau WebP");
    expect(UPLOAD_ERROR_MESSAGES.VIDEO_NOT_ALLOWED).toMatch(/video belum bisa diunggah/i);
    expect(UPLOAD_ERROR_MESSAGES.INVALID_PATH).not.toBe(UPLOAD_ERROR_MESSAGES.UNSUPPORTED_FORMAT);
  });
});

describe("storedMimeFor", () => {
  it("WebP menjadi JPEG; JPEG dan PNG tetap", () => {
    expect(storedMimeFor("image/webp")).toBe("image/jpeg");
    expect(storedMimeFor("image/jpeg")).toBe("image/jpeg");
    expect(storedMimeFor("image/png")).toBe("image/png");
  });
});

describe("nama berkas acak dan path", () => {
  it("buildRandomMediaPath memakai uuid acak, ekstensi sesuai mime, dan tanpa nama asli", () => {
    expect(buildRandomMediaPath("t1", "p1", "image/jpeg", UUID)).toBe(`t1/p1/${UUID}.jpg`);
    expect(buildRandomMediaPath("t1", "p1", "image/png", UUID)).toBe(`t1/p1/${UUID}.png`);
    const a = buildRandomMediaPath("t1", "p1", "image/jpeg");
    const b = buildRandomMediaPath("t1", "p1", "image/jpeg");
    expect(a).not.toBe(b);
    expect(isRandomMediaPath(a, "t1", "p1")).toBe(true);
  });

  it("isRandomMediaPath menerima jpg/jpeg/png dan menolak webp, nama bebas, dan folder lain", () => {
    expect(isRandomMediaPath(`t1/p1/${UUID}.jpg`, "t1", "p1")).toBe(true);
    expect(isRandomMediaPath(`t1/p1/${UUID}.jpeg`, "t1", "p1")).toBe(true);
    expect(isRandomMediaPath(`t1/p1/${UUID}.png`, "t1", "p1")).toBe(true);
    expect(isRandomMediaPath(`t1/p1/${UUID}.webp`, "t1", "p1")).toBe(false);
    expect(isRandomMediaPath("t1/p1/1700000000-foto-asli.jpg", "t1", "p1")).toBe(false);
    expect(isRandomMediaPath(`t2/p1/${UUID}.jpg`, "t1", "p1")).toBe(false);
    expect(isRandomMediaPath(`t1/p2/${UUID}.jpg`, "t1", "p1")).toBe(false);
    expect(isRandomMediaPath(`t1/p1/sub/${UUID}.jpg`, "t1", "p1")).toBe(false);
    expect(isRandomMediaPath(`t1/p1/${UUID}.jpg.exe`, "t1", "p1")).toBe(false);
  });

  it("mimeFromPathExtension: hanya jpg/jpeg/png; webp dan lainnya null", () => {
    expect(mimeFromPathExtension("a/b/c.JPG")).toBe("image/jpeg");
    expect(mimeFromPathExtension("a/b/c.jpeg")).toBe("image/jpeg");
    expect(mimeFromPathExtension("a/b/c.png")).toBe("image/png");
    expect(mimeFromPathExtension("a/b/c.webp")).toBeNull();
    expect(mimeFromPathExtension("a/b/c.mp4")).toBeNull();
    expect(mimeFromPathExtension("a/b/c")).toBeNull();
  });
});

describe("kuota foto per produk", () => {
  const img = { media_type: "IMAGE" };
  const vid = { media_type: "VIDEO" };

  it("hanya baris IMAGE yang dihitung", () => {
    expect(countImageRows([img, vid, vid, img])).toBe(2);
    expect(countImageRows(null)).toBe(0);
  });

  it("video lama tidak memblokir foto baru", () => {
    const rows = Array.from({ length: 30 }, () => vid);
    expect(evaluateImageQuota(rows)).toMatchObject({ allowed: true, failOpen: false, imageCount: 0 });
  });

  it("memblokir bila foto sudah mencapai batas", () => {
    const rows = Array.from({ length: HARDENED_MAX_IMAGES_PER_PRODUCT }, () => img);
    expect(evaluateImageQuota(rows)).toMatchObject({ allowed: false, imageCount: HARDENED_MAX_IMAGES_PER_PRODUCT });
    expect(evaluateImageQuota(rows.slice(1)).allowed).toBe(true);
  });

  it("GAGAL-TERBUKA bila baris terpindai mencapai batas pindai (>= 50): hitungan tidak terbukti lengkap", () => {
    const rows = Array.from({ length: HARDENED_QUOTA_SCAN_LIMIT }, () => img);
    expect(evaluateImageQuota(rows)).toMatchObject({ allowed: true, failOpen: true });
  });

  it("GAGAL-TERBUKA bila kueri gagal (rows null)", () => {
    expect(evaluateImageQuota(null)).toMatchObject({ allowed: true, failOpen: true });
  });
});
