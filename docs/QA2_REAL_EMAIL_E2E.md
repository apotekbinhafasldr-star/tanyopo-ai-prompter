# QA-2: E2E email nyata (jalur B)

**Status: NOT ACTIVATED.** Hanya desain. Proyek Supabase QA sudah dibuat Founder dan refnya ada di allowlist, tetapi belum ada skema, domain pengirim, DNS, inbox, secret, atau Environment yang aktif. Tidak ada email yang dikirim.

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

## Sender-lock dan batas biaya
- `QA_SENDER_EMAIL` dan `QA_INBOX_ADDRESS` wajib satu alamat tunggal `nama@qa.tanyopo.com` (konstanta beku `QA_SENDER_DOMAIN`), tanpa `+`. Ditolak: display-name, koma/titik koma/spasi/CRLF, `x.qa.tanyopo.com`, `tanyopo.com`, `qa.tanyopo.com.evil.com`, unicode/homoglyph.
- Inbox ikut dikunci karena penyedia inbox belum dipilih dan kiriman ke alamat pihak lain adalah email nyata ke orang nyata. Bila kelak inbox harus di luar domain ini, ubah lewat PR terpisah.
- `QA_MAX_EMAILS_PER_RUN`, bila diset, hanya boleh `1`. Guard hanya memvalidasi; penghitungan kirim per run harus ditegakkan `real-e2e.mjs`.
- Batas Resend Free (verifikasi ulang di resend.com/pricing sebelum aktivasi): 100 email/hari dan 3.000/bulan (terverifikasi di halaman harga 2026-11-14). Apakah sent dan received dihitung gabungan TIDAK tertulis di halaman: anggap gabungan (UNKNOWN). Satu run = 1 kirim + 1 terima, sekitar 2 dari kuota.

## Estimasi biaya
ESTIMASI: Rp0 bila cukup tier gratis (Supabase, Resend, inbox). Sekitar USD 25/bulan bila perlu Supabase berbayar. DNS: biaya sekali untuk sub-domain (umumnya Rp0 bila domain sudah ada).

## Langkah aktivasi bertahap
Tiap langkah menunggu frasa persetujuan.
0. Founder menyiapkan Environment `qa-real-email` yang terkunci (H1) sebelum tahap mana pun yang memasang secret.
1. Proyek Supabase QA: SELESAI dibuat Founder (`linoe-qa-real-email`, organisasi terpisah, Free); ref ada di allowlist (H5). Skema/migrasi di proyek itu BELUM diterapkan dan butuh persetujuan terpisah.
2. `APPROVE QA-2-RESEND-DOMAIN`: sub-domain pengirim + DNS SPF/DKIM.
3. `APPROVE QA-2-INBOX`: pilih penyedia inbox tetap, lalu implementasi adapter.
4. `APPROVE QA-2-SECRETS`: isi secret di Environment `qa-real-email`.
5. `APPROVE QA-2-ENABLE`: set `QA2_ENABLED=true` dan `QA2_ACTIVATED`.

## Risiko dan guard
- Salah target ke produksi: `assertRealQaEnv` menolak ref di daftar blokir, ref tidak cocok, dan variabel produksi (SERVICE_ROLE, DATABASE_URL, DOKU_*, MIDTRANS_*, dll.).
- Pengirim/inbox: SENDER-LOCK (lihat bagian di bawah); selain `@qa.tanyopo.com` ditolak.
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
| H5 | Allowlist proyek QA terkunci | Selesai: `scripts/qa/qa-project-allowlist.mjs` berisi tepat satu ref, `gasdqsadnjoknisloaec` (proyek `linoe-qa-real-email`, organisasi terpisah dari umkmpro-ai). Ref lain, termasuk semua ref produksi/bersama, ditolak. Allowlist kosong tetap fail-closed. |

### H1: langkah Founder dari HP (sebelum secret apa pun)
Penting: bila workflow merujuk Environment yang belum ada, GitHub membuatnya otomatis TANPA proteksi. Karena itu buat dan kunci dulu.
1. GitHub (web, mode desktop di Chrome HP) → repo → Settings → Environments → New environment → nama persis `qa-real-email`.
2. Deployment branches and tags → Selected branches and tags → tambahkan aturan `main` saja.
3. Required reviewers → centang, pilih akun Founder (dan, bila ada, satu orang lain). Aktifkan juga "Prevent self-review" bila ada orang kedua.
4. Baru setelah itu, tahap `APPROVE QA-2-SECRETS` boleh mengisi secret di Environment ini (bukan secret repo).
5. Pastikan tidak ada secret atau variabel repo berawalan `QA_` (nama yang sama di repo bisa terbaca oleh job).
Catatan: repo ini publik, jadi proteksi Environment tersedia di semua paket. Bila antarmuka tidak menampilkan opsi itu, STOP dan laporkan; jangan lanjut ke tahap secret.

### H5: allowlist proyek QA
Isi saat ini: satu ref QA, `gasdqsadnjoknisloaec` (Supabase `linoe-qa-real-email`, organisasi "TANYOPO LINOE QA", paket Free, wilayah Seoul). Ref bukan rahasia. Menambah atau mengganti ref lewat PR kecil terpisah yang ditinjau. Ref tidak boleh proyek produksi/bersama (`umkmpro-ai`, `apotek-binhafas`, `linoe-otp-test`, `linoe-doku-sandbox`): guard dan tes menolaknya walau dimasukkan ke allowlist. URL dan secret yang disuplai runner tidak menentukan target; hanya allowlist di repo.

Memasukkan ref TIDAK mengaktifkan QA-2. Yang masih menahan: `QA2_ENABLED` tidak true, Environment `qa-real-email` (H1) belum dipastikan, secret belum ada, dan adapter inbox/E2E belum dibangun (`real-e2e.mjs` keluar dengan kode 3 NOT ACTIVATED).

Catatan keterbatasan proyek QA: skema LINOE belum diterapkan, dan objek bersama UMKMpro (`tenants`, `user_profiles`, `handle_new_user`) tidak ada di repo sehingga di QA akan berupa SIMULASI. Hasil QA-2 kelak bukan bukti bahwa jalur produksi identik.

### Residual (belum diselesaikan oleh PR ini)
- `QA_PROJECT_REF_EXPECTED` tetap secret; kini hanya cek silang tambahan, bukan penentu (penentunya allowlist di repo).
- Dengan allowlist terisi, langkah Guard di workflow bisa lulus bila semua variabel benar; langkah E2E tetap keluar kode 3 (NOT ACTIVATED).
- Adapter inbox dan alur E2E belum ada; status tetap NOT ACTIVATED.

### Wiring `real-e2e.mjs` (PR wiring) dan celah sisa
Sudah terwiring: bila `QA2_ACTIVATED=true`, `main()` membangun admin client (terkunci satu identitas), driver Playwright, dan adapter inbox `resend` (token `QA_INBOX_READ_TOKEN`), lalu menjalankan `runRealE2E`. `QA_APP_URL` (bawaan `http://localhost:3000`) divalidasi. Tanpa aktivasi: exit 3 tanpa membangun apa pun; guard/konstruksi gagal: exit 2 (inbox NOT_IMPLEMENTED: 3); tak terduga: exit 1. `driver.close()` dipanggil sekali di semua jalur; galat close dicatat tanpa secret dan tidak mengubah hasil.
Playwright tidak ada di `package.json` (kunci tak bisa dibangkitkan dari sandbox tanpa npm); workflow memasang `playwright@1.63.0` persis lewat `npm install --no-save --no-package-lock` tanpa secret. Memasukkannya ke `package.json` + lock sebaiknya lewat PR terpisah dari mesin yang punya npm.
Celah sisa (BLOCKER untuk E2E nyata): workflow BELUM membangun/menjalankan aplikasi uji lokal. Rancangan: langkah `npm run build` lalu `nohup npm run start &` + tunggu `http://localhost:3000`, dengan hanya `NEXT_PUBLIC_SUPABASE_URL` (proyek QA) dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (kunci QA) di env, sebelum langkah E2E. UNKNOWN: nama variabel kunci publik yang dibaca aplikasi, kebutuhan env server-only, dan apakah skema QA mendukung alur app.
