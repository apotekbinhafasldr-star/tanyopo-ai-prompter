# 4r: brankas arsip minimal untuk bukti billing (Opsi A)

Status: **DRAFT PR. Migrasi BELUM diterapkan ke database mana pun** (bukan Supabase, bukan produksi, bukan QA). Tidak ada kode aplikasi, tidak ada flag baru, tidak ada paket produksi (itu PR terpisah dan butuh persetujuan Founder). Bukan nasihat hukum.

Berkas: `supabase/migrations/20261128090000_prompter_retention_vault.sql`; rollback di `supabase/rollback/` (`.down-soft.sql`, `.down.sql`); bukti: `supabase/tests/retention-vault/run-local.sh` (job CI `retention-vault-sql`, PostgreSQL 16 dan 17) dan `tests/unit/migrations/retention-vault.test.ts`.

## 1. Masalah

`DELETE FROM tenants` oleh siapa pun (operator, skrip, atau produk lain pada proyek Supabase bersama) meng-cascade-hapus baris `prompter_subscriptions`, `prompter_invoices`, dan `prompter_payment_transactions`. Tiga tabel itu adalah bukti keuangan LINOE dan tidak punya trigger hapus. Di repo tidak ada jalur aplikasi LINOE yang menghapus `tenants`; risikonya datang dari luar LINOE.

## 2. Yang dibuat

| Objek | Fungsi |
|---|---|
| `prompter_retention_vault` | Salinan minimal baris billing yang akan dihapus. **Tanpa foreign key** (tidak ikut terhapus bersama `tenants`/`auth.users`). RLS aktif tanpa policy; semua hak `public/anon/authenticated/service_role` dicabut (tabel dan urutan identity). |
| `fn_prompter_retention_vault_capture()` + trigger `trg_zz_retention_capture` | `BEFORE DELETE` per baris pada tiga tabel billing. SECURITY DEFINER, `search_path = pg_catalog, public, pg_temp`. Menyalin kolom **allowlist** ke brankas dalam transaksi DELETE yang sama. Nama `zz` = urutan abjad terakhir: bila trigger lain membatalkan hapus, salinan tidak dibuat. |
| `trg_retention_no_truncate` | `BEFORE TRUNCATE` pada tiga tabel billing: ditolak (`LR003`). |
| `trg_retention_vault_immutable`, `trg_retention_vault_no_truncate` | Penjaga hanya-tambah pada brankas: UPDATE/DELETE/TRUNCATE ditolak (`LR004`). |
| `fn_prompter_retention_vault_status()` | Baca-saja (jsonb): jumlah trigger aktif, jumlah `ENABLE ALWAYS`, jumlah baris brankas, `ok`. Tanpa EXECUTE untuk klien. |

Trigger penyalin dan penolak TRUNCATE `ENABLE ALWAYS` (tetap menyala di `session_replication_role = replica`).

Satu-satunya perubahan pada objek yang sudah ada: trigger baru pada tiga tabel billing LINOE. Tidak ada perubahan pada kolom, RLS, GRANT, atau badan fungsi billing; `tenants`, `auth.users`, `user_profiles`, dan tabel produk lain tidak diubah (`tenants` hanya dibaca untuk label alasan arsip).

## 3. Allowlist data minimal

Disalin lewat proyeksi eksplisit atas `to_jsonb(old)` (bukan denylist): kolom baru yang ditambahkan kelak **tidak** otomatis tersalin; kolom yang belum ada (mis. `transaction_id` sebelum P0-2) tidak muncul tanpa galat.

| Tabel | Disalin | Tidak disalin |
|---|---|---|
| `prompter_subscriptions` | tenant_id, plan, status, billing_provider, provider_subscription_id, cancel_at_period_end, current_period_start/end, created_at, updated_at | success_fee_rate_bps, billing_country, invoice_currency, payment_provider_customer_reference, tax_metadata |
| `prompter_invoices` | id, tenant_id, transaction_id, provider, external_invoice_id, status, amount, currency, period_start/end, issued_at, paid_at, created_at, updated_at | description (teks bebas) |
| `prompter_payment_transactions` | id, tenant_id, provider, provider_payment_id, provider_event_id, plan, amount, currency, status, created_at, updated_at, paid_at | user_id, failure_reason, metadata |

Metadata brankas: `source_table`, `source_pk`, `tenant_id`, `archive_reason` (`TENANT_CASCADE`, `ROW_DELETE`, atau `UNDETERMINED`), `allowlist_ver`, `deleted_by` (= `session_user`, nama peran), `capture_txid`, `archived_at`, `retain_until`.

`tenant_id` bersama pengenal penyedia dan nominal tetap **pseudonim yang bisa dikaitkan kembali**: perlakukan sebagai data pribadi, bukan "anonim". Pengungkapan di Privacy Notice dan dasar penyimpanan = keputusan konsultan hukum (belum diputuskan).

`archive_reason` hanya metadata. `TENANT_CASCADE` dipakai bila baris `tenants` sudah tidak ada saat trigger menyala; `UNDETERMINED` bila peran penyalin tidak pasti dapat melihat seluruh baris `tenants` (bukan superuser/BYPASSRLS/pemilik tanpa FORCE RLS dan RLS `tenants` aktif) atau tidak boleh membacanya. Label tidak pernah dipakai untuk keputusan keselamatan.

## 4. Fail-closed

Bila penyalinan ke brankas gagal karena sebab apa pun (tabel rusak/diganti nama, hak INSERT dicabut, CHECK/NOT NULL gagal, timeout), seluruh pernyataan `DELETE` (termasuk `DELETE FROM tenants` yang men-cascade) dibatalkan atomik dengan galat `LR001 gagal menyalin arsip retensi (<tabel> / sqlstate <kode>); penghapusan dibatalkan`. Pesan **tidak memuat isi baris** (hindari data pribadi di log).

| Kode | Arti |
|---|---|
| `LR001` | Penyalinan gagal; hapus dibatalkan |
| `LR002` | Tabel tak dikenal oleh fungsi penyalin |
| `LR003` | TRUNCATE pada tiga tabel billing ditolak |
| `LR004` | UPDATE/DELETE/TRUNCATE pada brankas ditolak |

Konsekuensi untuk produk lain pada database bersama: bila brankas rusak atau terkunci, **penghapusan tenant mereka ikut gagal** dengan `LR001`. Itu disengaja (bukti hilang diam-diam dianggap lebih buruk daripada galat yang terlihat). Periksa `select public.fn_prompter_retention_vault_status();` secara berkala dan sebelum penghapusan tenant apa pun: `ok` harus `true` dan `capture_triggers_always` = 3.

**Break-glass** (hanya bila penghapusan tenant mendesak sementara brankas rusak dan tidak dapat diperbaiki cepat): pemilik tabel menjalankan `ALTER TABLE ... DISABLE TRIGGER trg_zz_retention_capture` pada tabel terkait, hanya dengan persetujuan tertulis Founder, mencatatnya, lalu `ENABLE ALWAYS` kembali dan memeriksa `status()`. Penghapusan di jendela itu **tidak tersalin** (diterima tertulis).

## 5. Batas jujur (jangan ditulis sebagai klaim "immutable")

- Brankas ini **bukan immutable**: ia hanya-tambah **oleh trigger database**. Pemilik database dapat `DISABLE/DROP TRIGGER`, `DROP TABLE`, atau mengubah baris; superuser juga. Pengujian membuktikan pemilik *dapat* menonaktifkan trigger dan `status().ok` menjadi `false` (terdeteksi), bukan bahwa hal itu mustahil.
- `session_replication_role = replica`: cascade FK **tidak berjalan sama sekali** (baris billing menjadi yatim, tidak hilang) sehingga tidak ada yang tersalin untuk cascade itu; `DELETE` langsung pada tabel billing tetap tersalin (trigger `ENABLE ALWAYS`). Apakah peran produksi boleh men-set parameter ini = UNKNOWN.
- Cadangan/PITR Supabase menyimpan data lama di luar kendali 4r (UNKNOWN; diungkap).
- **Tidak ada penghapusan otomatis dan tidak ada durasi retensi.** `retain_until` NULL = belum ditetapkan, tanpa default; tidak ada fungsi purge, penjadwal, atau `pg_cron`. Angka tahun tertentu (misalnya 3 atau 10) belum ditetapkan sebagai keputusan hukum: menunggu konsultan hukum dan persetujuan Founder untuk desain purge yang terpisah. Konsekuensinya salinan bertahan tanpa batas waktu sampai keputusan itu, dan itu harus diungkap.
- Tidak ada klaim "semua data Anda telah dihapus": baris billing diarsipkan minimal, bukan dihapus dari sistem.

## 6. Dampak ke produk lain di database bersama (tanpa menyebut nama objek mereka)

| Aspek | Dampak | Bukti |
|---|---|---|
| Perilaku `DELETE FROM tenants` | Tidak berubah: tetap berhasil; hasil seluruh tabel identik dengan dan tanpa 4r | SANDBOX (T10) |
| `tenants` dan tabel mereka | Tidak diubah; nol kunci selain AccessShare pada `tenants` saat apply | SANDBOX (T25) |
| Galat baru | `LR001` pada hapus tenant hanya bila brankas rusak (fail-closed) | SANDBOX (T4) |
| Kunci saat apply | `ShareRowExclusive` pada tiga tabel LINOE sampai commit (`lock_timeout` 3 s): baca tetap jalan, tulis checkout tertahan sebentar | SANDBOX (T24, T25) |
| `TRUNCATE` tiga tabel billing | Kini ditolak (`LR003`), termasuk `TRUNCATE tenants CASCADE` | SANDBOX (T8) |
| Hak | Penyalin berjalan sebagai pemilik tabel; pemanggil tidak butuh hak apa pun atas brankas | SANDBOX (T1, T20) |
| Ruang | Brankas tumbuh per baris billing yang dihapus (kecil) | ESTIMASI |
| Skrip reset QA yang menghapus `tenants` | Tetap berjalan; brankas QA tumbuh (diterima) | SANDBOX (T30) |

## 7. Penghapusan tenant yang aman (ringkas; 4a/4b bukan bagian PR ini)

LINOE sendiri tidak pernah menghapus `tenants`. Urutan operator: (1) `status()` `ok=true` dan `capture_triggers_always=3`; (2) catat hitungan baris tiga tabel billing tenant itu; (3) ekspor/penghapusan data operasional sesuai prosedur permintaan data subjek (PR terpisah); (4) `DELETE` baris `tenants` oleh pemilik produk/operator; (5) cocokkan jumlah baris brankas per `(tenant_id, source_table)` dengan hitungan langkah 2 (selisih = insiden, hentikan, jangan ulangi). Setiap langkah satu pernyataan SQL yang dapat dijalankan dari SQL Editor di ponsel.

## 8. Rollback

| Tingkat | Berkas | Efek |
|---|---|---|
| Soft | `supabase/rollback/20261128090000_prompter_retention_vault.down-soft.sql` | Melepas trigger penyalin dan penolak TRUNCATE serta fungsinya; **brankas dan isinya dipertahankan**; `status().ok=false` sehingga langkah penghapusan data tidak boleh lanjut. Hapus tenant kembali seperti sebelum 4r. |
| Penuh | `...down.sql` | Membuang semua objek 4r. **Menolak** (`DIBATALKAN down 4r`) bila brankas berisi baris; tidak ada yang dibuang. |
| Penuh paksa | `...down.sql` dengan `PGOPTIONS="-c linoe.drop_retention_vault=DROP-VAULT-20261128090000"` | Membuang brankas **beserta bukti yang sudah diarsipkan**: hanya dengan persetujuan tertulis, setelah mengekspor isi brankas. Nilai selain persis itu ditolak. |

Semua idempoten dan diuji dua kali. Terapan gagal di tengah = rollback transaksi otomatis (prasyarat fail-closed: tiga tabel, `tenants`, dan `SELECT` pemilik pada `tenants`; `lock_timeout` 3 s; tanpa objek sebagian).

## 9. Kelas bukti dan cakupan tes

Semua bukti kelas **SANDBOX**: PostgreSQL sementara (16 lokal; 16 dan 17 di CI), data sintetis, skema Supabase berupa stub (`auth`, `tenants`, peran). Tabel billing berasal dari rantai migrasi **asli** repo (B10, #74, B1, carryover, B2, invoices, P0-2), dimiliki peran non-superuser tempat migrasi dijalankan. **Tidak ada bukti REAL** (tidak ada akses ke Supabase mana pun).

Pemetaan ke 42 tes yang direncanakan:

| Kelompok | Tes | Tempat |
|---|---|---|
| A fungsi inti | 1-10 | `run-local.sh` (T1-T10, S2, S3) |
| B isolasi tenant | 11-14 | `run-local.sh` (T11-T14) |
| C RLS | 15-17 | `run-local.sh` (T15-T17, snapshot sebelum/sesudah) |
| D privilege | 18-21 | `run-local.sh` (T18-T21) |
| E migrasi/rollback | 22-26 | `run-local.sh` (T22-T26) |
| F konkurensi | 27-28 | `run-local.sh` (T27-T28) |
| G regresi | 29-30 | `run-local.sh` (T29: skenario P0-2 dan B2 tanpa diubah dengan 4r terpasang; T30: SQL reset QA dari skrip repo) |
| H statis | 31-33, 35-36 | `retention-vault.test.ts`; allowlist migrasi di tiga tes guard diperbarui; entri manifest QA2 |

**Belum dicakup (jujur):**
- Tes 29 hanya menjalankan ulang skenario P0-2 dan B2 (yang memuat lintasan checkout, webhook, invoice). Suite `b1-checkout`, `plan-tampering`, `s1-trial-quota`, dan `payment-lifecycle` tidak dijalankan ulang dengan 4r terpasang.
- Tes 34 (daftar putih `ddl_targets` runner paket produksi): tidak berlaku, tidak ada paket produksi di PR ini.
- Tes 37-42 (probe REAL read-only pada Supabase produksi): sengaja tidak dijalankan; butuh persetujuan terpisah.
- Pada sandbox peran pemilik diberi BYPASSRLS (meniru peran `postgres` Supabase); peran migrasi produksi LINOE belum diketahui. Skenario tanpa BYPASSRLS diuji terpisah (label `UNDETERMINED`).

## 10. UNKNOWN (tidak boleh dianggap sudah diketahui)

- Hak `CREATE TRIGGER`/kepemilikan tiga tabel billing oleh peran migrasi produksi (probe REAL tes 37; bila ditolak, terapan berhenti bersih tanpa efek).
- Apakah peran migrasi produksi memiliki `SELECT` pada `tenants` dan `BYPASSRLS` (menentukan label alasan, bukan penyalinan).
- Versi dan konfigurasi PostgreSQL produksi; apakah `session_replication_role` dapat di-set oleh peran produksi.
- Trigger lain, FK dari tabel non-LINOE ke tiga tabel billing, dan perilaku penghapusan tenant oleh produk lain di produksi.
- Cakupan cadangan/PITR.
- Hukum (KONS, bukan keputusan di repo ini): apakah salinan minimal memenuhi kewajiban penyimpanan dokumen keuangan, bagaimana interaksinya dengan hak penghapusan data pribadi, kapan masa simpan dihitung, durasi, dan teks pengungkapan di Privacy Notice.

## 11. Bahasa klaim

Dilarang di docs/UI (daftar di bawah hanya contoh larangan):

```
immutable | tidak bisa dihapus/diubah | tahan manipulasi | WORM | semua data Anda telah dihapus
```

Diizinkan: "baris diarsipkan minimal ke tabel hanya-tambah oleh trigger database; pemilik database dapat mengubahnya; catatan transaksi tertentu disimpan sesuai kewajiban pembukuan; salinan cadangan mengikuti siklus penyedia". Teks publik final menunggu konsultan hukum; halaman `/data-deletion` tidak diubah oleh 4r.

## 12. Urutan setelah PR ini

Tidak ada yang diterapkan dari PR ini. Paket produksi 4r adalah PR terpisah (runner, preflight read-only, apply, verify, rollback-siap) dan butuh frasa persetujuan Founder tersendiri. 4r wajib terpasang dan `status().ok=true` sebelum go-live pembayaran.
