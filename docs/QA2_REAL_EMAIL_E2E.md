# QA-2: E2E email nyata (jalur B)

**Status: NOT ACTIVATED.** Hanya desain. Belum ada proyek, domain, DNS, secret, atau akun. PR ini tidak mengirim email apa pun.

## Tujuan
Membuktikan alur signup LINOE dengan email NYATA: Supabase Auth nyata, SMTP Resend nyata, satu kotak masuk tetap. Bisa diulang tanpa membuat email baru tiap tes.

## Kelas bukti
| Hal | QA-1 (MOCK/INTEGRATION) | QA-2 (REAL) | Produksi |
|---|---|---|---|
| Supabase Auth | Lokal di runner | Proyek QA terpisah | Proyek produksi |
| Pengiriman email | Mailpit (tangkap lokal) | Resend nyata | Resend nyata |
| Domain pengirim | Tidak ada | Sub-domain QA | tanyopo.com |
| Kotak masuk | Mailpit | Satu inbox tetap nyata | Pengguna asli |
| SPF/DKIM | Tidak diuji | Diverifikasi dari header | Tidak diuji di sini |
| Dijalankan | Otomatis di PR | Manual saja | Tidak pernah oleh QA |

## Arsitektur
- Proyek Supabase QA **terpisah**, bukan umkmpro-ai dan bukan proyek lain.
- Pengirim Resend di **sub-domain** (contoh `qa.tanyopo.com`), bukan `tanyopo.com`.
- Satu inbox tetap (penyedia BELUM diputuskan; lihat `scripts/qa/inbox-adapter.mjs`).
- Reset hanya di proyek QA lewat Admin API.
- Concurrency 1 (`qa-real-e2e`), tanpa pembatalan paksa.
- Hanya `workflow_dispatch` + variabel `QA2_ENABLED` + frasa konfirmasi.

## Mengapa plus-addressing ditolak
Alamat `nama+x@...` bisa memicu pembuatan identitas baru tiap run dan mengelabui anti-abuse trial. QA harus memakai satu identitas tetap.

## Mengapa signup di produksi ditolak
Mencemari data pengguna, menghabiskan kuota/reputasi pengirim produksi, dan memicu anti-abuse. Guard menolak semua variabel produksi.

## Kebutuhan (nama saja) dan pemegang
| Nama | Pemegang |
|---|---|
| QA_SUPABASE_URL (juga dipakai sebagai NEXT_PUBLIC_SUPABASE_URL di workflow), QA_PROJECT_REF_EXPECTED | Founder (GitHub Environment) |
| QA_SUPABASE_PUBLISHABLE_KEY, QA_SUPABASE_SECRET_KEY | Founder (GitHub Environment) |
| QA_RESEND_SMTP_PASSWORD, QA_SENDER_EMAIL | Founder (GitHub Environment) |
| QA_INBOX_ADDRESS, QA_INBOX_READ_TOKEN | Founder (GitHub Environment) |
| QA2_ENABLED (variabel, bukan secret) | Founder |

Semua hanya di Environment `qa-real-email`. Bukan secret repo, bukan secret produksi. Nilai tidak pernah masuk repo atau chat.

## Estimasi biaya
ESTIMASI: Rp0 bila cukup tier gratis (Supabase, Resend, inbox). Sekitar USD 25/bulan bila perlu Supabase berbayar. DNS: biaya sekali untuk sub-domain (umumnya Rp0 bila domain sudah ada).

## Langkah aktivasi bertahap
Tiap langkah menunggu frasa persetujuan.
0. Founder menyiapkan Environment `qa-real-email` yang terkunci (H1) sebelum tahap mana pun yang memasang secret.
1. `APPROVE QA-2-SUPABASE-PROJECT`: buat proyek Supabase QA terpisah, lalu tambahkan ref-nya ke allowlist lewat PR terpisah (H5).
2. `APPROVE QA-2-RESEND-DOMAIN`: sub-domain pengirim + DNS SPF/DKIM.
3. `APPROVE QA-2-INBOX`: pilih penyedia inbox tetap, lalu implementasi adapter.
4. `APPROVE QA-2-SECRETS`: isi secret di Environment `qa-real-email`.
5. `APPROVE QA-2-ENABLE`: set `QA2_ENABLED=true` dan `QA2_ACTIVATED`.

## Risiko dan guard
- Salah target ke produksi: `assertRealQaEnv` menolak ref di daftar blokir, ref tidak cocok, dan variabel produksi (SERVICE_ROLE, DATABASE_URL, DOKU_*, MIDTRANS_*, dll.).
- Pengirim produksi: `tanyopo.com` persis ditolak.
- Kebocoran secret: pesan error hanya memuat nama variabel; ada `redact`.
- Tanpa aktivasi: skrip keluar kode 3, adapter melempar `NOT_IMPLEMENTED`.
- Berjalan tidak sengaja: manual saja, butuh variabel + frasa konfirmasi.

## Checklist Founder dari HP
- [ ] Buka GitHub app/web, pilih repo, Settings, Environments.
- [ ] Buat Environment `qa-real-email` (tahap 4).
- [ ] Isi secret lewat form web, bukan chat.
- [ ] Set variabel `QA2_ENABLED` hanya di tahap 5.
- [ ] Jalankan: Actions, QA-2 real email E2E, Run workflow, ketik `RUN-QA-2-REAL-EMAIL`.

Semua bisa dikerjakan dari HP Android.

## Hardening (status per butir)
| # | Butir | Status |
|---|---|---|
| H1 | Environment `qa-real-email` dibatasi ke `main` + reviewer | **WAJIB manual oleh Founder sebelum secret apa pun** (lihat langkah di bawah). Tidak bisa diterapkan dari kode. |
| H2 | Secret hanya di langkah yang membutuhkan | Selesai: tidak ada secret di env tingkat job; checkout, setup-node, dan `npm ci` tidak menerima secret. Hanya langkah Guard dan E2E. Dijaga tes statis. |
| H3 | Pin action ke SHA | Selesai: `actions/checkout@11bd719…` (v4.2.2) dan `actions/setup-node@49933ea…` (v4.4.0), plus `persist-credentials: false`. Dijaga tes statis. |
| H4 | `NEXT_PUBLIC_SUPABASE_URL` wajib dan identik | Selesai di guard: wajib terisi dan identik dengan `QA_SUPABASE_URL`; `SUPABASE_URL`, bila ada, juga. Workflow mengisinya dari secret QA yang sama. |
| H5 | Allowlist proyek QA terkunci | Selesai sebagai mekanisme: `scripts/qa/qa-project-allowlist.mjs`, **sengaja KOSONG** (belum ada proyek QA, ref tidak dikarang). Selama kosong guard selalu menolak (fail-closed). |

### H1: langkah Founder dari HP (sebelum secret apa pun)
Penting: bila workflow merujuk Environment yang belum ada, GitHub membuatnya otomatis TANPA proteksi. Karena itu buat dan kunci dulu.
1. GitHub (web, mode desktop di Chrome HP) → repo → Settings → Environments → New environment → nama persis `qa-real-email`.
2. Deployment branches and tags → Selected branches and tags → tambahkan aturan `main` saja.
3. Required reviewers → centang, pilih akun Founder (dan, bila ada, satu orang lain). Aktifkan juga "Prevent self-review" bila ada orang kedua.
4. Baru setelah itu, tahap `APPROVE QA-2-SECRETS` boleh mengisi secret di Environment ini (bukan secret repo).
5. Pastikan tidak ada secret atau variabel repo berawalan `QA_` (nama yang sama di repo bisa terbaca oleh job).
Catatan: repo ini publik, jadi proteksi Environment tersedia di semua paket. Bila antarmuka tidak menampilkan opsi itu, STOP dan laporkan; jangan lanjut ke tahap secret.

### H5: cara mengisi allowlist (setelah proyek QA ada)
Setelah `APPROVE QA-2-SUPABASE-PROJECT` dan proyeknya benar-benar dibuat, ref 20 karakter ditambahkan ke `ALLOWED_QA_PROJECT_REFS` lewat PR kecil terpisah yang ditinjau. Ref tidak boleh proyek produksi/bersama (guard dan tes menolaknya). Tanpa entri di sana, URL dan secret apa pun yang disuplai runner ditolak.

### Residual (belum diselesaikan oleh PR ini)
- Pengirim: hanya `@tanyopo.com` persis yang ditolak; sub-domain QA sengaja diizinkan.
- `QA_PROJECT_REF_EXPECTED` tetap secret; kini hanya cek silang tambahan, bukan penentu (penentunya allowlist di repo).
- Adapter inbox dan alur E2E belum ada; status tetap NOT ACTIVATED.
