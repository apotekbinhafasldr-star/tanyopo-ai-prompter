# Bootstrap database sandbox DOKU (LINOE) — PERSIAPAN, BELUM DIJALANKAN DI SUPABASE MANA PUN

**Panduan langkah demi langkah dari Chrome Android: [`ANDROID_RUNBOOK.md`](ANDROID_RUNBOOK.md).**

Baseline: main `a07942ed27d72e041f91e9c50c504869218fa6c3`. Tujuan: database TERPISAH untuk menguji jalur pembayaran
(checkout → invoice → webhook → langganan; ledger hanya diverifikasi keberadaan + RLS-nya).

## Status: kode PASS; kesetaraan dengan production BLOCKED
Definisi asli `tenants`, `user_profiles`, `fn_current_tenant_id()`, `fn_current_role()`, `handle_new_user` **tidak ada di repo**
(dimiliki UMKMpro). `01_shim_shared_objects.sql` hanya shim yang disusun dari `types/database.ts`, `docs/DATABASE.md`, dan
catatan katalog di `supabase/tests/.../prod_snapshot.sql`. Ia cukup untuk menguji jalur pembayaran, **bukan bukti bahwa
perilaku sama dengan production**. Untuk mengganti dengan yang asli: lihat "Definisi asli" di bawah.

## Identitas project sandbox (terverifikasi)
- Nama `linoe-doku-sandbox`, ref/ID `eskqngzhtndkfqjoxxou` (20 karakter, lolos `tools/check_ref.py` dan regex guard), region `ap-south-1`,
  PostgreSQL 17.11, status ACTIVE_HEALTHY, dibuat 2026-11-09 — dibaca lewat metadata project (bukan SQL).
- ID yang diberikan sebelumnya salah (21 karakter, ada huruf lebih di depan) dan DITOLAK guard; jangan dipakai.
- Ref ini bukan rahasia; tetap TIDAK ada kunci/password di berkas mana pun.

## Cara memastikan identitas project (tanpa secret)
SQL **tidak bisa** membaca ref project. Karena itu ada dua lapis:
1. **Manusia (wajib):** sebelum tiap eksekusi, lihat URL dashboard di Chrome — harus memuat `/project/<ref sandbox>`;
   cocokkan dengan Settings → General. Tolak bila ref = `wjjyqovhmwenbcvbnkgx` (production) atau `bmwpykwoylmzrbmbdeqw` (OTP).
2. **Sidik jari di SQL (otomatis):** `00_preflight` + guard tiap bundel menolak bila public tidak kosong, `auth.users` ≠ 0
   (OTP-test punya 1 user), ada tabel UMKMpro, atau urutan salah. Diuji negatif di lokal (6 skenario).
Keterbatasan: sidik jari bukan bukti identitas. Project baru kosong tidak bisa dibedakan secara SQL dari project baru kosong lain.

## Urutan eksekusi (Supabase Dashboard → SQL Editor, Chrome Android)
Berkas disalin dari GitHub ("Copy raw file"), butuh Draft PR yang disetujui. Setiap bagian ≤ 57 KB, satu transaksi (gagal = tidak ada yang terpasang).
| # | Berkas | Sifat | Hasil yang diharapkan |
|---|---|---|---|
| 0 | `00_preflight_readonly.sql` | baca saja | baris 1–11 PASS, `ALL_PASS`=PASS (baris pg_cron bisa FAIL bila ekstensi belum aktif → aktifkan di Database → Extensions lalu ulangi) |
| 1 | `01_shim_shared_objects.sql` | tulis | sukses |
| 2 | `10_migrations_part_1..8.sql` | tulis | berurutan 1→8, tiap bagian sukses |
| 3 | `20_seed_dummy.sql` | tulis | sukses (opsional) |
| 4 | `30_verify_readonly.sql` | baca saja | `ALL_PASS`=PASS; FAIL = selisih yang harus dijelaskan |
| 5 | `31_smoke_checkout_apply_rollback.sql` | selalu rollback | pesan error berisi `SMOKE_OVERALL=PASS` (itu BUKAN kegagalan) |
| – | `02_optional_signup_and_profile_policy.sql` | tulis, **butuh persetujuan terpisah** | hanya bila E2E lewat UI/login |

## Rollback
- Paling bersih: hapus project sandbox, buat baru (ref baru → perbarui allow-list).
- SQL: `99_rollback_sandbox.sql` (menolak jalan tanpa marker sandbox, bila ada tabel UMKMpro, atau bila ada tabel/fungsi tak dikenal di `public`; hanya menghapus objek yang dikenal). Teruji lokal: kembali ke keadaan kosong, aman diulang.
  Batasan: Supabase mungkin menolak DELETE langsung pada `storage.buckets` → 4 bucket bisa tertinggal (ada NOTICE).

## Hasil uji LOKAL (PostgreSQL 16 sekali pakai + stub Supabase; CI repo memakai PG17)
- Tanpa shim: **0/49** (gagal di file pertama: `public.tenants` tidak ada) — kegagalan ASLI repo.
- Mayor PostgreSQL: sandbox PG 17.11; uji lokal PG 16 (PG17 tidak tersedia di lingkungan ini) — selisih mayor belum teruji.
- Dengan shim + stub: **49/49**, verifikasi 17/17, smoke 10/10, rollback → kosong. Keterbatasan stub: `auth.users`, `storage.*`, `cron.*`, role,
  `pg_cron`, event trigger RLS otomatis Supabase. Kegagalan terdahulu di `b4_2` (`email_confirmed_at`, `banned_until`) murni artefak stub.
- Temuan: `prompter_audit_logs.actor_user_id` → `auth.users` (pengguna dummy harus ada di `auth.users`); migrasi membuat tabel `acct_*`, `finance_*`, `tax_opt_*`
  (bukan `prompter_*`), 3 job pg_cron, 4 bucket storage.
- `python3 tools/check_bundles.py` (statis), `tools/local_replay.sh` (replay; menolak host non-lokal).

## Koneksi aplikasi uji (hanya NAMA variabel, tanpa nilai)
Situs Netlify **baru, terpisah**, dibangun dengan env sandbox (variabel `NEXT_PUBLIC_*` ikut terpanggang saat build). Bukan situs production,
bukan Deploy Preview situs production (mewarisi env production), bukan `linoe-otp-test-2026` (terhubung project OTP, SSO-protected).
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (semua milik project sandbox),
`NEXT_PUBLIC_APP_URL`, `PAYMENT_PROVIDER_NAME=doku`, `PAYMENT_PROVIDER_ENV=sandbox`, `PAYMENT_PROVIDER_CLIENT_ID`, `PAYMENT_PROVIDER_API_KEY`,
`PAYMENT_SANDBOX_DB_PROJECT_REFS=<ref sandbox 20 karakter>`, `PAYMENT_LIVE_ENABLED` dibiarkan kosong. Dua fungsi terjadwal
(`payment-alert-notify`, `payment-pending-sweep`) akan ikut berjalan terhadap DB sandbox; `ALERT_EMAIL_ENABLED` tetap mati.
DOKU butuh webhook publik: situs dengan SSO tidak bisa menerimanya (keputusan Founder terpisah).

## Definisi asli (mengganti shim)
`tools/readonly_prod_definition_extract.sql`: hanya SELECT katalog, tanpa data baris, satu sel JSON. **Dijalankan Founder sendiri bila ia putuskan**;
Claude tidak menjalankannya dan tidak menyentuh project itu. Dari hasilnya, shim diganti dan perbedaan dengan asumsi dicatat.

## Catatan penting di Supabase asli
- Project Supabase baru biasanya punya event trigger `rls_auto_enable` yang mengaktifkan RLS otomatis pada tabel baru. Akibatnya verifikasi
  "tabel tanpa RLS = 0" bisa lolos walau migrasi tidak mengaktifkan RLS. Di replay lokal (tanpa trigger itu) RLS terbukti berasal dari migrasi.
- Cakupan: skrip ini menguji SQL jalur pembayaran, bukan DOKU (tanpa panggilan jaringan), dan bukan RLS dari sisi klien PostgREST.
