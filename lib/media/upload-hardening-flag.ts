/**
 * Saklar pengerasan unggah foto produk (Paket 2, L2).
 *
 * AKTIF hanya bila MEDIA_UPLOAD_HARDENING_ENABLED persis "true" (dibaca di server, bukan NEXT_PUBLIC).
 * Nilai lain (kosong, "1", "TRUE", salah ketik) = MATI, dan perilaku unggah identik dengan sebelum L2.
 *
 * PENTING: L2 BUKAN batas keamanan (lihat docs/MEDIA_UPLOAD_HARDENING.md). Jangan diaktifkan sebelum
 * L1 (batas bucket) dan penyempitan policy storage (L1b/L3) selesai dan disetujui Founder.
 */
export function isMediaUploadHardeningEnabled(): boolean {
  return process.env.MEDIA_UPLOAD_HARDENING_ENABLED === "true";
}
