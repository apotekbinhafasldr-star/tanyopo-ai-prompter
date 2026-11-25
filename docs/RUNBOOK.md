# Runbook operasional LINOE

Semua langkah bisa dikerjakan dari HP (browser + aplikasi Netlify/Supabase/GitHub). Tidak perlu laptop.

## 1. Cek cepat: apakah app hidup?

1. Buka `https://<domain-produksi>/api/health` di browser HP.
2. Normal: `{"status":"ok"}`. Endpoint ini tidak mengecek database, jadi "ok" hanya berarti app berjalan.
3. Tidak terbuka / error 5xx: lihat bagian 2 (rollback) dan bagian 5 (Supabase).
4. App ok tapi login/data gagal: curigai Supabase (bagian 5).

## 2. Rollback deploy di Netlify

Pakai bila setelah deploy baru ada error besar (halaman putih, login gagal, checkout rusak).

1. Netlify (app/web) -> pilih site LINOE -> **Deploys**.
2. Cari deploy terakhir yang sehat (status Published, sebelum masalah mulai).
3. Buka deploy itu -> **Publish deploy**. Produksi langsung kembali ke versi itu; tidak perlu build ulang.
4. Cek `/api/health` lalu jalankan [SMOKE_TEST_CHECKLIST.md](SMOKE_TEST_CHECKLIST.md) bagian login.
5. Netlify berhenti auto-publish setelah rollback. Aktifkan lagi (**Start auto publishing**) hanya setelah perbaikan siap.
6. Catat: jam, deploy mana yang dipublish, penyebab dugaan.

Catatan: rollback hanya mengembalikan kode. Perubahan database (migrasi) TIDAK ikut kembali. Jangan jalankan SQL perbaikan tanpa persetujuan Founder.

Backup, RPO/RTO, dan latihan restore ke project baru: lihat [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Nilai RPO/RTO, retensi backup, PITR, dan paket Supabase saat ini UNKNOWN / diisi Founder dari dashboard; jangan dijanjikan ke pelanggan sebelum terverifikasi. Data yang sudah dihapus bisa masih ada di cadangan sampai cadangan berganti, dan setelah restore penghapusan atas permintaan subjek data harus dijalankan ulang: lihat [BACKUP_RESTORE.md](BACKUP_RESTORE.md) bagian 3 (prosedur pasca-restore) dan [legal/KEBIJAKAN_RETENSI.md](legal/KEBIJAKAN_RETENSI.md).

## 3. Pembayaran macet

Gejala: pelanggan sudah bayar tapi paket belum aktif, atau status tertahan "pending".

1. Minta bukti: email akun, waktu bayar, order ID (dari halaman Billing atau bukti bayar).
2. Buka halaman operator `/ops/payments` (perlu akun operator). Cek alarm yang terbuka dan status transaksi.
3. Cek di dashboard Midtrans (sandbox saat ini) apakah transaksi berstatus settlement/capture.
4. Midtrans sukses tapi paket belum aktif: tunggu satu siklus webhook/rekonsiliasi (beberapa menit), muat ulang Billing. Aktivasi hanya dari verifikasi server ke Midtrans, bukan dari redirect browser.
5. Masih macet setelah 30 menit: eskalasi (bagian 4). Jangan edit tabel pembayaran/langganan manual, jangan ubah kunci/env pembayaran tanpa persetujuan Founder.
6. Email alarm (bila `ALERT_EMAIL_ENABLED=true`) dikirim oleh scheduled function `payment-alert-notify`; lihat log function di Netlify -> Logs -> Functions. Detail: [BILLING_B4_PAYMENT_ALERTS.md](BILLING_B4_PAYMENT_ALERTS.md) dan [BILLING_B4_2_EMAIL_NOTIFICATIONS.md](BILLING_B4_2_EMAIL_NOTIFICATIONS.md).

## 4. Kontak dan urutan eskalasi

Kontak ditetapkan oleh Founder (jangan simpan sandi/kunci di sini). **Bagian ini adalah satu-satunya sumber kontak eskalasi**; [BACKUP_RESTORE.md](BACKUP_RESTORE.md) bagian 6 merujuk ke sini dan tidak menyimpan kontak sendiri.

**Keputusan Founder (22 Nov 2026):** email perusahaan di bawah ini menjadi kontak darurat utama LINOE. Belum ada kontak eskalasi independen: Level 1 dan Level 2 memakai satu email yang sama, sehingga email tunggal ini adalah single point of failure (bila tidak terpantau, tidak ada jalur cadangan). Operator cadangan (orang atau email berbeda) harus ditunjuk sebelum mengundang tenant eksternal, lalu tabel ini diperbarui.

| Level | Siapa | Kapan | Kontak |
|---|---|---|---|
| 1 | Operator/pemantau | Notifikasi uptime atau laporan pelanggan | tanyopofuturetechnology@gmail.com (sementara; pemantau memakai email perusahaan) |
| 2 | Founder LINOE | Level 1 tidak selesai 15 menit, atau menyangkut uang/data | tanyopofuturetechnology@gmail.com (sementara; sampai operator cadangan ditunjuk) |
| 2b | Kontak cadangan (orang/email berbeda dari Level 1-2) | Level 1 dan 2 tidak terjangkau | [DIISI FOUNDER] |
| 2c | Pemilik akun Supabase / Netlify (bila beda orang) | Perlu tindakan di dashboard Supabase atau Netlify (rollback, ubah env) | [DIISI FOUNDER] |
| 3 | Dukungan vendor | Netlify, Supabase, Midtrans sesuai sumber masalah | Dashboard masing-masing -> Support |

Urutan: (1) cek `/api/health`, (2) rollback bila baru deploy, (3) cek Supabase status, (4) eskalasi ke Founder, (5) tiket vendor.

Aksi yang selalu butuh persetujuan Founder: ubah env/kunci, SQL ke database produksi, ubah billing/auth/RLS, merge/deploy.

**Insiden data pribadi** (dugaan kebocoran, akses tanpa izin, atau data pelanggan terekspos): jangan ditangani hanya dengan urutan di atas. Ikuti [legal/SOP_INSIDEN.md](legal/SOP_INSIDEN.md) dan eskalasikan ke Founder segera lewat kontak di tabel ini. Isi SOP tidak disalin ke runbook ini; rujuk dokumen itu langsung. Terkait cadangan dan penghapusan data: [BACKUP_RESTORE.md](BACKUP_RESTORE.md) dan [legal/KEBIJAKAN_RETENSI.md](legal/KEBIJAKAN_RETENSI.md).

## 5. Pantau uptime (UptimeRobot gratis)

1. Daftar di uptimerobot.com (bisa dari HP).
2. **Add New Monitor** -> tipe HTTP(s) -> URL `https://<domain-produksi>/api/health` -> interval 5 menit.
3. Opsional: Keyword monitor, kata kunci `ok`.
4. Tambah kontak alert (email / push app UptimeRobot).
5. Down berarti app tidak melayani request; ikuti bagian 1 dan 2.

## 6. Bila Supabase down

Gejala: `/api/health` ok, tetapi login, dashboard, atau billing error/lambat.

1. Cek status.supabase.com dan dashboard proyek Supabase (proyek `umkmpro-ai` dipakai bersama aplikasi lain; jangan ubah apa pun di sana).
2. Jika Supabase memang gangguan: tunggu pemulihan. Rollback tidak membantu. Informasikan pelanggan lewat kanal yang ada.
3. Jika status normal tapi error: cek Netlify -> Logs -> Functions untuk pesan error, dan apakah deploy terakhir mengubah sesuatu (rollback bila ya).
4. Jangan pause/restore proyek, jangan jalankan SQL, tanpa persetujuan Founder (proyek bersama).
5. Setelah pulih: jalankan smoke test, cek `/ops/payments` untuk pembayaran yang tertahan selama gangguan.

## 7. Header keamanan dan CSP

Header diatur di `next.config.ts`. Content-Security-Policy saat ini **Report-Only**: tidak memblokir apa pun, pelanggaran hanya tampil di console browser. Untuk memperketat: buka halaman utama dari browser dengan DevTools (atau Chrome remote debugging dari HP), catat pelanggaran, rapikan daftar sumber, baru ganti ke `Content-Security-Policy` setelah disetujui Founder.
