/**
 * Versi dokumen hukum yang dicatat server saat pendaftaran (Paket 3). Bilangan bulat; BUKAN tanggal. PRIVACY_NOTICE_VERSION tampil di blok pemberitahuan form daftar ("Versi pemberitahuan: N"); TERMS_VERSION tidak tampil.
 *
 * Naikkan nilai ini dalam PR yang SAMA dengan perubahan substansial teks /terms atau /privacy.
 * TERMS = penerimaan perjanjian layanan. PRIVACY_NOTICE = pemberitahuan privasi telah DISAMPAIKAN.
 * Keduanya BUKAN persetujuan pemrosesan data pribadi (PDP); persetujuan opsional ada di lib/consent/catalog.ts.
 */
// 2: bagian 1 /terms tidak lagi menyamakan Kebijakan Privasi dengan penerimaan Syarat (PR label B).
export const TERMS_VERSION = 2;
export const PRIVACY_NOTICE_VERSION = 1;
