// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  inspectImageMetadata,
  isMetadataFree,
  reencodeImageStrippingMetadata,
  type ReencodeDeps,
} from "@/lib/media/strip-image-metadata";

const u8 = (...n: number[]) => Uint8Array.from(n);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: number[][]) => Uint8Array.from(parts.flat());

/** Segmen JPEG: FF <marker> <len hi lo> <payload> */
const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const SOI = [0xff, 0xd8];
const SOS_EOI = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9];

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...ascii(type), ...data, 0, 0, 0, 0];
}
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("detectImageFormat (magic bytes)", () => {
  it("mengenali JPEG, PNG, WebP", () => {
    expect(detectImageFormat(u8(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(detectImageFormat(cat(PNG_SIG))).toBe("png");
    expect(detectImageFormat(cat(ascii("RIFF"), [1, 2, 3, 4], ascii("WEBP")))).toBe("webp");
  });
  it("null untuk HEIC, teks, atau terlalu pendek", () => {
    expect(detectImageFormat(cat([0, 0, 0, 0x18], ascii("ftypheic")))).toBeNull();
    expect(detectImageFormat(u8(0xff, 0xd8))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
    expect(detectImageFormat(cat(ascii("<html>")))).toBeNull();
  });
});

describe("inspectImageMetadata JPEG", () => {
  it("JPEG tanpa metadata dinilai bersih", () => {
    const bytes = cat(SOI, seg(0xe0, ascii("JFIF\0")), SOS_EOI);
    expect(isMetadataFree(bytes)).toBe(true);
  });
  it("mendeteksi EXIF (APP1) dan GPS di dalamnya", () => {
    const bytes = cat(SOI, seg(0xe1, [...ascii("Exif\0\0"), 1, 2, 3]), SOS_EOI);
    const r = inspectImageMetadata(bytes);
    expect(r.hasMetadata).toBe(true);
    expect(r.markers).toContain("APP1:Exif");
    expect(isMetadataFree(bytes)).toBe(false);
  });
  it("mendeteksi XMP (APP1 non-Exif), IPTC (APP13), dan komentar (COM)", () => {
    expect(inspectImageMetadata(cat(SOI, seg(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0")), SOS_EOI)).markers).toEqual([
      "APP1:XMP/lain",
    ]);
    expect(inspectImageMetadata(cat(SOI, seg(0xed, [1, 2]), SOS_EOI)).markers).toEqual(["APP13"]);
    expect(inspectImageMetadata(cat(SOI, seg(0xfe, ascii("halo")), SOS_EOI)).markers).toEqual(["COM"]);
  });
  it("struktur terpotong dinilai TIDAK bersih (gagal-tertutup)", () => {
    const truncated = cat(SOI, [0xff, 0xe1, 0x01, 0x00, 1, 2, 3]);
    const r = inspectImageMetadata(truncated);
    expect(r.malformed).toBe(true);
    expect(isMetadataFree(truncated)).toBe(false);
  });
});

describe("inspectImageMetadata PNG", () => {
  const ihdr = chunk("IHDR", new Array(13).fill(0));
  const idat = chunk("IDAT", [1, 2, 3]);
  const iend = chunk("IEND", []);

  it("PNG tanpa chunk metadata bersih", () => {
    expect(isMetadataFree(cat(PNG_SIG, ihdr, idat, iend))).toBe(true);
  });
  it("mendeteksi eXIf, tEXt, iTXt, zTXt, tIME", () => {
    for (const type of ["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]) {
      const r = inspectImageMetadata(cat(PNG_SIG, ihdr, chunk(type, [1, 2]), idat, iend));
      expect(r.hasMetadata, type).toBe(true);
      expect(r.markers).toContain(type);
    }
  });
  it("PNG tanpa IEND dinilai tidak bersih", () => {
    expect(isMetadataFree(cat(PNG_SIG, ihdr, idat))).toBe(false);
  });
  it("WebP dan format tak dikenal tidak pernah dinilai bersih", () => {
    expect(isMetadataFree(cat(ascii("RIFF"), [1, 2, 3, 4], ascii("WEBP")))).toBe(false);
    expect(isMetadataFree(cat(ascii("hello world")))).toBe(false);
  });
});

describe("reencodeImageStrippingMetadata", () => {
  const file = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
  const bitmap = (w: number, h: number) => ({ width: w, height: h, close: () => undefined });
  const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)]);

  it("memakai imageOrientation 'from-image' dan menghasilkan blob + mime tersimpan", async () => {
    let seenOptions: unknown;
    const deps: ReencodeDeps = {
      createImageBitmap: async (_b, o) => {
        seenOptions = o;
        return bitmap(4000, 3000);
      },
      renderToBlob: async () => blobOf(2 * 1024 * 1024),
    };
    const r = await reencodeImageStrippingMetadata(file, "image/jpeg", deps);
    expect(seenOptions).toEqual({ imageOrientation: "from-image" });
    expect(r).toMatchObject({ ok: true, mime: "image/jpeg", width: 4000, height: 3000 });
  });

  it("WebP menjadi JPEG; PNG tetap PNG", async () => {
    const deps: ReencodeDeps = {
      createImageBitmap: async () => bitmap(100, 100),
      renderToBlob: async () => blobOf(1000),
    };
    expect(await reencodeImageStrippingMetadata(file, "image/webp", deps)).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(await reencodeImageStrippingMetadata(file, "image/png", deps)).toMatchObject({ ok: true, mime: "image/png" });
  });

  it("TypeError dari imageOrientation = peramban belum mendukung (bukan 'tidak terbaca')", async () => {
    const r = await reencodeImageStrippingMetadata(file, "image/jpeg", {
      createImageBitmap: async () => {
        throw new TypeError("The provided value 'from-image' is not a valid enum value of type ImageOrientation");
      },
    });
    expect(r).toEqual({ ok: false, code: "BROWSER_UNSUPPORTED" });
  });

  it("galat dekode lain = tidak terbaca", async () => {
    const r = await reencodeImageStrippingMetadata(file, "image/jpeg", {
      createImageBitmap: async () => {
        throw new Error("InvalidStateError");
      },
    });
    expect(r).toEqual({ ok: false, code: "UNREADABLE" });
  });

  it("> 150 MP ditolak SEBELUM menggambar ke canvas", async () => {
    let rendered = false;
    const r = await reencodeImageStrippingMetadata(file, "image/jpeg", {
      createImageBitmap: async () => bitmap(20000, 10000),
      renderToBlob: async () => {
        rendered = true;
        return blobOf(10);
      },
    });
    expect(r).toEqual({ ok: false, code: "TOO_MANY_PIXELS" });
    expect(rendered).toBe(false);
  });

  it("memperkecil bertahap sampai <= 8 MB", async () => {
    const calls: Array<{ w: number; q: number }> = [];
    const r = await reencodeImageStrippingMetadata(file, "image/jpeg", {
      createImageBitmap: async () => bitmap(4000, 3000),
      renderToBlob: async (_b, w, _h, _m, q) => {
        calls.push({ w, q });
        return blobOf(w >= 4000 ? 12 * 1024 * 1024 : 5 * 1024 * 1024);
      },
    });
    expect(r).toMatchObject({ ok: true });
    expect(calls.length).toBeGreaterThan(1);
    if (r.ok) expect(r.width).toBeLessThan(4000);
  });

  it("masih > 8 MB setelah semua langkah = OUTPUT_TOO_LARGE", async () => {
    const r = await reencodeImageStrippingMetadata(file, "image/png", {
      createImageBitmap: async () => bitmap(4000, 3000),
      renderToBlob: async () => blobOf(9 * 1024 * 1024),
    });
    expect(r).toEqual({ ok: false, code: "OUTPUT_TOO_LARGE" });
  });

  it("canvas gagal menghasilkan blob = tidak terbaca, dan bitmap selalu ditutup", async () => {
    let closed = false;
    const r = await reencodeImageStrippingMetadata(file, "image/jpeg", {
      createImageBitmap: async () => ({ width: 10, height: 10, close: () => void (closed = true) }),
      renderToBlob: async () => null,
    });
    expect(r).toEqual({ ok: false, code: "UNREADABLE" });
    expect(closed).toBe(true);
  });

  it("tanpa createImageBitmap sama sekali = peramban belum mendukung", async () => {
    const original = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    try {
      expect(await reencodeImageStrippingMetadata(file, "image/jpeg")).toEqual({ ok: false, code: "BROWSER_UNSUPPORTED" });
    } finally {
      if (original) (globalThis as { createImageBitmap?: unknown }).createImageBitmap = original;
    }
  });
});
