# Runbook: AI Jobs quota guard (2 migrasi) - Production

**Status: BELUM dijalankan.** Dokumen ini tidak menjalankan apa pun. Project: `umkmpro-ai` (`wjjyqovhmwenbcvbnkgx`), **BERSAMA PUBLOE/UMKMpro**.
Eksekusi butuh **persetujuan Founder tertulis untuk SETIAP file** (frasa persetujuan per file, mis. `APPROVE QUOTA-GUARD-1` dan terpisah `APPROVE QUOTA-GUARD-2`).
Semua langkah bisa dilakukan dari HP; Claude yang menjalankan, Founder hanya menyetujui.

| Urutan | Versi | File |
|---|---|---|
| 1 | `20261021120000` | `prompter_ai_jobs_quota_guard` (RPC + trigger UPDATE/TRUNCATE) |
| 2 | `20261021120100` | `prompter_ai_jobs_delete_guard` (trigger DELETE) |

Larangan: jangan `supabase db push`, jangan `apply_migration` (versi diganti saat eksekusi), jangan jalankan "semua pending", jangan ubah manifest agar lolos.

## 0. Prasyarat (harus benar)
- PR ini sudah di-merge dan CI hijau (checksum di `supabase/tools/quota-guard-wrapper/manifest.json` terkunci).
- S1 (`20261019100000/100/200`) tercatat di ledger **dan** efektif (diperiksa preflight).
- Tidak perlu deploy app (pemetaan pesan dan pelepasan job via service_role sudah ada di `main`).
- Pilih waktu sepi (preflight menampilkan jumlah job AI satu jam terakhir). Migrasi memegang kunci singkat (`lock_timeout 3s`; gagal = batal total).

## 1. Preflight (SELECT saja, per file)
Jalankan `supabase/tools/quota-guard-wrapper/preflight_readonly.sql` (satu query). Baca baris terakhir `VERDICT`:
- Sebelum file 1: harus `READY_FOR_PART1`. Sebelum file 2: harus `READY_FOR_PART2`.
- Baris yang diperiksa: S1 tercatat (3), tanpa hak tulis klien, md5 RPC `17bd1c2bee1069ca6460774e9021fa9d` (sebelum) / `2042201955b6acbae5b10999413b0e49` (setelah bagian 1),
  jumlah trigger/fungsi guard, baris `FREE` ada dan tidak ada alokasi NULL, tidak ada kunci berat pada `prompter_ai_jobs`.
- Catat juga (info): jumlah user per peran yang akan ditolak (`apoteker`, `kasir`, ...). Putuskan apakah itu bisa diterima (lihat bagian Keputusan).

## 2. Eksekusi (satu file per persetujuan)
```
node supabase/tools/quota-guard-wrapper/generate.mjs verify
node supabase/tools/quota-guard-wrapper/generate.mjs generate 20261021120000 --out <file-baru-di-luar-repo>
```
1. Tinjau wrapper: header `source sha256` = manifest; teks antara `QG-WRAPPER: MIGRATION BEGIN/END` identik dengan file repo; hanya satu `INSERT` ledger; tanpa `BEGIN/COMMIT`.
2. Kirim **seluruh teks sebagai satu query** (execute_sql / SQL Editor). Jangan dipecah, jangan tambah transaksi.
3. Satu transaksi: precheck (ledger, S1, md5, trigger) -> migrasi -> pemeriksaan hak (tidak ada hak bertambah/hilang di tabel, kolom, RPC; jumlah baris tetap)
   -> bentuk akhir (md5 RPC, trigger, ACL fungsi guard) -> INSERT ledger (versi eksplisit) -> verifikasi ledger (sha256 isi).
4. Ulangi langkah 1-3 untuk `20261021120100` **hanya setelah** postflight file 1 hijau dan ada persetujuan baru.

## 3. Postflight (SELECT saja, setelah tiap file)
`supabase/tools/quota-guard-wrapper/postflight_readonly.sql` -> `POST_OK_PART1` (setelah file 1) atau `POST_OK_ALL` (setelah file 2).
Cek tambahan manual: versi ledger lain tidak berubah; migrasi produk lain tetap pending.
Uji fungsional (oleh Founder dari akun uji, bukan data pelanggan): owner/marketing masih bisa membuat konten AI; akun peran lain mendapat
pesan "Fitur AI LINOE hanya dapat digunakan oleh Owner atau Marketing."

## 4. STOP conditions (hentikan, jangan menembus)
- Pesan `STOP[...]`: `already-recorded`, `name-recorded`, `s1-missing`, `s1-state`, `prerequisite-missing`, `later-recorded`, `objects-missing`, `rpc-drift`,
  `state-drift`, `not-single-transaction`, `new-privilege`, `lost-privilege`, `rows-changed`, `rpc-mismatch`, `rpc-changed`, `trigger`, `guard-fn`, `ledger-verify`, `ledger-missing`.
- `rpc-drift` = RPC live bukan tubuh B10 yang diharapkan (ada perubahan baru): **rencanakan ulang**, jangan paksa.
- `lock timeout` (55P03): aman (batal total); ulangi hanya dengan izin dan di jam sepi.
- Verdict preflight/postflight bukan `READY_*` / `POST_OK_*`, error apa pun, atau `generate` mengeluarkan `REFUSED` (checksum/versi).
- Jangan edit manifest/file untuk menyiasatinya.

## 5. Rollback (hanya dengan persetujuan terpisah)
Urutan terbalik: `supabase/rollback/20261021120100_*.down.sql` lalu `20261021120000_*.down.sql` (tidak ada GRANT; RPC kembali ke tubuh B10 persis, md5 `17bd...`).
Baris ledger tidak terhapus otomatis; hapus/koreksi hanya lewat persetujuan terpisah. Jangan pernah mengembalikan GRANT S1.

## 6. Keputusan/persetujuan Founder yang diperlukan
1. Setujui perubahan perilaku: peran selain owner/marketing ditolak RPC; alokasi/baris entitlement hilang = ditolak (bukan tanpa batas). Lihat jumlah user terdampak dari preflight.
2. Persetujuan tertulis terpisah untuk file 1 dan file 2 (dan untuk rollback bila perlu).
3. Waktu eksekusi (jam sepi).
4. Konfirmasi bahwa PR #48 (lama) ditutup setelah PR ini di-merge; job CI `ai-jobs-guard-pg17` kini menguji tree ini, bukan #48.

## 7. Catatan
- Teks komentar di migrasi (menyebut "PR #31") dan pesan error bagian 2 ("apply PR #31 ...") adalah peninggalan #48; maknanya kini "S1 harus efektif". SQL sengaja tidak diubah agar identik dengan #48 yang sudah ditinjau.
- Versi `20261021...` < maksimum ledger `20261103170000`: wajar; wrapper mencatat versi eksplisit (preseden S1).
