// QA-2: daftar proyek Supabase QA yang DIIZINKAN. Terkunci di kode (ditinjau lewat PR), TIDAK bergantung pada URL yang
// disuplai runner atau secret apa pun. Guard menolak ref apa pun yang tidak ada di sini.
//
// KOSONG SEKARANG: belum ada proyek QA, dan ref tidak boleh dikarang. Selama kosong, guard QA-2 selalu menolak (fail-closed).
// Menambah ref = PR kecil terpisah setelah `APPROVE QA-2-SUPABASE-PROJECT` dan proyeknya benar-benar dibuat. Ref wajib
// 20 karakter huruf kecil/angka dan tidak boleh proyek produksi/bersama (daftar blokir di local-stack-guard.mjs).
/** @type {readonly string[]} */
export const ALLOWED_QA_PROJECT_REFS = Object.freeze([]);
