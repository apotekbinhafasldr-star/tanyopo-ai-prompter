# QA-2: Start aplikasi lokal untuk E2E (audit + implementasi)

**Status: INERT.** Tidak ada secret/Supabase/Resend/DNS/GitHub/Netlify yang diubah. Semua temuan dari membaca kode (bukan dijalankan); yang tak terbukti ditandai UNKNOWN. Skrip: `scripts/qa/start-app-and-wait.mjs` (build | start | stop). Dasar: main `3319ff6`.

## 1. Env yang dibaca aplikasi pada jalur signup -> /auth/confirm -> onboarding -> dashboard -> trial
| Variabel | Jenis | Status | Bila hilang | Sumber |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | publik (ditanam saat build) | WAJIB | `readPublic` melempar saat modul dimuat: halaman/proxy 500; `/api/ready` degraded | `lib/env.ts`, `proxy.ts`, `lib/supabase/*` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publik (build) | WAJIB | sama | `lib/env.ts` |
| `NEXT_PUBLIC_APP_URL` | publik (build) | opsional, bawaan `http://localhost:3000` | link reset password salah host (bukan jalur signup) | `lib/env.ts`, `features/auth/actions.ts` |
| `SUPABASE_SECRET_KEY` | server-only | TIDAK dipakai jalur ini | `createAdminClient()` = `null` (NOT_CONFIGURED). Hanya webhook/jobs/connections/admin yang memanggilnya | `lib/supabase/admin.ts` |
| `EMAIL_OTP_ENABLED` | server flag | harus KOSONG | kosong = alur link `/auth/confirm` (yang diuji) | `lib/auth/email-otp.ts` |
| `PREVIEW_BASIC_AUTH_USER/PASSWORD` | server | harus KOSONG | kosong = gerbang Basic Auth no-op | `proxy.ts` |
Signup: `auth.signUp` tanpa `emailRedirectTo`; `/auth/confirm` memanggil `verifyOtp(type=signup)`; trial dibuat basis data (trigger `handle_new_user`) dan dibaca lewat klien sesi pengguna. Tidak ada env tambahan.

## 2. Build/start, port, dan callback
| Hal | QA-1 (`qa-signup-e2e.yml`) | QA-2 (ini) |
|---|---|---|
| Build | `npm ci`, `npm run build` | sama, via `start-app-and-wait.mjs build` dengan env anak minimal; menulis `.next/qa2-build.json` (ref QA) |
| Start | `nohup npm run start`, port 3000 (semua antarmuka) | `npm run start -- -H 127.0.0.1 -p 3000`, grup proses terpisah, pid di `qa-output/start-app.pid` |
| Readiness | curl `/login` 40x2 dtk | `/api/health` (200, `{status:"ok"}`) lalu `/login` (200); backoff 0,5-3 dtk; batas 120 dtk; gagal = exit non-0 + proses dimatikan |
| Dipakai ulang | urutan langkah, `npm run`, polling `/login`, port 3000, `NEXT_PUBLIC_APP_URL=http://localhost:3000` | |
`NEXT_PUBLIC_*` ditanam saat build, jadi build WAJIB memakai URL/key QA; start menolak bila penanda build bukan ref QA. Callback Auth (lihat `docs/QA2_AUTH_SMTP_CONFIG.md`): link `http://localhost:3000/auth/confirm?token_hash=...&type=signup&next=/onboarding`; Site URL `http://localhost:3000`; Redirect URL `/auth/callback` hanya untuk reset password.

## 3. Guard dan nama variabel
- Aplikasi TIDAK diberi `SUPABASE_SECRET_KEY` (guard melarang nama itu). `QA_SUPABASE_SECRET_KEY` hanya dipakai orkestrator E2E (admin client reset/cleanup), tidak diteruskan ke aplikasi.
- Pemetaan nama (hanya di proses anak): `QA_SUPABASE_URL` -> `NEXT_PUBLIC_SUPABASE_URL`; `QA_SUPABASE_PUBLISHABLE_KEY` -> `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Nama ini tidak dilarang guard (yang dilarang: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SERVICE_ROLE`, `RESEND_*`, dst.).
- Env anak dibangun dari nol (PATH, HOME, dll. + 3 `NEXT_PUBLIC_*` + `PORT`/`HOSTNAME`): variabel runner/produksi tidak bisa ikut.
- `validateStartEnv` menjalankan guard QA-2 penuh (allowlist `ALLOWED_QA_PROJECT_REFS`, URL persis, tolak `.supabase.com`/ref lain/`DATABASE_URL`) ditambah daftar nama fitur app (`PAYMENT_*`, `ADMIN_CENTER_ENABLED`, `EMAIL_OTP_ENABLED`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_*`, `META_*`, `TIKTOK_*`, `X_*`, dst.) dan menolak berkas `.env*` di repo.
- Workflow: tes statis H2 yang ada membatasi secret ke DUA langkah (Guard dan E2E). Karena itu build+start+E2E+stop berada di satu langkah E2E (jebakan `trap EXIT` untuk stop); langkah Guard tidak menjalankan aplikasi; langkah "Hentikan aplikasi QA" (`always()`) tanpa env/secret.

## 4. Risiko layanan lain dan pemblokirannya
| Layanan | Jalur | Pemblokiran |
|---|---|---|
| Resend langsung | hanya `RESEND_ALERT_API_KEY` di `netlify/lib` (fungsi terjadwal, tidak jalan di `next start`); email signup dikirim Supabase Auth via SMTP QA | `RESEND_*` ditolak guard; tidak diteruskan |
| DOKU/Midtrans/Xendit | `get-payment-provider` membaca `PAYMENT_PROVIDER_NAME` | `PAYMENT_*` kosong = NullPaymentProvider; `PAYMENT_LIVE_ENABLED` ditolak bila terisi |
| Meta/TikTok/X | `META_*`, `TIKTOK_*`, `X_*` | kosong = connector NOT_CONFIGURED; ditolak bila terisi |
| AI provider | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | kosong = AI NOT_CONFIGURED; ditolak bila terisi |
| Cron/jobs | Netlify scheduled functions; `/api/internal/*` | tidak jalan di `next start`; tanpa `JOBS_PROCESSOR_SECRET`/`PAYMENT_SWEEPER_SECRET` rute 503 |
| Admin Center / OTP | `ADMIN_CENTER_ENABLED`, `EMAIL_OTP_ENABLED` | harus kosong; ditolak bila terisi |
| Supabase produksi | `NEXT_PUBLIC_SUPABASE_URL` | hanya ref allowlist `gasdqsadnjoknisloaec`; `.env*` ditolak |

## 5. UNKNOWN (tidak bisa dibuktikan tanpa menjalankan)
- Skema proyek QA memuat tabel/trigger yang dibutuhkan (lihat `docs/QA2_SCHEMA_MINIMUM.md`); `/api/ready` tidak dijadikan syarat readiness karena itu.
- `next build` sukses dengan hanya 3 `NEXT_PUBLIC_*` (tidak ada env server lain saat build): belum dijalankan; pembuktian pertama saat run nyata.
- Binding `127.0.0.1` vs `localhost` pada Chromium (resolusi IPv6 `::1`): dugaan fallback otomatis, belum terbukti.
- `-H`/`-p` lewat `npm run start --` pada Next 16.3.3 (docs `node_modules/next/dist/docs/` tidak terpasang; mengikuti QA-1 yang memakai `npm run start`).
- Tidak ada jalur signup/onboarding yang memanggil `createAdminClient` (hasil grep statis); bila ternyata ada, perlu PR terpisah dan persetujuan.
- Pembersihan proses saat runner dibatalkan paksa (SIGKILL pada job): runner membersihkan proses saat job berakhir.
