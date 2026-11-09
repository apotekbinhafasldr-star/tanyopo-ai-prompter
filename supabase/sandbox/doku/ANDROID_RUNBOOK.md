# Panduan eksekusi dari Chrome Android — satu tahap per langkah

Project yang BENAR: **linoe-doku-sandbox**, ID **eskqngzhtndkfqjoxxou**.
JANGAN pernah: `umkmpro-ai`, `linoe-otp-test`. Tidak ada kunci/password yang perlu ditempel di mana pun.
Berkas: GitHub → branch `sandbox/doku-db-bootstrap` → `supabase/sandbox/doku/`. Buka berkas → ikon salin ("Copy raw file"); bila tombol tidak ada, buka tampilan "Desktop site" di Chrome.
SQL Editor: `https://supabase.com/dashboard/project/eskqngzhtndkfqjoxxou/sql/new`

Aturan: kerjakan BERURUTAN. Di tiap tahap, bila hasil tidak sama dengan "Harus terlihat" → **BERHENTI**, jangan ulangi, kirim teks hasil/error ke Claude.

## T0 — Pastikan project (wajib, tiap sesi)
1. Buka SQL Editor lewat tautan di atas. Lihat bilah alamat.
2. Harus terlihat: `.../project/eskqngzhtndkfqjoxxou/...` dan nama project di kiri atas `linoe-doku-sandbox`.
3. STOP bila ref lain (terutama `wjjyqovhmwenbcvbnkgx` atau `bmwpykwoylmzrbmbdeqw`).

## T1 — Aktifkan pg_cron
Dashboard → Database → Extensions → cari `pg_cron` → Enable. Harus terlihat: status Enabled. (Dua migrasi memakai pg_cron.) STOP bila tidak bisa diaktifkan.

## T2 — Preflight (baca saja)
Salin `00_preflight_readonly.sql` → New query → Run.
Harus terlihat: semua baris `PASS`, baris terakhir `ALL_PASS | PASS`. STOP bila ada `FAIL` (khusus baris 3: project ini punya user → bukan project yang benar).

## T3 — Shim objek bersama (menulis)
Salin `01_shim_shared_objects.sql` → Run. Harus terlihat: "Success. No rows returned". Pesan `ABORT:` → STOP.

## T4–T11 — Migrasi (menulis), BERURUTAN
`10_migrations_part_1.sql` lalu `part_2` … `part_8`. Satu berkas = satu Run.
Harus terlihat tiap kali: "Success". Pesan `ABORT: urutan salah` → Anda melewatkan bagian; STOP.
Gagal di tengah = seluruh bagian itu dibatalkan otomatis; jangan ulang sebelum melapor.

## T12 — Seed dummy (opsional, menulis)
`20_seed_dummy.sql` → Run → "Success".

## T13 — Verifikasi (baca saja)
`30_verify_readonly.sql` → Run. Harus terlihat: `ALL_PASS | PASS`. Baris FAIL = selisih dengan uji lokal; jangan abaikan, laporkan.

## T14 — Tes asap (selalu dibatalkan)
`31_smoke_checkout_apply_rollback.sql` → Run. Akan tampil **error** (disengaja) berisi laporan.
Harus terlihat di teks: `SMOKE_OVERALL=PASS` dan 10 baris `PASS`. Ini bukan kegagalan; tidak ada data tersimpan.

## Selesai — berhenti di sini
Variabel env, situs Netlify, dan kredensial DOKU adalah tahap terpisah yang butuh persetujuan Anda. `02_optional...` juga butuh persetujuan.

## Rollback (hanya bila diperintahkan)
Paling bersih: hapus project lalu buat ulang (ref baru). Atau `99_rollback_sandbox.sql` → Run (Supabase menampilkan peringatan operasi destruktif; konfirmasi hanya setelah T0 diulang). Lalu jalankan T2 lagi: baris 1,2,4,5 harus PASS. Baris 3 hanya PASS bila tidak ada pengguna signup; rollback tidak menghapus pengguna asli (hapus lewat Authentication → Users atau buat ulang project).
