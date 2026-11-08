# Smoke test manual (bisa dari HP)

Jalankan setelah setiap deploy produksi/preview penting. Pakai browser HP, mode penyamaran, dan email uji yang bisa dibuka di HP. Billing hanya sandbox Midtrans. Tandai tiap baris; satu gagal = hentikan dan lihat [RUNBOOK.md](RUNBOOK.md).

## 0. Dasar
- [ ] `/api/health` menampilkan `{"status":"ok"}`
- [ ] Halaman utama `/` terbuka, tidak ada layar putih
- [ ] `/privacy`, `/terms` terbuka tanpa login

## 1. Register
- [ ] `/register`: isi email uji + sandi, kirim
- [ ] Muncul pesan cek email (bukan error)
- [ ] Email register dari LINOE sampai (cek juga spam) dalam 2 menit

## 2. Verifikasi email
- [ ] Buka tautan di email dari HP: masuk ke app, tidak dilempar ke `/login` dengan error
- [ ] Bila memakai kode OTP: kode diterima dan diterima oleh form
- [ ] Tautan yang sama dipakai kedua kali: pesan jelas, bukan error mentah

## 3. Login/Logout
- [ ] Keluar, lalu login dengan akun uji: masuk
- [ ] Sandi salah: pesan error ramah
- [ ] Buka `/dashboard` tanpa login: diarahkan ke `/login`

## 4. Onboarding
- [ ] Alur `/onboarding` tampil; isi data usaha dan simpan
- [ ] Selesai: masuk dashboard, nama usaha tampil
- [ ] Tampilan tidak terpotong di layar HP

## 5. Trial
- [ ] Dashboard/Billing menunjukkan status trial dan sisa hari
- [ ] Kuota AI trial tampil

## 6. AI
- [ ] Buka fitur AI Marketing, buat satu konten dari prompt singkat
- [ ] Hasil muncul; kuota berkurang
- [ ] Bila AI belum dikonfigurasi: pesan "belum dikonfigurasi", bukan crash

## 7. Billing/Checkout (SANDBOX)
- [ ] `/billing`: daftar paket tampil
- [ ] Pilih paket, mulai checkout: diarahkan ke halaman Midtrans sandbox
- [ ] Bayar dengan metode uji sandbox Midtrans (simulator), kembali ke app
- [ ] Beberapa menit kemudian status paket aktif (aktivasi dari verifikasi server)
- [ ] Invoice/riwayat tampil
- [ ] Buka checkout lagi pada paket yang sama: tidak ada pembayaran ganda

## 8. Akhir
- [ ] Periksa `/ops/payments` (akun operator): tidak ada alarm baru dari uji ini
- [ ] Console browser tidak penuh pelanggaran CSP pada alur di atas (laporan Report-Only)
- [ ] Catat hasil: tanggal, deploy ID, yang gagal
