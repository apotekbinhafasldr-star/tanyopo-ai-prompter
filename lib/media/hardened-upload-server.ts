/**
 * Verifikasi sisi server untuk unggah foto produk yang diperkeras (Paket 2, L2).
 *
 * BATAS JUJUR, BACA SEBELUM MENGANDALKAN BERKAS INI:
 * - L2 BUKAN batas keamanan. Browser mengunggah LANGSUNG ke Supabase Storage (bucket product-media); server
 *   hanya diberi tahu path-nya lewat recordProductMediaAction. Klien yang dimodifikasi dapat mengunggah
 *   berkas apa pun tanpa pernah memanggil action itu, sehingga pemeriksaan di sini tidak pernah terjalankan.
 * - Tenant dapat menimpa/mengganti objek miliknya SETELAH diverifikasi, karena policy storage.objects yang ada
 *   (FOR ALL/UPDATE per folder tenant) mengizinkannya. Verifikasi di sini adalah foto sesaat, bukan jaminan.
 * - Penegakan nyata butuh L1 (batas ukuran/MIME di tingkat bucket) dan penyempitan policy (L1b/L3).
 * - Flag MEDIA_UPLOAD_HARDENING_ENABLED default MATI dan JANGAN dihidupkan sebelum itu selesai.
 *
 * Yang dilakukan: memastikan path acak berformat jpg/png, memeriksa magic bytes 12 byte pertama objek lewat
 * signed URL (fetch dengan Range, batas waktu 5 detik), dan menghapus objek bila verifikasi gagal.
 * Gagal-tertutup: galat jaringan, timeout, atau respons tak terduga = ditolak dan objek dihapus.
 */
import { detectImageFormat } from "@/lib/media/strip-image-metadata";
import {
  UPLOAD_ERROR_MESSAGES,
  mimeFromPathExtension,
  validateOutputSize,
  type StoredImageMime,
  type UploadErrorCode,
} from "@/lib/media/media-upload-validation";

export const HEAD_BYTES = 12;
export const VERIFY_TIMEOUT_MS = 5000;
export const SIGNED_URL_TTL_SECONDS = 60;
/** Batas waktu pembuatan signed URL dan penghapusan objek (sama dengan batas fetch). */
export const STORAGE_CALL_TIMEOUT_MS = 5000;

/** Menolak bila `promise` tidak selesai dalam `ms`. Pewaktu selalu dibersihkan. */
export function withTimeout<T>(promise: Promise<T>, ms: number = STORAGE_CALL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type EvaluateResult = { ok: true; mime: StoredImageMime } | { ok: false; code: UploadErrorCode; message: string };

function reject(code: UploadErrorCode, message?: string): { ok: false; code: UploadErrorCode; message: string } {
  return { ok: false, code, message: message ?? UPLOAD_ERROR_MESSAGES[code] };
}

/**
 * Menilai objek tersimpan dari path + 12 byte pertama (+ ukuran total bila diketahui). Murni.
 * WebP ditolak dengan pesan jenis tidak didukung (server hanya menerima jpg/jpeg/png).
 */
export function evaluateStoredMedia(input: {
  storagePath: string;
  head: Uint8Array | null;
  totalBytes?: number | null;
}): EvaluateResult {
  const pathMime = mimeFromPathExtension(input.storagePath);
  if (!pathMime) return reject("UNSUPPORTED_FORMAT");
  if (!input.head || input.head.length < 3) return reject("VERIFY_FAILED");

  const detected = detectImageFormat(input.head);
  if (detected === "webp") return reject("UNSUPPORTED_FORMAT");
  const expected = pathMime === "image/png" ? "png" : "jpeg";
  if (detected !== expected) return reject("SIGNATURE_MISMATCH");

  if (input.totalBytes != null) {
    const size = validateOutputSize(input.totalBytes);
    if (!size.ok) return reject(size.code);
  }
  return { ok: true, mime: pathMime };
}

/** Total ukuran dari header `Content-Range: bytes 0-11/12345`. Null bila tidak ada/tak terbaca. */
export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const m = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(header.trim());
  return m ? Number(m[1]) : null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Mengambil 12 byte pertama objek lewat signed URL (Range, timeout 5 detik). Null bila gagal/timeout
 * (pemanggil memperlakukan null sebagai gagal-tertutup).
 */
export async function fetchObjectHead(
  signedUrl: string,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<{ head: Uint8Array; totalBytes: number | null } | null> {
  try {
    const res = await fetchImpl(signedUrl, {
      method: "GET",
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status !== 206 && res.status !== 200) return null;

    let totalBytes = parseContentRangeTotal(res.headers.get("content-range"));
    if (totalBytes == null && res.status === 200) {
      const len = Number(res.headers.get("content-length"));
      totalBytes = Number.isFinite(len) && len > 0 ? len : null;
    }

    // Server yang mengabaikan Range mengirim berkas utuh: baca hanya potongan pertama lalu batalkan aliran.
    const reader = res.body?.getReader();
    let head: Uint8Array;
    if (reader) {
      const chunks: Uint8Array[] = [];
      let got = 0;
      while (got < HEAD_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        got += value.length;
      }
      void reader.cancel().catch(() => undefined);
      head = new Uint8Array(Math.min(got, HEAD_BYTES));
      let off = 0;
      for (const c of chunks) {
        const take = Math.min(c.length, head.length - off);
        head.set(c.subarray(0, take), off);
        off += take;
        if (off >= head.length) break;
      }
    } else {
      head = new Uint8Array(await res.arrayBuffer()).slice(0, HEAD_BYTES);
    }
    return { head, totalBytes };
  } catch {
    return null;
  }
}

/** Bagian minimal klien Supabase Storage yang dipakai (memudahkan tes). */
export interface StorageBucketLike {
  createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}

/**
 * Verifikasi objek yang sudah diunggah. Bila GAGAL APA PUN (signed URL, timeout, tanda tangan, ukuran),
 * objek dihapus (upaya terbaik) dan hasil gagal dikembalikan: gagal-tertutup.
 */
export async function verifyUploadedObject(
  bucket: StorageBucketLike,
  storagePath: string,
  fetchImpl?: FetchLike,
): Promise<EvaluateResult> {
  let outcome: EvaluateResult;
  try {
    const { data, error } = await withTimeout(
      bucket.createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS),
    );
    if (error || !data?.signedUrl) {
      outcome = reject("VERIFY_FAILED");
    } else {
      const fetched = await fetchObjectHead(data.signedUrl, fetchImpl);
      outcome = fetched
        ? evaluateStoredMedia({ storagePath, head: fetched.head, totalBytes: fetched.totalBytes })
        : reject("VERIFY_FAILED");
    }
  } catch {
    outcome = reject("VERIFY_FAILED");
  }

  if (!outcome.ok) {
    try {
      await withTimeout(bucket.remove([storagePath]));
    } catch {
      // Upaya terbaik: objek yatim tetap tidak punya baris media (tidak tampil/terpakai).
    }
  }
  return outcome;
}
