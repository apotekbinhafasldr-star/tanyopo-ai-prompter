# Go-Live Pembayaran (Midtrans)

Status default: **sandbox saja**. Pembayaran live TIDAK aktif sampai Founder memberi persetujuan eksplisit dan semua
langkah di bawah selesai. Semua langkah bisa dikerjakan dari HP (dashboard Midtrans, Netlify, GitHub di browser).

## 1. Prasyarat (sebelum menyentuh env)
- [ ] Akun Midtrans Production sudah disetujui (KYB selesai, metode bayar aktif).
- [ ] PR C (flag live, sweeper, ekspor CSV) sudah di-merge dan terdeploy ke produksi dengan flag masih KOSONG.
- [ ] Netlify build terbaru hijau; `/billing` tetap berjalan seperti biasa dengan sandbox.
- [ ] Ada satu operator pembayaran aktif (`prompter_payment_operators`) yang bisa membuka `/ops/payments`.
- [ ] Persetujuan tertulis Founder untuk go-live (catat tanggal/jam).

## 2. Checklist env (Netlify, scope Production, server-side saja)
Jangan pernah menaruh nilai di git, chat, atau variabel `NEXT_PUBLIC_*`.

| Variabel | Sandbox (sekarang) | Live |
|---|---|---|
| `PAYMENT_PROVIDER_NAME` | `midtrans` | `midtrans` |
| `PAYMENT_PROVIDER_API_KEY` | `SB-Mid-server-...` | `Mid-server-...` (Server Key Production) |
| `PAYMENT_LIVE_ENABLED` | kosong | `true` (huruf kecil persis) |
| `PAYMENT_PROVIDER_ENV` | kosong / `sandbox` | `production` (huruf kecil persis) |
| `NEXT_PUBLIC_APP_URL` | domain app | domain app produksi (https) |
| `CHECKOUT_ALLOWED_ORIGINS` | kosong | kosong (isi hanya jika ada domain tambahan) |

Aturan fail-closed (dijaga kode):
- Tanpa kedua flag: hanya key `SB-Mid-server-` diterima dan host sandbox dipakai.
- Live butuh KEDUA flag cocok. Hanya satu flag, nilai salah (`TRUE`, `1`, `yes`), atau key tidak cocok mode
  (key sandbox di mode live, key production di mode sandbox) = pembayaran dianggap belum dikonfigurasi (checkout, webhook,
  dan rekonsiliasi berhenti dengan aman).
- Server Key juga kunci tanda tangan webhook; `PAYMENT_PROVIDER_WEBHOOK_SECRET` tidak dipakai untuk Midtrans.

## 3. Notification URL di Midtrans
Dashboard Midtrans > Settings > Configuration > Payment Notification URL (isi di environment yang sesuai):

```
https://<domain-produksi>/api/webhooks/payment
```

- Isi Finish/Unfinish/Error Redirect URL kosong atau ke `https://<domain-produksi>/billing` (redirect checkout memakai
  parameter dari aplikasi; hasil bayar tetap diverifikasi server ke Midtrans, bukan dari redirect).
- Jalur `/api/webhooks/payment` memang publik (tanpa cookie); keamanannya: tanda tangan SHA512 + cek status langsung ke Midtrans.

## 4. Urutan uji: sandbox lalu live
**A. Sandbox (wajib hijau dulu)**
1. Env sandbox terpasang (kolom Sandbox), Notification URL sandbox mengarah ke domain.
2. Buat checkout paket termurah dari `/billing` dengan akun uji. Bayar dengan simulator sandbox Midtrans.
3. Pastikan: status transaksi PAID, langganan aktif satu periode, satu invoice PAID, tidak ada alarm di `/ops/payments`.
4. Uji kegagalan: biarkan satu checkout kedaluwarsa (batas Snap 24 jam) atau batalkan; pastikan tidak mengaktifkan langganan.
5. Kirim ulang notifikasi dari dashboard Midtrans: tidak boleh menggandakan periode.

**B. Live (jendela sepi, Founder memantau)**
1. Ganti env sesuai kolom Live, **lalu** deploy ulang (env baru hanya berlaku setelah deploy).
2. Ganti Notification URL di dashboard Midtrans **Production**.
3. Transaksi uji nyata paket termurah dengan kartu/VA milik sendiri. Cek langkah A.3.
4. Unduh ekspor rekonsiliasi hari itu (`/ops/payments`, kartu "Ekspor rekonsiliasi") dan cocokkan dengan Midtrans (kolom `check` harus `OK`).
5. Refund transaksi uji sesuai `docs/REFUND_RUNBOOK.md`.
6. Baru buka ke pelanggan.

## 5. Sweeper invoice PENDING (opsional, default MATI)
Fungsi terjadwal `payment-pending-sweep` (tiap 10 menit) memeriksa ulang transaksi PENDING berumur > 10 menit lewat
`verifyAndSettle` yang sudah ada (maks. 25 per jalan, idempoten). Syarat sebelum dinyalakan:
- Persetujuan terpisah untuk mengecualikan `/api/internal/payments/sweep` dari redirect login di `proxy.ts`.
- `PAYMENT_SWEEPER_SECRET` (acak, sama di fungsi dan app) lalu `PAYMENT_SWEEPER_ENABLED=true`.
- Tanpa itu fungsi hanya mencatat `status=disabled` dan tidak melakukan apa pun.

## 6. Rollback (cepat, dari HP)
Tujuan: berhenti menerima pembayaran baru secara aman.
1. Netlify > Environment variables: **kosongkan** `PAYMENT_LIVE_ENABLED` dan `PAYMENT_PROVIDER_ENV` (atau ganti key ke
   `SB-Mid-server-`). Trigger deploy. Hasil: adapter tidak terkonfigurasi, checkout menolak dengan pesan jujur, tidak ada
   transaksi baru ke Midtrans.
2. Pembayaran yang sudah masuk tetap sah dan tercatat. Notifikasi yang datang saat mode mati tidak diproses (kemungkinan Midtrans mengirim
   ulang); setelah mode kembali, jalankan "Sinkronkan sekarang" di `/ops/payments` dan cek ekspor rekonsiliasi.
3. Pelanggan yang sudah bayar tapi belum aktif: jangan aktifkan manual; tunggu sinkronisasi / sweeper, atau eskalasi ke Founder.
4. Jika Server Key diduga bocor: regenerasi di dashboard Midtrans, perbarui env, deploy, lalu cek tidak ada transaksi asing.
5. Catat waktu, penyebab, dan tindakan di catatan insiden.
