# Pantau LINOE dari HP (UptimeRobot gratis)

Untuk soft launch. Semua langkah bisa dilakukan dari browser/app HP Android. Tanpa biaya wajib. Pelengkap [RUNBOOK.md](RUNBOOK.md) bagian 4-6.
Status: **CODE READY** (endpoint dan panduan). Monitor belum terpasang: itu tindakan Founder. Tanggal akses sumber: 2026-11-11.

## 1. Apa yang dipantau

| Monitor | URL | Menjawab | Tipe UptimeRobot | Interval |
|---|---|---|---|---|
| Hidup | `https://<domain-produksi>/api/health` | Proses aplikasi melayani request | HTTP(s) | 5 menit |
| Siap | `https://<domain-produksi>/api/ready` | Aplikasi bisa menjangkau basis data (baca-saja, batas waktu 3 detik) | HTTP(s) | 5 menit |
| Halaman nyata | `https://<domain-produksi>/login` | Halaman benar-benar tampil (bukan layar putih) | Keyword, kata kunci `Masuk` | 5 menit |

Respons `/api/health`: `{"status":"ok"}`. Respons `/api/ready`: `{"status":"ok"}` (HTTP 200) atau `{"status":"degraded"}` (HTTP 503). Tidak ada detail, versi, atau data pengguna; UptimeRobot menganggap 503 sebagai Down.
Ganti `<domain-produksi>` dengan domain produksi (RUNBOOK/DEPLOYMENT). Jangan memantau URL preview (dilindungi Basic Auth).

## 2. Memasang dari HP

1. Buka uptimerobot.com di browser HP, daftar dengan email perusahaan (paket Free).
2. **Add New Monitor**. Isi tipe, URL, dan nama sesuai tabel bagian 1. Untuk `/login` pilih tipe **Keyword**, kata kunci `Masuk`, alert saat kata kunci **tidak ada**.
3. Tambah kontak alert: email (utama). Pasang juga app UptimeRobot (Android) untuk notifikasi push bila tersedia di paket Free; cek di pengaturan akun (belum terkonfirmasi dari halaman harga).
4. Uji: jeda monitor sebentar atau gunakan opsi uji notifikasi, pastikan alert sampai ke HP dalam 10 menit. Catat hasilnya.

Batas paket Free menurut halaman harga resmi ([uptimerobot.com/pricing](https://uptimerobot.com/pricing/?no_head=1), diakses 2026-11-11): 50 monitor, interval 5 menit, monitor Keyword termasuk, cocok untuk proyek komersial. SMS tidak termasuk (kredit dibeli terpisah): jangan andalkan SMS. Keterangan email dan push khusus Free tidak tegas di halaman itu: **PERLU DIKONFIRMASI** saat pemasangan. Semua monitor di atas cukup 3 dari 50.

## 3. Ambang alert

| Kondisi | Tingkat | Catatan |
|---|---|---|
| `/api/health` Down 2 pemeriksaan berturut-turut (sekitar 10 menit) | KRITIS | Aplikasi tidak melayani. Abaikan 1 kali gagal (gangguan jaringan sesaat) |
| `/api/ready` Down 2 berturut-turut, `/api/health` Up | TINGGI | Basis data tidak terjangkau; login/dashboard kemungkinan error |
| `/login` kata kunci hilang 2 berturut-turut, health Up | TINGGI | Halaman rusak (mis. deploy buruk) |
| Waktu respons rata-rata di atas 3 detik terus-menerus | SEDANG | Lambat; cek status penyedia |
| Satu kegagalan tunggal lalu pulih | INFO | Catat saja |

Bila pengaturan "kirim alert setelah N menit" tersedia di monitor, setel sekitar 10 menit; bila tidak, andalkan aturan 2 pemeriksaan di atas saat membaca alert.

## 4. Tindakan saat alert

| Alert | Lakukan (semua dari HP) |
|---|---|
| health Down | (1) Buka domain di browser HP untuk memastikan bukan salah jaringan. (2) Netlify: cek deploy terakhir. Bila baru deploy dan gagal, rollback atas persetujuan Founder (RUNBOOK bagian 2). (3) Cek status Netlify. (4) Eskalasi sesuai RUNBOOK bagian 4 |
| ready Down, health Up | Jangan rollback dulu (kode sehat). Ikuti RUNBOOK bagian 6: cek status.supabase.com. Proyek Supabase `umkmpro-ai` dipakai bersama aplikasi lain; **jangan ubah/pause/restore apa pun** |
| login keyword hilang | Buka `/login` di HP. Bila rusak dan baru deploy, rollback (persetujuan Founder). Bila normal, cek apakah teks tombol/judul berubah, lalu perbarui kata kunci monitor |
| Pulih | Jalankan smoke test ([SMOKE_TEST_CHECKLIST.md](SMOKE_TEST_CHECKLIST.md)), catat waktu mulai-selesai dan penyebab di arsip insiden |

Bila insiden menyangkut kebocoran data pribadi, ikuti SOP insiden dan konsultasikan kewajiban pemberitahuan (lihat checklist legal di PR #120); jangan menebak batas waktu.

## 5. Batasan

- `/api/ready` memeriksa jangkauan basis data lewat kunci publik (tanpa kunci layanan, tanpa tulis). Ia tidak membuktikan login, pembayaran, atau AI berfungsi; tetap jalankan smoke test setelah deploy.
- Pemantau eksternal tidak menggantikan pelacak error (P1-4 di rancangan soft launch, butuh persetujuan).
- Alert yang berulang tanpa penyebab jelas: catat jamnya, jangan ubah konfigurasi produksi tanpa persetujuan Founder.
