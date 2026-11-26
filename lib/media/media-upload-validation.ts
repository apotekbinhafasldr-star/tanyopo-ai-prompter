/**
 * Validasi murni (tanpa I/O, tanpa DOM) untuk unggah foto produk yang diperkeras (Paket 2, L2).
 * Dipakai bersama oleh klien (media-uploader.tsx) dan server (hardened-upload-server.ts, actions.ts).
 *
 * Catatan jujur: validasi ini membantu kejujuran UX dan kebersihan data. Ini BUKAN batas keamanan:
 * klien dapat dilewati (unggah langsung browser ke Storage). Lihat docs/MEDIA_UPLOAD_HARDENING.md.
 */

/** Batas ukuran berkas MASUKAN di klien, sebelum di-encode ulang. */
export const HARDENED_MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Batas ukuran HASIL akhir (setelah encode ulang di klien, dicek lagi di server). */
export const HARDENED_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** Batas piksel hasil dekode (lebar x tinggi): 150 megapiksel. */
export const MAX_DECODED_PIXELS = 150_000_000;
/** Maks. foto (baris media_type IMAGE) per produk saat mode diperkeras aktif. */
export const HARDENED_MAX_IMAGES_PER_PRODUCT = 20;
/**
 * Jumlah baris media maksimum yang dipindai server untuk menghitung kuota. Bila hasil pindai mencapai
 * batas ini, jumlah foto sebenarnya tidak terbukti dari satu halaman data, sehingga kuota GAGAL-TERBUKA
 * (unggahan diizinkan). Disengaja: lebih baik tidak memblokir tenant yang sah daripada salah menolak.
 */
export const HARDENED_QUOTA_SCAN_LIMIT = 50;

/** Format masukan yang diterima klien. WebP dikonversi ke JPEG di klien. */
export const HARDENED_INPUT_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type HardenedInputMime = (typeof HARDENED_INPUT_MIMES)[number];

/** Satu-satunya format yang boleh TERSIMPAN di Storage pada mode diperkeras (preflight Meta: hanya JPG/PNG). */
export type StoredImageMime = "image/jpeg" | "image/png";

export type UploadErrorCode =
  | "INPUT_TOO_LARGE"
  | "OUTPUT_TOO_LARGE"
  | "TOO_MANY_PIXELS"
  | "UNSUPPORTED_FORMAT"
  | "BROWSER_UNSUPPORTED"
  | "UNREADABLE"
  | "UPLOAD_FAILED"
  | "VERIFY_FAILED"
  | "SIGNATURE_MISMATCH"
  | "QUOTA_EXCEEDED"
  | "VIDEO_NOT_ALLOWED"
  | "INVALID_PATH";

/** Pesan terpisah per sebab, Bahasa Indonesia. Sengaja tidak ada pesan generik "Kecilkan foto". */
export const UPLOAD_ERROR_MESSAGES: Record<UploadErrorCode, string> = {
  INPUT_TOO_LARGE:
    "Berkas lebih besar dari 25 MB sehingga tidak dapat diproses. Pilih foto lain, atau ambil ulang dengan resolusi kamera lebih rendah.",
  OUTPUT_TOO_LARGE:
    "Foto masih lebih besar dari 8 MB setelah diperkecil otomatis. Gunakan foto dengan resolusi lebih rendah.",
  TOO_MANY_PIXELS:
    "Resolusi foto melebihi 150 megapiksel dan tidak dapat diproses. Gunakan foto dengan resolusi lebih rendah.",
  UNSUPPORTED_FORMAT:
    "Format foto tidak didukung (misalnya HEIC). Gunakan foto JPG, PNG, atau WebP.",
  BROWSER_UNSUPPORTED:
    "Peramban ini belum mendukung pemrosesan foto otomatis. Perbarui peramban Anda atau gunakan Chrome versi terbaru, lalu coba lagi.",
  UNREADABLE: "Foto tidak dapat dibaca. Berkasnya mungkin rusak; pilih foto lain.",
  UPLOAD_FAILED: "Unggahan gagal. Periksa koneksi internet Anda lalu coba lagi.",
  VERIFY_FAILED: "Foto yang diunggah belum dapat diverifikasi, sehingga dibatalkan. Coba unggah lagi.",
  SIGNATURE_MISMATCH: "Isi berkas tidak sesuai format JPG atau PNG, sehingga dibatalkan. Pilih foto lain.",
  QUOTA_EXCEEDED: `Batas ${HARDENED_MAX_IMAGES_PER_PRODUCT} foto per produk sudah tercapai. Hapus foto yang tidak dipakai, lalu coba lagi.`,
  VIDEO_NOT_ALLOWED: "Mode unggah foto yang diperkeras hanya menerima foto JPG atau PNG, bukan video.",
  INVALID_PATH: "Media tidak valid untuk produk ini.",
};

export type ValidationResult<T> = ({ ok: true } & T) | { ok: false; code: UploadErrorCode; message: string };

function fail(code: UploadErrorCode): { ok: false; code: UploadErrorCode; message: string } {
  return { ok: false, code, message: UPLOAD_ERROR_MESSAGES[code] };
}

const EXTENSION_TO_INPUT_MIME: Record<string, HardenedInputMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Ekstensi berkas huruf kecil tanpa titik, atau "" bila tidak ada. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Menentukan MIME masukan. Beberapa peramban Android memberi `file.type` kosong, jadi ekstensi dipakai
 * hanya bila type kosong. Type yang terisi dan tidak dikenal (mis. image/heic) selalu ditolak.
 */
export function resolveInputMime(file: { name: string; type: string }): HardenedInputMime | null {
  const type = file.type.trim().toLowerCase();
  if (type) return (HARDENED_INPUT_MIMES as readonly string[]).includes(type) ? (type as HardenedInputMime) : null;
  return EXTENSION_TO_INPUT_MIME[extensionOf(file.name)] ?? null;
}

/** Cek berkas masukan SEBELUM encode ulang: format, lalu ukuran (25 MB). */
export function validateInputFile(file: { name: string; type: string; size: number }): ValidationResult<{
  mime: HardenedInputMime;
}> {
  const mime = resolveInputMime(file);
  if (!mime) return fail("UNSUPPORTED_FORMAT");
  if (!Number.isFinite(file.size) || file.size <= 0) return fail("UNREADABLE");
  if (file.size > HARDENED_MAX_INPUT_BYTES) return fail("INPUT_TOO_LARGE");
  return { ok: true, mime };
}

/** Cek piksel hasil dekode (lebar x tinggi). Tidak valid atau > 150 MP ditolak. */
export function validateDecodedPixels(width: number, height: number): ValidationResult<{ pixels: number }> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fail("UNREADABLE");
  const pixels = width * height;
  if (pixels > MAX_DECODED_PIXELS) return fail("TOO_MANY_PIXELS");
  return { ok: true, pixels };
}

/** Cek ukuran HASIL akhir (maks. 8 MB), dipakai di klien dan server. */
export function validateOutputSize(bytes: number): ValidationResult<{ bytes: number }> {
  if (!Number.isFinite(bytes) || bytes <= 0) return fail("UNREADABLE");
  if (bytes > HARDENED_MAX_OUTPUT_BYTES) return fail("OUTPUT_TOO_LARGE");
  return { ok: true, bytes };
}

/** Format tersimpan untuk suatu masukan: WebP menjadi JPEG, lainnya tetap. */
export function storedMimeFor(input: HardenedInputMime): StoredImageMime {
  return input === "image/png" ? "image/png" : "image/jpeg";
}

export function extensionForStoredMime(mime: StoredImageMime): "jpg" | "png" {
  return mime === "image/png" ? "png" : "jpg";
}

// ---------------------------------------------------------------------------------------------------------
// Nama berkas acak dan path

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const RANDOM_FILE_RE = new RegExp(`^${UUID_V4}\\.(jpg|jpeg|png)$`);

/** UUID v4 acak (huruf kecil). Memakai crypto global; tanpa Math.random. Gagal-tertutup bila crypto tidak ada. */
export function randomUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().toLowerCase();
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error("crypto tidak tersedia");
}

/**
 * Path tersimpan: `<tenant>/<produk>/<uuid-acak>.<jpg|png>`. Tidak memuat nama berkas asli sama sekali,
 * dan tetap di folder tenant/produk seperti pola sebelumnya (isOwnProductMediaPath tetap berlaku).
 */
export function buildRandomMediaPath(
  tenantId: string,
  productId: string,
  mime: StoredImageMime,
  uuid: string = randomUuid(),
): string {
  return `${tenantId}/${productId}/${uuid}.${extensionForStoredMime(mime)}`;
}

/** Benar hanya bila path = `<tenant>/<produk>/<uuid v4>.(jpg|jpeg|png)`. WebP dan nama bebas ditolak. */
export function isRandomMediaPath(storagePath: string, tenantId: string, productId: string): boolean {
  const prefix = `${tenantId}/${productId}/`;
  if (!storagePath.startsWith(prefix)) return false;
  return RANDOM_FILE_RE.test(storagePath.slice(prefix.length));
}

/** MIME dari ekstensi path. Hanya jpg/jpeg/png; webp dan lainnya = null. */
export function mimeFromPathExtension(storagePath: string): StoredImageMime | null {
  const ext = extensionOf(storagePath);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Kuota

export interface MediaRowForQuota {
  media_type: string | null;
}

/** Hanya baris IMAGE yang dihitung. Video lama tidak memblokir foto baru. */
export function countImageRows(rows: readonly MediaRowForQuota[] | null | undefined): number {
  return (rows ?? []).filter((r) => r.media_type === "IMAGE").length;
}

/**
 * Kuota foto per produk. GAGAL-TERBUKA bila jumlah baris terpindai mencapai HARDENED_QUOTA_SCAN_LIMIT (50):
 * data tidak lengkap, jadi tidak dapat dibuktikan bahwa kuota terlampaui, dan unggahan tidak diblokir.
 * Juga gagal-terbuka bila rows null/undefined (kueri gagal): kuota adalah kenyamanan, bukan batas keamanan.
 */
export function evaluateImageQuota(
  rows: readonly MediaRowForQuota[] | null | undefined,
): { allowed: true; failOpen: boolean; imageCount: number } | { allowed: false; imageCount: number } {
  if (!rows) return { allowed: true, failOpen: true, imageCount: 0 };
  const imageCount = countImageRows(rows);
  if (rows.length >= HARDENED_QUOTA_SCAN_LIMIT) return { allowed: true, failOpen: true, imageCount };
  if (imageCount >= HARDENED_MAX_IMAGES_PER_PRODUCT) return { allowed: false, imageCount };
  return { allowed: true, failOpen: false, imageCount };
}
