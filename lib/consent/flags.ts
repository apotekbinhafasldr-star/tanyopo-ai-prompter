/**
 * Saklar server Paket 3. Keduanya AKTIF hanya bila nilainya persis "true" (dibaca di server, bukan NEXT_PUBLIC).
 * Nilai lain (kosong, "1", "TRUE", salah ketik) = MATI. Default MATI: perilaku produksi identik dengan sebelum Paket 3.
 *
 *  - CONSENT_ENFORCEMENT_ENABLED: pemeriksaan server menolak pemrosesan opsional tanpa persetujuan aktif (fail-closed). Fungsi inti tidak pernah diblokir.
 *  - CONSENT_UI_ENABLED: menampilkan panel "Kelola persetujuan opsional" di halaman pengaturan.
 * Mengaktifkan salah satunya butuh persetujuan Founder terpisah dan perubahan env di Netlify (lihat docs/CONSENT_AUDIT_GUARD.md).
 */
export function isConsentEnforcementEnabled(): boolean {
  return process.env.CONSENT_ENFORCEMENT_ENABLED === "true";
}

export function isConsentUiEnabled(): boolean {
  return process.env.CONSENT_UI_ENABLED === "true";
}
