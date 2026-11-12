# LINOE Reusable QA Sandbox: tahap 1 (jalur A, MOCK/INTEGRATION)

Status: **Draft (QA-1)**. Hanya berkas QA/CI dan dokumentasi. Tidak ada perubahan kode aplikasi, database bersama, Auth produksi, SMTP/Resend, Netlify, env, atau secret.

## Tujuan
Satu identitas QA tetap, `qa-linoe@example.test`, dipakai berulang pada setiap run CI untuk menguji signup, konfirmasi email, onboarding, dan trial 14 hari. Founder tidak perlu membuat email baru.

## Cara kerja
1. Workflow `.github/workflows/qa-signup-e2e.yml` menyalakan Supabase **lokal sementara** di runner GitHub (`qa/supabase-local`): Auth (GoTrue) nyata, PostgREST, dan Mailpit sebagai penangkap email.
2. `scripts/qa/apply-local-db.sh` memasang shim objek bersama (`supabase/sandbox/doku/01_shim_shared_objects.sql`), simulasi `handle_new_user` (`qa/supabase-local/sql/`), lalu semua migrasi `supabase/migrations/*` berurutan.
3. Aplikasi di-build dan dijalankan lokal terhadap stack itu. `scripts/qa/signup-e2e.mjs` (Playwright) menjalankan: signup lewat `/register`, login sebelum konfirmasi ditolak, tautan konfirmasi diambil dari Mailpit, `/auth/confirm` membuat sesi, onboarding 8 langkah, `/billing` membuat trial, lalu memeriksa trial TRIALING/FREE/14 hari, profil brand tersimpan, trigger S1 aktif, dan daftar ulang dengan alamat sama ditolak.
4. **Reset:** stack baru di setiap run, jadi alamat yang sama selalu bisa mendaftar lagi. Tidak ada data yang bertahan dan tidak ada infrastruktur bersama yang di-reset.

## Kelas bukti (jujur)
| Klaim | Kelas | Catatan |
|---|---|---|
| Alur signup, konfirmasi, onboarding, trial 14 hari berjalan di kode + Auth nyata lokal | INTEGRATION | Basis data lokal memakai migrasi repo |
| Email "terkirim" | **MOCK** | Mailpit lokal menangkap email. **Bukan** bukti pengiriman nyata |
| Resend / domain tanyopo.com / kotak masuk nyata | **TIDAK DIUJI** | Itu jalur B (REAL E2E), terpisah, manual, butuh persetujuan Founder |
| Perilaku `handle_new_user` UMKMpro | **SIMULASI** | Definisi aslinya tidak ada di repo; hanya meniru perilaku di `docs/DATABASE.md` |
| `tenants`, `user_profiles` | **SIMULASI** | Shim yang sama dengan sandbox DOKU; bukan salinan produksi |

## Keamanan
- `scripts/qa/local-stack-guard.mjs` fail-closed: menolak URL/host non-lokal, referensi proyek Supabase nyata, `*.supabase.co`, `netlify.app`, `api.resend.com`, dan variabel kredensial (`SUPABASE_SECRET_KEY`, `DATABASE_URL`, `RESEND_*`, `NETLIFY_*`, dll.). Dijalankan di workflow dan di skrip E2E/DB.
- Workflow tidak memakai `secrets.*`, izin hanya `contents: read`, tidak memanggil Netlify, tidak deploy, tidak menyentuh workflow produksi.
- Tidak ada bypass anti-abuse atau kebijakan trial di aplikasi: tidak ada perubahan kode aplikasi, tidak ada flag, dan tidak ada pengecualian email QA. Trial 14 hari tetap ditegakkan trigger S1 yang sama dengan produksi. Fingerprint (S3, PR #31) tidak disentuh.
- Identitas QA berakhiran `.test` (tidak bisa menjadi alamat nyata). Kata sandi acak per run, hanya hidup di runner.

## Batas
- Pembatas laju pendaftaran produksi (5/jam/IP) tidak diuji di sini (memori proses, satu run).
- Versi Supabase CLI memakai rilis mayor 2 terbaru (`supabase@2`); bila konfigurasi lokal berubah antar rilis, pin versi.
- Jalur B (REAL E2E Resend, satu inbox tetap, proyek sandbox terisolasi, reset hanya pada allowlist) belum dibuat (QA-2).
