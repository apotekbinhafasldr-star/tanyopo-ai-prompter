/**
 * Pembersihan metadata gambar (EXIF/XMP/IPTC/GPS) untuk unggah foto produk (Paket 2, L2).
 *
 * Dua bagian:
 * 1) Parser JPEG/PNG murni (tanpa DOM) untuk MENGECEK apakah byte berisi metadata dan mengenali format dari
 *    magic bytes. Dipakai tes dan verifikasi.
 * 2) `reencodeImageStrippingMetadata`: di klien, gambar didekode lalu digambar ulang lewat canvas. Hasil
 *    encode canvas tidak membawa metadata berkas asal. Orientasi dibenahi lebih dulu lewat
 *    createImageBitmap({ imageOrientation: "from-image" }) agar foto tidak berputar setelah EXIF hilang.
 *
 * Catatan jujur: pembersihan ini terjadi di peramban pengguna. Klien yang dimodifikasi dapat mengunggah
 * berkas apa saja langsung ke Storage; ini bukan batas keamanan (lihat docs/MEDIA_UPLOAD_HARDENING.md).
 */
import {
  storedMimeFor,
  validateDecodedPixels,
  validateOutputSize,
  type HardenedInputMime,
  type StoredImageMime,
  type UploadErrorCode,
} from "@/lib/media/media-upload-validation";

export type DetectedFormat = "jpeg" | "png" | "webp";

/** Mengenali format dari magic bytes. Null bila tidak dikenal atau terlalu pendek. */
export function detectImageFormat(bytes: Uint8Array): DetectedFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  // RIFF....WEBP: 12 byte pertama
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export interface MetadataReport {
  format: DetectedFormat | null;
  hasMetadata: boolean;
  /** Penanda yang ditemukan, mis. "APP1:Exif", "APP13", "COM", "eXIf", "tEXt". */
  markers: string[];
  /** true bila struktur terpotong/rusak sehingga pemindaian tidak tuntas (anggap TIDAK bersih). */
  malformed: boolean;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = "";
  for (let i = start; i < start + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function inspectJpeg(bytes: Uint8Array): MetadataReport {
  const markers: string[] = [];
  let malformed = false;
  let i = 2; // setelah SOI
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      malformed = true;
      break;
    }
    while (i < bytes.length && bytes[i] === 0xff) i++; // padding 0xFF
    if (i >= bytes.length) {
      malformed = true;
      break;
    }
    const marker = bytes[i++];
    if (marker === 0xd9) break; // EOI
    if (marker === 0xda) break; // SOS: data entropi dimulai, segmen metadata ada sebelum ini
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // marker tanpa panjang
    if (i + 2 > bytes.length) {
      malformed = true;
      break;
    }
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2 || i + length > bytes.length) {
      malformed = true;
      break;
    }
    if (marker === 0xe1) markers.push(`APP1:${ascii(bytes, i + 2, 4) === "Exif" ? "Exif" : "XMP/lain"}`);
    else if (marker === 0xed) markers.push("APP13");
    else if (marker === 0xfe) markers.push("COM");
    else if (marker === 0xe2) markers.push("APP2");
    i += length;
  }
  return { format: "jpeg", hasMetadata: markers.length > 0, markers, malformed };
}

const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

function inspectPng(bytes: Uint8Array): MetadataReport {
  const markers: string[] = [];
  let malformed = false;
  let i = 8;
  let sawEnd = false;
  while (i + 8 <= bytes.length) {
    const length = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const type = ascii(bytes, i + 4, 4);
    if (i + 12 + length > bytes.length) {
      malformed = true;
      break;
    }
    if (PNG_METADATA_CHUNKS.has(type)) markers.push(type);
    i += 12 + length;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) malformed = true;
  return { format: "png", hasMetadata: markers.length > 0, markers, malformed };
}

/** Memeriksa byte gambar utuh. WebP/format lain: tidak diperiksa (server menolak WebP; klien mengonversi). */
export function inspectImageMetadata(bytes: Uint8Array): MetadataReport {
  const format = detectImageFormat(bytes);
  if (format === "jpeg") return inspectJpeg(bytes);
  if (format === "png") return inspectPng(bytes);
  return { format, hasMetadata: false, markers: [], malformed: format === null };
}

/** Bersih = format JPEG/PNG dikenal, struktur utuh, dan tanpa penanda metadata. */
export function isMetadataFree(bytes: Uint8Array): boolean {
  const r = inspectImageMetadata(bytes);
  return (r.format === "jpeg" || r.format === "png") && !r.malformed && !r.hasMetadata;
}

// ---------------------------------------------------------------------------------------------------------
// Encode ulang di klien

/** Ketergantungan yang dapat disuntik agar bisa dites tanpa DOM sungguhan. */
export interface ReencodeDeps {
  createImageBitmap?: (
    blob: Blob,
    options?: { imageOrientation?: "from-image" | "none" },
  ) => Promise<{ width: number; height: number; close?: () => void }>;
  /** Menggambar bitmap ke canvas ukuran w x h dan mengembalikan Blob ber-mime (null bila gagal). */
  renderToBlob?: (
    bitmap: { width: number; height: number },
    width: number,
    height: number,
    mime: StoredImageMime,
    quality: number,
  ) => Promise<Blob | null>;
}

export type ReencodeResult =
  | { ok: true; blob: Blob; mime: StoredImageMime; width: number; height: number }
  | { ok: false; code: UploadErrorCode };

/** Urutan percobaan untuk menekan hasil ke <= 8 MB: kualitas turun dulu (JPEG), lalu skala dimensi. */
const JPEG_QUALITIES = [0.92, 0.85, 0.75] as const;
const SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.4] as const;

function defaultRenderToBlob(
  bitmap: { width: number; height: number },
  width: number,
  height: number,
  mime: StoredImageMime,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  if (mime === "image/jpeg") {
    // JPEG tidak punya alfa: latar putih agar PNG/WebP transparan tidak menjadi hitam.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, mime === "image/jpeg" ? quality : undefined));
}

/**
 * Mendekode, membenahi orientasi, menggambar ulang lewat canvas (membuang EXIF/XMP/IPTC/GPS), dan
 * memperkecil hingga hasil <= 8 MB. WebP menjadi JPEG. Kode galat dipisah per sebab:
 * - BROWSER_UNSUPPORTED: createImageBitmap tidak ada, atau opsi imageOrientation memicu TypeError.
 * - UNREADABLE: dekode gagal karena sebab lain (berkas rusak).
 * - TOO_MANY_PIXELS: > 150 MP (dicek sebelum menggambar ke canvas).
 * - OUTPUT_TOO_LARGE: masih > 8 MB setelah semua langkah pengecilan.
 */
export async function reencodeImageStrippingMetadata(
  file: Blob,
  inputMime: HardenedInputMime,
  deps: ReencodeDeps = {},
): Promise<ReencodeResult> {
  const create =
    deps.createImageBitmap ??
    (typeof globalThis.createImageBitmap === "function"
      ? (globalThis.createImageBitmap.bind(globalThis) as NonNullable<ReencodeDeps["createImageBitmap"]>)
      : undefined);
  if (!create) return { ok: false, code: "BROWSER_UNSUPPORTED" };
  const render = deps.renderToBlob ?? defaultRenderToBlob;

  let bitmap: { width: number; height: number; close?: () => void };
  try {
    bitmap = await create(file, { imageOrientation: "from-image" });
  } catch (err) {
    // Peramban lama menolak nilai enum imageOrientation dengan TypeError; selain itu berkas tak terbaca.
    return { ok: false, code: err instanceof TypeError ? "BROWSER_UNSUPPORTED" : "UNREADABLE" };
  }

  try {
    const pixels = validateDecodedPixels(bitmap.width, bitmap.height);
    if (!pixels.ok) return { ok: false, code: pixels.code };

    const mime = storedMimeFor(inputMime);
    const qualities = mime === "image/jpeg" ? JPEG_QUALITIES : ([1] as const);

    for (const scale of SCALE_STEPS) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      for (const quality of qualities) {
        let blob: Blob | null;
        try {
          blob = await render(bitmap, w, h, mime, quality);
        } catch {
          return { ok: false, code: "UNREADABLE" };
        }
        if (!blob || blob.size <= 0) return { ok: false, code: "UNREADABLE" };
        if (validateOutputSize(blob.size).ok) return { ok: true, blob, mime, width: w, height: h };
      }
    }
    return { ok: false, code: "OUTPUT_TOO_LARGE" };
  } finally {
    bitmap.close?.();
  }
}
