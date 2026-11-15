# Audit kesiapan pembayaran elektronik (LPE) LINOE

Status: **audit baca-saja, dokumen saja.** Bukan nasihat hukum dan bukan keputusan hukum; hal perizinan diserahkan ke ahli hukum/otoritas.
Basis: `origin/main` d19232a. Tanggal: 2026-11-15. Tidak ada perubahan kode, env, Netlify, database, atau pembayaran. Tes tidak dijalankan lokal (npm tidak terjangkau); status tes = "ada di repo, dijalankan CI".

## 0. Lingkup dan koreksi istilah

- "ADO" menurut Founder = salah tulis untuk **AEO/GEO** (ditangani Agen 3, tidak diduplikasi di sini).
- "LPE" ditafsirkan **Layanan Pembayaran Elektronik** (INTERPRETASI koordinator atas ucapan Founder; belum dikonfirmasi). Istilah ini **tidak ditemukan** di repo (`git grep -w -i lpe` hanya cocok dengan PNG biner `docs/admin-center/*.png`) dan tidak ditemukan sebagai nama izin pada halaman Bank Indonesia yang dibaca. Istilah izin yang tertulis resmi di BI adalah **Penyedia Jasa Pembayaran (PJP)**. Pemetaan LPE ke PJP/PSE adalah dugaan, bukan fakta.
- "Belum di iris" dibaca "belum diurus" (interpretasi). Status pendaftaran/izin sebenarnya **UNKNOWN** (tidak ada bukti di repo).

Kelas bukti: CODE (dibaca di kode), UNIT (tes ada, dijalankan CI), DOC (dokumen repo), OFFICIAL (halaman otoritas dibaca), SECONDARY (non-resmi), UNKNOWN.

## 1. Jawaban inti

**Soft launch trial 14 hari bisa berjalan tanpa pembayaran live: YA, secara kode (CODE), dengan satu syarat konfigurasi (C1).**
- Trial: paket FREE berlabel "14 hari" (`lib/billing/plans.ts:58-61`), dibuat malas oleh `getOrCreateSubscription` (`services/billing.ts:43`). Tidak memerlukan penyedia pembayaran.
- Jalur berbayar gagal-tertutup: `startCheckout` menolak paket gratis (`services/checkout.ts:63`) dan, bila penyedia belum terkonfigurasi, mengembalikan "Pembayaran online sedang dipersiapkan" **sebelum** transaksi dibuat (`services/checkout.ts:68-70`). Webhook publik menjawab 503 bila penyedia belum terkonfigurasi (`services/payment-webhook.ts:60-63`).
- Selama `PAYMENT_PROVIDER_NAME` kosong, `getPaymentProvider()` mengembalikan `NullPaymentProvider` (`lib/billing/get-payment-provider.ts:29-44`). Nilai env produksi di Netlify **tidak bisa dibaca dari repo** (C1).

## 2. Mesin pembayaran di main (CODE)

| Penyedia | Mode di kode | Bukti |
|---|---|---|
| Midtrans | Sandbox default; **live ada** bila `PAYMENT_LIVE_ENABLED=true` DAN `PAYMENT_PROVIDER_ENV=production` (string persis) dan kunci `Mid-server-`; kombinasi lain = tidak terkonfigurasi | `lib/billing/providers/midtrans-payment-provider.ts:53-62`; tes `tests/unit/lib/midtrans-live-flag.test.ts` |
| DOKU | **Sandbox saja**; flag live berisi apa pun mematikan adapter; host produksi tidak ada di kode | `doku-payment-provider.ts:36,150`; `docs/BILLING_DOKU_SANDBOX_ADAPTER.md:3-4` ("tidak ada merchant DOKU aktif, KYB tertahan") |
| Xendit | Sandbox saja (kunci `xnd_development_`) | `xendit-payment-provider.ts:48-51` |
| (kosong) | `NullPaymentProvider`, selalu tidak terkonfigurasi | `get-payment-provider.ts:43` |

Webhook `/api/webhooks/payment` sengaja publik (`proxy.ts:51`); keamanan = tanda tangan + verifikasi status server-ke-server (`docs/GO_LIVE_PAYMENTS.md` bagian 3, `services/payment-verification.ts`). Sweeper `/api/internal/payments/sweep` (`proxy.ts:55`) mati kecuali `PAYMENT_SWEEPER_ENABLED=true`.

## 3. Temuan

### A. Bug / risiko kode (tidak diperbaiki; PR ini dokumen saja)

| # | Temuan | Bukti | Kelas | Risiko | Rekomendasi |
|---|---|---|---|---|---|
| A1 | Guard "sandbox tidak boleh menyentuh DB produksi" hanya ada di DOKU. Midtrans dan Xendit sandbox **tidak memakainya**. Bila kunci sandbox Midtrans/Xendit dipasang pada deploy yang menunjuk DB produksi bersama (umkmpro-ai), pembayaran uji bisa mengaktifkan langganan sungguhan (risiko yang sama dijelaskan di `BILLING_DOKU_SANDBOX_ADAPTER.md:28-31`) | `git grep evaluateSandboxDbGuard` hanya di `doku-payment-provider.ts:5,157` | CODE | **P1 bersyarat** (aktif hanya jika env sandbox Midtrans/Xendit terpasang di produksi; saat env kosong tidak terpicu) | Jangan pasang kunci sandbox di produksi. Perbaikan kode (pakai guard yang sama) = perubahan jalur pembayaran, butuh persetujuan Founder |
| A2 | `docs/GO_LIVE_PAYMENTS.md` hanya untuk Midtrans. DOKU tidak punya mode live di kode, jadi "go-live DOKU" membutuhkan kode baru, bukan sekadar env | `doku-payment-provider.ts:22-25`, `GO_LIVE_PAYMENTS.md:1` | CODE+DOC | P2 | Putuskan penyedia (pertanyaan Q2) sebelum merencanakan go-live |
| A3 | Komentar usang: `.env.example:127-130` menyebut Midtrans "SANDBOX ONLY" padahal mode live ada (`.env.example:138-141`, `midtrans-payment-provider.ts:59`); `get-payment-provider.ts:35` menyebut "Midtrans stays as the fallback" padahal tidak ada fallback | baris tertera | CODE | P2 (menyesatkan operator, tidak mengubah perilaku) | Koreksi komentar di PR terpisah |

Tidak ditemukan bug terbukti kecil pada jalur OFF (fail-closed terbaca benar). Tidak ada perbaikan kode dibuat.

### B. Blocker perizinan/pendaftaran (BUKAN bug; keputusan hukum = ahli hukum)

| # | Hal | Bukti | Kelas | Catatan |
|---|---|---|---|---|
| B1 | PJP: BI menyatakan "Setiap pihak yang bertindak sebagai PJP harus memperoleh izin dari Bank Indonesia"; kegiatan PJP: informasi sumber dana, inisiasi pembayaran dan/atau akuisisi, penatausahaan sumber dana, remitansi (kategori izin 1/2/3). Penyedia teknologi/penunjang diklasifikasikan terpisah | [BI, PBI 23/6/PBI/2021](https://www.bi.go.id/id/publikasi/peraturan/Pages/pbi_230621.aspx), dibaca 2026-11-15 | OFFICIAL | Apakah LINOE sebagai **merchant** yang menerima biaya langganan lewat gateway berizin termasuk PJP: **UNKNOWN, tanyakan konsultan/BI**. Bacaan hati-hati (bukan keputusan): tidak, selama LINOE tidak menahan/meneruskan dana, saldo, atau wallet. Keputusan bisnis yang tercatat: iklan dibayar langsung ke Meta/TikTok (`LEGAL_PSE_CHECKLIST.md` bagian 5) |
| B2 | Kewajiban izin gateway pembayaran dan sanksi (teguran tertulis, rekomendasi penghentian usaha) berasal dari PBI 18/40/2016; artikel tidak membahas kewajiban merchant | [Hukumonline, 28 Feb 2020](https://www.hukumonline.com/klinik/a/sanksi-bagi-penyelenggara-ipayment-gateway-i-yang-tidak-berizin-lt5e4e9a682592a) | SECONDARY | Peraturan itu sudah digantikan PBI 23/6/2021 menurut halaman BI (B1); jangan dijadikan dasar |
| B3 | Apakah DOKU/Midtrans memegang izin PJP aktif: dokumen status BI yang terbuka (31 Maret 2022) hanya memuat jumlah institusi, bukan nama | [BI, status perizinan 31-03-2022](https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/perizinan/Documents/Informasi-Status-Perizinan-PJP-Penetapan-PIP-dan-Persetujuan-PJP-PIP-310322.pdf) | UNKNOWN | Minta bukti izin dari penyedia saat KYB, atau cek daftar BI terkini |
| B4 | PSE Lingkup Privat wajib daftar **sebelum** sistem dipakai pengguna (PP 71/2019 Pasal 6 ayat 1-2), lewat OSS. Bila LINOE menerima tenant, ini relevan **dengan atau tanpa** pembayaran | Dibaca sebelumnya di `docs/LEGAL_PSE_CHECKLIST.md` bagian 2 (JDIH Komdigi). Pembacaan ulang di sesi ini **gagal** (URL JDIH di luar daftar izin fetch) | OFFICIAL (dari dokumen repo), tidak diverifikasi ulang | Status TDPSE LINOE: **UNKNOWN**. Keputusan F1/F4 di checklist legal tetap berlaku (ditangani Agen soft-launch/legal) |
| B5 | OJK: tidak ditemukan dasar bahwa layanan langganan SaaS yang menerima pembayaran lewat gateway berizin berada di bawah OJK. Tidak diteliti lebih lanjut | tidak ada sumber | UNKNOWN | Tanyakan ke konsultan hanya jika LINOE kelak menyentuh dana pihak ketiga, pinjaman, atau investasi |
| B6 | KYB penyedia (DOKU tertahan, masalah kode pos 23775; Midtrans butuh KYB selesai) | `BILLING_DOKU_SANDBOX_ADAPTER.md:3`, `GO_LIVE_PAYMENTS.md:6` | DOC | Blocker pihak ketiga, bukan kode |

### C. Konfigurasi Founder (dari HP)

| # | Tindakan | Kapan |
|---|---|---|
| C1 | Netlify, scope Production: pastikan `PAYMENT_PROVIDER_NAME`, `PAYMENT_PROVIDER_API_KEY`, `PAYMENT_LIVE_ENABLED`, `PAYMENT_PROVIDER_ENV`, `PAYMENT_PROVIDER_CLIENT_ID`, `PAYMENT_PROVIDER_WEBHOOK_SECRET`, `PAYMENT_SANDBOX_DB_PROJECT_REFS`, `PAYMENT_SWEEPER_ENABLED` **kosong**. Jangan mengisi kunci sandbox di produksi (A1) | Sebelum undangan pertama |
| C2 | Jangan menyalakan sweeper atau mengubah Notification URL di dashboard penyedia selama soft launch | Selama soft launch |
| C3 | Setelah memutuskan penyedia: selesaikan KYB, lalu ikuti `docs/GO_LIVE_PAYMENTS.md` hanya dengan persetujuan eksplisit | Sebelum pembayaran riil |
| C4 | Sebelum pembayaran riil: konfirmasi status PJP/merchant secara tertulis ke konsultan (F5/F9 di `LEGAL_PSE_CHECKLIST.md`) | Sebelum pembayaran riil |

### D. UNKNOWN (jangan dianggap siap)

- Nilai env produksi saat ini (tidak terbaca dari repo; membaca Netlify di luar lingkup).
- Penyedia yang akan dipakai (DOKU, Midtrans, atau lain) dan status KYB terkini.
- Arti pasti "LPE" menurut Founder dan apakah ada pendaftaran selain PSE/PJP yang dimaksud.
- Status TDPSE/NIB-KBLI, status izin PJP penyedia (B3), kewajiban LINOE sebagai merchant (B1), peran OJK (B5).
- Apakah migrasi S1 (trial dikunci server) aktif di produksi (G3 di `SOFT_LAUNCH_10_TENANTS.md`, di luar dokumen ini).
- Tes: tes unit penyedia dan checkout ada (`tests/unit/lib/get-payment-provider.test.ts`, `midtrans-live-flag.test.ts`, `tests/unit/services/checkout.test.ts`), hasilnya baru valid setelah CI hijau. Tidak ada bukti SANDBOX E2E atau REAL E2E pembayaran di repo (kelas MOCK/UNIT saja).

## 4. Pertanyaan ke Founder (maksimal 3)

1. Apa yang dimaksud "LPE": izin/pendaftaran LINOE **sendiri** untuk menerima pembayaran, atau cukup memakai gateway berizin? (Menentukan apakah konsultan perlu menjawab B1 sebelum pembayaran riil.)
2. Penyedia pembayaran pilihan: DOKU (KYB tertahan, tanpa mode live di kode) atau Midtrans (mode live sudah ada di kode)?
3. Setuju soft launch 10 tenant tetap **tanpa pembayaran riil** dan Founder memastikan C1 (semua env pembayaran kosong di Netlify Production)?

## 5. Sumber

Resmi dibaca 2026-11-15: BI PBI 23/6/PBI/2021 (URL di B1). Sekunder: Hukumonline (B2). BI status 2022 (B3). Diambil dari dokumen repo, tidak dibuka ulang karena URL di luar daftar izin fetch: JDIH Komdigi PP 71/2019 dan sumber lain di `docs/LEGAL_PSE_CHECKLIST.md` bagian 8.
