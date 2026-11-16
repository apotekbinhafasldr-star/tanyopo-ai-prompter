// QA-2: daftar proyek Supabase QA yang DIIZINKAN. Terkunci di kode (ditinjau lewat PR), TIDAK bergantung pada URL yang
// disuplai runner atau secret apa pun. Guard menolak ref apa pun yang tidak ada di sini.
//
// Isi saat ini: SATU proyek QA terpisah, `linoe-qa-real-email` (organisasi Supabase "TANYOPO LINOE QA", paket Free,
// dibuat Founder; ref diberikan Founder pada 2026-11-13). Ref bukan rahasia. Ini BUKAN umkmpro-ai dan bukan proyek lama
// mana pun (daftar blokir di local-stack-guard.mjs tetap menolak ref produksi/bersama walau dimasukkan ke sini).
// Menambah atau mengganti ref = PR kecil terpisah yang ditinjau. Ref wajib 20 karakter huruf kecil/angka.
//
// Memasukkan ref di sini TIDAK mengaktifkan QA-2: workflow tetap manual-only, butuh QA2_ENABLED, Environment, dan secret.
/** @type {readonly string[]} */
export const ALLOWED_QA_PROJECT_REFS = Object.freeze(["gasdqsadnjoknisloaec"]);
