# S1 migration wrapper — runbook singkat

Alat bantu untuk menerapkan **tepat tiga** migrasi S1 ke database bersama (LINOE, PUBLOE, UMKMpro, Apotek) dengan
ledger `supabase_migrations.schema_migrations` yang konsisten. Dokumen ini **tidak** menjalankan apa pun; menjalankan
wrapper di Production butuh persetujuan Founder tertulis untuk **setiap file**, termasuk baris ledger-nya.

| Versi | File |
|---|---|
| `20261019100000` | `prompter_p0_ai_jobs_lockdown` |
| `20261019100100` | `prompter_p0_subscription_trial_insert_guard` |
| `20261019100200` | `prompter_p0_plan_entitlements_lockdown` |

Generate, tinjau, dan eksekusi dilakukan Claude di sesi cloud; Founder cukup memberi persetujuan dari HP (tanpa laptop/PC).

Larangan tetap: jangan `supabase db push`, jangan `migration up`, jangan `apply_migration` untuk S1 (tidak ada parameter
versi; versi akan diganti waktu eksekusi), dan jangan menjalankan "semua migrasi pending". Tool ini sengaja hanya
menerima tiga versi di atas dan tidak menerima SQL atau path dari pemanggil.

## 1. Cara kerja satu wrapper (satu transaksi)

1. `SET LOCAL lock_timeout = '3s'` — gagal cepat, tidak antre di belakang transaksi lain.
2. Pemeriksaan ledger: versi belum tercatat, nama belum tercatat, semua versi S1 sebelumnya sudah tercatat, tidak ada
   versi S1 yang lebih baru, tabel target ada. Snapshot hak akses dan md5 RPC diambil. Advisory lock mencegah dua
   wrapper berjalan bersamaan.
3. Bukti "satu transaksi": jika klien memecah statement (mis. `psql -f`), wrapper berhenti **sebelum** SQL migrasi.
4. Isi file migrasi apa adanya (byte demi byte; hash-nya dikunci di `manifest.json`).
5. Verifikasi: tidak ada hak baru yang muncul selain GRANT milik migrasi itu sendiri (tidak ada GRANT ke `anon`, tidak ada
   INSERT/DELETE/TRUNCATE yang kembali), RPC `fn_create_ai_job_if_entitled` tidak berubah, dan kondisi akhir
   (hak per kolom / trigger) sesuai.
6. `INSERT` ke ledger dengan **versi eksplisit**, nama file, dan isi file utuh sebagai satu elemen `statements`.
7. Verifikasi ledger: baris cocok (sha256 isi), dan himpunan versi S1 di ledger persis yang diharapkan.

Jika salah satu langkah gagal, **seluruhnya batal** (tidak ada migrasi, tidak ada baris ledger).

## 2. Menghasilkan wrapper

```
node supabase/tools/s1-wrapper/generate.mjs list
node supabase/tools/s1-wrapper/generate.mjs verify
node supabase/tools/s1-wrapper/generate.mjs generate 20261019100000 --out /tmp/s1-100000.sql
```

`generate` tanpa `--out` mencetak ke stdout. `--out` hanya menulis file **baru** di luar `supabase/migrations`.
Generator tidak terhubung ke database dan tidak pernah menulis `manifest.json`.

## 3. Verifikasi checksum

- `generate.mjs verify` membandingkan sha256 dan ukuran tiga file dengan `manifest.json`; beda sedikit pun → `REFUSED`.
- `generate.mjs checksums` mencetak hash saat ini (alat bantu tinjau; tidak menulis apa pun).
- `manifest.json` memuat `lockedAtCommit` (commit yang diuji). CI memastikan file identik dengan isi commit itu.
- Mengubah hash di manifest adalah tindakan sengaja yang harus terlihat di review; jangan pernah dilakukan "agar lolos".

## 4. Meninjau SQL sebelum dipakai

Sebelum meminta persetujuan, periksa wrapper hasil generate:
- Header berisi versi, nama file, dan `source sha256` yang sama dengan manifest.
- Teks di antara `-- S1-WRAPPER: MIGRATION BEGIN` dan `... END` identik dengan file di repo.
- Tidak ada `BEGIN`/`COMMIT`/`ROLLBACK`, tidak ada `GRANT ... TO anon`, hanya **satu** `INSERT INTO supabase_migrations.schema_migrations`.
- Kirim **seluruh teks sebagai satu query**. Jangan dipecah, jangan ditambah `BEGIN/COMMIT`.

## 5. Urutan dan pemeriksaan (read-only) di sekitar tiap file

Urutan wajib: `100000` → `100100` → `100200`. Satu file per eksekusi.

**Sebelum tiap file** (SELECT saja):
- Baris ledger versi ini belum ada; versi sebelumnya sudah ada.
- `select max(version) from supabase_migrations.schema_migrations` — tidak ada migrasi S1 yang lebih baru.
- Tidak ada transaksi lama yang menahan tulis di `prompter_subscriptions` (khusus `100100`).
- Catat md5 `pg_get_functiondef` RPC `fn_create_ai_job_if_entitled(text,jsonb)`.

**Sesudah tiap file** (SELECT saja):
- Satu baris ledger baru: versi eksplisit, `name`, `cardinality(statements)=1`, sha256 isi = nilai manifest.
- Versi lain di ledger tidak berubah; migrasi produk lain tetap pending.
- Hak/trigger: `100000` → `authenticated` hanya UPDATE pada 10 kolom yang diizinkan, tanpa INSERT/DELETE/TRUNCATE;
  `100100` → trigger `trg_prompter_subscriptions_enforce_trial_insert` ada (BEFORE INSERT, SECURITY INVOKER), DELETE/TRUNCATE
  dicabut, `anon` tanpa INSERT; `100200` → tidak ada INSERT/UPDATE/DELETE/TRUNCATE untuk `anon`/`authenticated`.
- md5 RPC sama dengan sebelum.

## 6. STOP conditions (hentikan, jangan coba menembus)

- Pesan `STOP[...]` dari wrapper: `already-recorded`, `name-recorded`, `prerequisite-missing`, `later-recorded`,
  `not-single-transaction`, `new-privilege`, `privilege`, `trigger`, `rpc-changed`, `ledger-verify`, `ledger-missing`, `tables-missing`.
- `lock timeout` (55P03): aman (batal total); ulangi hanya dengan izin, di jam sepi.
- Error lain apa pun, atau hasil pemeriksaan pasca-eksekusi tidak sesuai.
- Generator `REFUSED` (checksum/versi/file tidak sesuai). Jangan edit manifest atau file untuk menyiasatinya.
- Ledger berisi baris tak terduga di luar tiga versi ini.

## 7. Pemulihan tanpa GRANT berbahaya

- Gagal = tidak ada yang berubah (atomik). Perbaiki penyebab, lalu jalankan **wrapper yang sama** lagi.
- Drift (SQL sudah jalan tetapi ledger kosong, mis. karena dijalankan manual): jalankan ulang wrapper; ketiga file idempoten
  dan wrapper akan mencatat ledger.
- Jangan mengembalikan GRANT lama, jangan memakai rollback #31, jangan mengaktifkan lagi INSERT/DELETE/TRUNCATE.
- Jika perlu perubahan: buat migrasi **baru** (versi baru) lewat review dan persetujuan yang sama (forward-fix).

## 8. Pengujian

CI job `s1-wrapper-pg17` (PostgreSQL 17 sintetis): `supabase/tests/s1-wrapper/generator.test.mjs` dan `run-local.sh`
(sukses berurutan, gagal migrasi, gagal ledger, retry, sudah tercatat, urutan salah, checksum salah, file tidak diizinkan,
migrasi lain tetap pending, lock timeout, idempotensi, hak akses dan trigger). Lokal: `bash supabase/tests/s1-wrapper/run-local.sh`.
