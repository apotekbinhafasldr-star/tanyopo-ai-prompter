/**
 * Saklar server Paket 3. Keduanya AKTIF hanya bila nilainya persis "true" (dibaca di server, bukan NEXT_PUBLIC).
 * Nilai lain (kosong, "1", "TRUE", salah ketik) = MATI. Default MATI: perilaku produksi identik dengan sebelum Paket 3.
 *
 *  - CONSENT_ENFORCEMENT_ENABLED: pemeriksaan server menolak pemrosesan opsional tanpa persetujuan aktif (fail-closed). Fungsi inti tidak pernah diblokir.
 *  - CONSENT_UI_ENABLED: menampilkan panel "Kelola persetujuan opsional" di halaman pengaturan dan dialog persetujuan di halaman Koneksi.
 *  - Kombinasi UI MATI + ENF HIDUP dilarang: enforcement efektif hanya bila UI juga HIDUP (lihat isConsentEnforcementEnabled).
 * Mengaktifkan salah satunya butuh persetujuan Founder terpisah dan perubahan env di Netlify (lihat docs/CONSENT_AUDIT_GUARD.md).
 */
let warnedEnforcementWithoutUi = false;

/**
 * Enforcement EFEKTIF hanya bila UI juga "true" (keputusan Founder: UI OFF + ENF ON dilarang). ENF "true" tanpa UI diperlakukan MATI,
 * agar Owner tidak terkunci tanpa jalur untuk memberi persetujuan, dan dicatat sekali per instance (tanpa data pribadi).
 */
export function isConsentEnforcementEnabled(): boolean {
  const enforcementFlag = process.env.CONSENT_ENFORCEMENT_ENABLED === "true";
  if (!enforcementFlag) return false;
  if (!isConsentUiEnabled()) {
    if (!warnedEnforcementWithoutUi) {
      warnedEnforcementWithoutUi = true;
      console.error("[consent] CONSENT_ENFORCEMENT_ENABLED aktif tanpa CONSENT_UI_ENABLED: enforcement diperlakukan MATI.");
    }
    return false;
  }
  return true;
}

export function isConsentUiEnabled(): boolean {
  return process.env.CONSENT_UI_ENABLED === "true";
}

/** Hanya untuk tes: mengatur ulang penanda log sekali per instance. */
export function resetConsentFlagWarningForTests(): void {
  warnedEnforcementWithoutUi = false;
}
