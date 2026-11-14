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

Kode keluar: 0 sukses, 1 gagal verifikasi/eksekusi, 2 ditolak guard.

## Pengaman berlapis
| Lapis | Isi |
|---|---|
| Pemicu | Hanya `workflow_dispatch`, hanya dari `main`, Environment `qa-real-email` (reviewer Founder), timeout 15 menit, concurrency 1. |
| Frasa | `apply` ditolak tanpa frasa persis (di langkah tanpa secret dan di skrip). |
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
