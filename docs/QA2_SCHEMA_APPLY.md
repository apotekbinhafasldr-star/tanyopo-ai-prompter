# QA-2: terapkan skema ke proyek QA dari HP (tanpa menempel SQL)

**Status: SIAP, BELUM DIJALANKAN.** Workflow `QA-2 schema apply` menerapkan bundel skema QA (3 bagian berurutan, tiap bagian satu transaksi) ke proyek Supabase QA `gasdqsadnjoknisloaec` SAJA. Ini **bukan** aktivasi QA-2 (`QA2_ENABLED`/`QA2_ACTIVATED` tidak dibaca dan tidak diubah). Tidak menyentuh umkmpro-ai, produksi, PUBLOE, MITAPENG, UMKMpro.

## Langkah Founder (semua bisa dari HP Android)
| # | Di mana | Apa |
|---|---|---|
| a | Supabase, proyek QA `gasdqsadnjoknisloaec` | **Connect** > **Session pooler** > salin connection string. Ganti `[YOUR-PASSWORD]` dengan password database. Bila lupa: Project Settings > Database > **Reset database password** (aksi Founder). Password dengan karakter khusus (`@ / : ? #`) harus di-URL-encode. |
| b | GitHub repo > Settings > Environments > `qa-real-email` | **Add secret** `QA_DB_URL`, tempel dari HP. Jangan kirim lewat chat. |
| c | Actions > **QA-2 schema apply** > Run workflow (branch **main**) | `mode=check` (hanya baca). Setujui Environment (Founder = reviewer). |
| d | Run workflow lagi | `mode=apply`, kolom confirm: `APPROVE QA-2-SCHEMA-BUNDLE` (persis). Setujui Environment. |
| e | Run workflow lagi | `mode=rls-test`. Setujui Environment. |

Mengapa **Session pooler**: runner GitHub hanya IPv4, sedangkan host `db.<ref>.supabase.co` paket Free hanya IPv6. Pooler mode session (port 5432) berjalan di IPv4. Bentuk direct tetap diterima guard.

## Apa yang dilakukan tiap mode
| Mode | Isi | Hasil dan artinya |
|---|---|---|
| `check` | Hanya SELECT: nama database, jumlah tabel `public`, penanda sandbox, jumlah `auth.users`. Tidak menulis apa pun. | `EMPTY` = siap apply. `INSTALLED_VERIFIED` = sudah terpasang dan lolos verifikasi. `PARTIAL` = sebagian terpasang (apply melanjutkan). `UNKNOWN` = tidak dikenal: **berhenti**, kirim log. |
| `apply` | Butuh frasa persis. Jalankan `check`; hanya bila kosong (atau sebagian dari bundel ini). Bagian 1, 2, 3 berurutan, berhenti di galat pertama. Lalu verifikasi akhir. | `APPLY PASS` = 15 migrasi, trigger trial, free plan, trigger signup, 3 policy shim, grant, trigger reset semua benar. `ALREADY_APPLIED` = sudah terpasang, tidak menulis. Galat = tidak ada yang tersimpan dari bagian itu. |
| `rls-test` | `qa/qa2-rls-cross-tenant.sql`: tenant A tidak boleh membaca/menulis data tenant B. Sengaja berakhir galat `QA2_RLS_RESULT`; transaksi dibatalkan, data uji tidak tersimpan. | PASS hanya bila pesan memuat `ALL_PASS | fails=0`. Galat lain = gagal. UNKNOWN: insert minimal ke `auth.users` di Supabase hosted belum terbukti; kegagalan di sini **tidak membatalkan** apply. |

| `diagnose` | BACA-SAJA. Satu baris per sub-syarat ACL (`OK`/`SALAH`; `t`/`f`/`MISSING`), ACL tiap relasi `prompter_*`, default privileges, role. Tanpa data baris, tanpa rahasia. | Daftar sub-syarat yang salah. Selalu exit 0 bila kueri berhasil (informasi, bukan lulus/gagal). |
| `grants` | Butuh frasa persis `APPROVE QA-2-SCHEMA-GRANTS`. Bagian ke-4: `qa/qa2-grants.sql` (grant minimal, satu transaksi, idempotent). Hanya bila 15 migrasi terpasang dan HANYA `service_role_access`/`app_table_grants` yang salah. Tidak mengulang migrasi. | `GRANTS PASS` = verifikasi ulang lolos. `GRANTS tidak diperlukan` = sudah lolos, tidak menulis. Ditolak (exit 2) bila ada indikator lain yang salah. |

Kode keluar: 0 sukses, 1 gagal verifikasi/eksekusi, 2 ditolak guard.

## Verifikasi run #4 gagal (service_role_access=f, app_table_grants=f)
| Temuan | Bukti |
|---|---|
| Penyebab | Proyek Supabase QA baru tidak punya default privileges; tabel hasil migrasi tidak mendapat grant otomatis untuk `authenticated`/`service_role`. Migrasi `prompter_*` tidak memberi grant tabel (hanya `revoke` dan grant fungsi). Skrip verifikasi benar: ia menuntut grant yang dibutuhkan aplikasi. |
| Mengapa CI lolos | `qa/ci/supabase-standin.sql` memasang `alter default privileges ... grant all`. Job CI `grants-on-strict-postgres` memakai stand-in tanpa itu dan menghasilkan `15|O|1|1|3|t|f|f|1`, sama dengan log run #4 (SANDBOX). |
| Perbaikan | `qa/qa2-grants.sql`: `authenticated` hanya SELECT/INSERT/UPDATE sesuai policy RLS pada tabel alur signup, onboarding, dashboard, trial; `prompter_subscriptions` hanya SELECT+INSERT (tanpa UPDATE/DELETE, kunci migrasi P0). `service_role`: SELECT+DELETE `prompter_subscriptions` dan DELETE `tenants` (reset identitas QA, `scripts/qa/qa-admin-client.mjs`). Tanpa GRANT ALL, tanpa anon, tanpa perubahan RLS. |
| UNKNOWN | Grant produksi asli. Tabel/aksi di luar alur QA-2 (mis. UPDATE `tenants` oleh owner saat onboarding) belum terbukti dibutuhkan; diagnose menunjukkan bila ada yang kurang. |

Urutan: `diagnose` (baca-saja) > `grants` (frasa `APPROVE QA-2-SCHEMA-GRANTS`, Environment disetujui) > `check` (harus `INSTALLED_VERIFIED`) > `rls-test`. `rls-test` jangan dijalankan sebelum grants.

## Pengaman berlapis
| Lapis | Isi |
|---|---|
| Pemicu | Hanya `workflow_dispatch`, hanya dari `main`, Environment `qa-real-email` (reviewer Founder), timeout 15 menit, concurrency 1. |
| Frasa | `apply` ditolak tanpa `APPROVE QA-2-SCHEMA-BUNDLE`, `grants` ditolak tanpa `APPROVE QA-2-SCHEMA-GRANTS` (di langkah tanpa secret dan di skrip). Frasa tidak berpindah antar mode. Berkas grants juga diperiksa skrip terhadap pola terlarang (GRANT ALL, default privileges, anon, RLS, UPDATE/DELETE langganan). |
| Secret | Hanya `QA_DB_URL`, hanya di satu langkah. Tidak ada `DATABASE_URL`/`SUPABASE_*`. |
| URL | Hanya dua bentuk: `postgres@db.<ref>.supabase.co` atau `postgres.<ref>@*.pooler.supabase.com`; ref dari `qa-project-allowlist.mjs`; ref nyata/umkmpro-ai ditolak di bagian mana pun; database harus `postgres`; query hanya `sslmode=require`. |
| Env | Ditolak bila ada `PG*`, `DATABASE_URL`, `SUPABASE_*` dsb. Env `psql` dibangun dari nol; password hanya lewat `PGPASSWORD`; URL/password disamarkan di semua keluaran. |
| Isi | Tidak ada drop/reset/truncate. Proyek tidak kosong dan tidak dikenal = ditolak. |

## Batas bukti
| Bukti | Kelas |
|---|---|
| Uji bundel di CI (`qa2-schema-bundle-test`, Postgres sementara + stand-in Supabase `qa/ci/supabase-standin.sql`) | SANDBOX, bukan REAL |
| Hasil `apply` dan `rls-test` di proyek QA | REAL untuk proyek QA; shim `tenants`/`user_profiles` tetap **bukan** salinan produksi (lihat `docs/QA2_SCHEMA_MINIMUM.md`) |
| Kesetaraan dengan produksi UMKMpro | UNKNOWN |

Rollback: hapus dan buat ulang proyek QA (aksi Founder). Workflow ini tidak punya fungsi itu.
