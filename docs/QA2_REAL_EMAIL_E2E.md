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
| QA_SUPABASE_URL, QA_PROJECT_REF_EXPECTED | Founder (GitHub Environment) |
| QA_SUPABASE_PUBLISHABLE_KEY, QA_SUPABASE_SECRET_KEY | Founder (GitHub Environment) |
| QA_RESEND_SMTP_PASSWORD, QA_SENDER_EMAIL | Founder (GitHub Environment) |
| QA_INBOX_ADDRESS, QA_INBOX_READ_TOKEN | Founder (GitHub Environment) |
| QA2_ENABLED (variabel, bukan secret) | Founder |

Semua hanya di Environment `qa-real-email`. Bukan secret repo, bukan secret produksi. Nilai tidak pernah masuk repo atau chat.

## Estimasi biaya
ESTIMASI: Rp0 bila cukup tier gratis (Supabase, Resend, inbox). Sekitar USD 25/bulan bila perlu Supabase berbayar. DNS: biaya sekali untuk sub-domain (umumnya Rp0 bila domain sudah ada).

## Langkah aktivasi bertahap
Tiap langkah menunggu frasa persetujuan.
1. `APPROVE QA-2-SUPABASE-PROJECT`: buat proyek Supabase QA terpisah.
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

## Checklist hardening sebelum APPROVE QA-2-ENABLE (hasil review keamanan)
- Batasi Environment `qa-real-email` ke cabang `main` dan wajibkan reviewer; tanpa itu siapa pun dengan akses tulis bisa menjalankan workflow dari cabang lain.
- Kunci ref proyek QA yang diizinkan di kode atau variabel non-rahasia (bukan hanya `QA_PROJECT_REF_EXPECTED` dari secret yang sama).
- Wajibkan `NEXT_PUBLIC_SUPABASE_URL` sama dengan `QA_SUPABASE_URL` (jangan terima kosong) dan periksa `SUPABASE_URL`.
- Pindahkan secret dari `env` tingkat job ke `env` tingkat langkah, dan pin action dengan SHA.
- Perluas pemeriksaan pengirim (blokir semua alamat noreply@tanyopo.com) dan alamat inbox.
