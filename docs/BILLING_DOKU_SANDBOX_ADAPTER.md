# Adapter DOKU (SANDBOX SAJA) — status, asumsi, dan blocker

**Status:** kode adapter ada, tetapi **tidak ada merchant DOKU yang aktif** (KYB masih tertahan, masalah kode pos 23775).
Pembayaran live TIDAK didukung oleh kode ini. Midtrans tetap ada sebagai fallback dan tidak diubah perilakunya.
**Unit test hijau BUKAN bukti sandbox E2E lulus.** E2E sandbox belum pernah dijalankan; lihat daftar blocker di bawah.

## Cakupan PR ini (Tahap 1–3)
1. Kontrak webhook diperluas secara additif: `WebhookRequestContext` (headers + path), `verifyWebhookRequest?()` dan parameter
   opsional `parseWebhookEvent(rawBody, request?)`. Midtrans/Xendit tidak berubah. Provider yang mengimplementasikan
   `verifyWebhookRequest` TIDAK pernah jatuh ke jalur token lama: tanpa konteks request hasilnya 401.
2. `lib/billing/providers/doku-payment-provider.ts`: signature HMAC-SHA256, create checkout, Check Status, parsing notifikasi,
   pemetaan status, encoding invoice, timeout 5 dtk, batas respons 64 KB (dihitung saat streaming), `redirect: "error"`.
3. Tes: adapter, alur webhook (fake DB), checkout (duplikat), static guard, dan regresi adapter lama.
Tidak ada migrasi, tidak ada perubahan `proxy.ts`, sweeper, env production, atau billing live.

## Konfigurasi (fail-closed)
Adapter dianggap terkonfigurasi hanya jika SEMUA benar:
- `PAYMENT_PROVIDER_NAME=doku`
- `PAYMENT_PROVIDER_ENV=sandbox` (harus tertulis eksplisit; kunci DOKU tidak punya prefix yang bisa dicek, jadi mode tidak ditebak)
- `PAYMENT_LIVE_ENABLED` kosong (nilai apa pun, termasuk typo, mematikan DOKU)
- `PAYMENT_PROVIDER_CLIENT_ID` = Client ID sandbox (header `Client-Id`; bukan rahasia, tetap server-side)
- `PAYMENT_PROVIDER_API_KEY` = Secret Key sandbox (rahasia; tidak pernah di git/chat/`NEXT_PUBLIC_*`)
Hanya host `https://api-sandbox.doku.com` yang ada di kode. Host production sengaja tidak ditulis.
Menyalakan semua ini di Netlify adalah perubahan env production tersendiri yang butuh persetujuan; PR ini tidak melakukannya.

## Model kepercayaan
Signature webhook hanya membuktikan notifikasi dibuat dengan Secret Key kita. Status/nominal di body adalah KLAIM.
Aktivasi hanya dari Check Status server-ke-server (`getVerifiedPayment` → `verifyAndSettle` → `fn_apply_verified_payment`).
Jawaban Check Status yang tidak lengkap/ambigu **melempar error** (webhook 503 → retry aman) atau dipetakan ke status yang tidak
pernah mengaktifkan. Nominal beda/kedaluwarsa/transaksi sudah tertutup → REVIEW (B2, tidak berubah).

Pemetaan status (`mapDokuStatus`):
| DOKU | Hasil | Catatan |
|---|---|---|
| `SUCCESS` | PAID | hanya jika nominal > 0 dan referensi gateway ada; `order.status=ORDER_EXPIRED` → UNKNOWN |
| `PENDING`, `TIMEOUT`, `REDIRECT` | PENDING | |
| `FAILED` | PENDING | di Checkout, pelanggan bisa ganti metode; JANGAN menutup invoice |
| `EXPIRED` | EXPIRED | menutup invoice PENDING |
| `REFUNDED`, `PARTIAL_REFUNDED`, `VOIDED`, atau `transaction.type` ∈ {REFUND, FULL_REFUND, PARTIAL_REFUND, VOID} | REFUNDED | hanya alarm; langganan tidak dicabut |
| lainnya | UNKNOWN | tidak pernah PAID, tidak menutup invoice |

## Nomor invoice (≤ 30 karakter)
`order.invoice_number = "LN" + 25 digit base-36 huruf besar` dari UUID transaksi (27 karakter). Deterministik, unik (injektif),
reversible, hanya alfanumerik (aman untuk metode yang melarang simbol), dan dibatasi 30 karakter karena batas DOKU saat kartu kredit aktif.
`decodeDokuInvoiceNumber` hanya menerima bentuk kanonik; selain itu `null` (webhook → 400, tidak menyentuh apa pun).

## Metode pembayaran
`payment.payment_method_types` sengaja TIDAK dikirim: DOKU menampilkan metode yang diaktifkan merchant di Back Office
(mis. VA, QRIS, e-wallet, kartu — sesuai dukungan resmi DOKU). Aplikasi tidak mengklaim satu metode pun aktif. Set status yang
berbeda per metode (VA: PENDING/SUCCESS/EXPIRED/FAILED; minimarket/e-wallet: TIMEOUT; kartu: REFUNDED/VOIDED/PARTIAL_REFUNDED)
semuanya ditangani oleh pemetaan di atas.

## Asumsi API yang BELUM terverifikasi (wajib dibuktikan di sandbox)
Terverifikasi dari dokumentasi resmi: host sandbox, path `POST /checkout/v1/payment` dan `GET /orders/v1/status/{invoice}`,
header `Client-Id`/`Request-Id`/`Request-Timestamp`/`Signature`, komponen signature (Digest hanya untuk POST), format
`HMACSHA256=`, batas `invoice_number` 64/30, `payment_due_date` dalam menit, bidang notifikasi `order.invoice_number`,
`order.amount`, `transaction.status`, `transaction.original_request_id`.

| # | Asumsi | Jika salah |
|---|---|---|
| A1 | Pemisah komponen signature adalah karakter newline asli (dokumentasi menulis "`\n` escape") | semua request ditolak 401 |
| A2 | `Request-Target` webhook = path URL notifikasi kita (`/api/webhooks/payment`) apa adanya | semua webhook 401 |
| A3 | Respons create/status dibungkus `response` atau polos (keduanya ditoleransi) | create/status gagal tertutup |
| A4 | Check Status untuk invoice **Checkout** mengembalikan `order.amount` dan `transaction.status` | aktivasi mustahil (aman), perlu perbaikan adapter |
| A5 | `transaction.original_request_id` ada di Check Status dan layak jadi referensi pembayaran unik | PAID ditolak (503); perlu referensi lain |
| A6 | `order.currency` bila ada bernilai `IDR`; bila tidak ada dianggap IDR (API DOKU hanya IDR) | — |
| A7 | Check Status bisa dipanggil tepat setelah webhook; dokumentasi menyarankan ≥ 60 detik setelah bayar | webhook dijawab 503 sampai DOKU mengembalikan SUCCESS; bergantung retry DOKU atau sweeper |
| A8 | Notifikasi SUCCESS dikirim per pembayaran dengan `Request-Id` unik; kirim ulang bisa memakai Request-Id sama atau baru | keduanya aman (idempoten di `fn_apply_verified_payment`) |
| A9 | URL halaman bayar berada di domain `*.doku.com` | create checkout ditolak (fail-closed) |
| A10 | `Request-Timestamp` tidak dicek kesegarannya (kebijakan retry/resend DOKU tidak terdokumentasi) | replay tidak berbahaya karena aktivasi hanya dari Check Status |
| A11 | Kebijakan retry notifikasi DOKU, IP allowlist, dan payload notifikasi expired tidak diketahui | tidak dipakai kode |
| A12 | Metode yang butuh data `customer` (mis. e-wallet/PayLater tertentu) | checkout metode itu bisa ditolak DOKU; kita tidak mengirim PII |

## Blocker untuk sandbox E2E (belum ada yang selesai)
1. Akun sandbox DOKU + Client ID/Secret Key sandbox (Founder).
2. Env sandbox terpasang di lingkungan UJI yang TIDAK menunjuk DB production (Netlify Deploy Preview ke DB production dilarang).
3. Notification URL sandbox di Back Office diarahkan ke endpoint uji.
4. Bukti A1–A5 dari satu transaksi sandbox nyata (bayar, expired, kirim ulang, refund).
5. Keputusan sweeper (default MATI; perlu pengecualian `proxy.ts` dan secret → persetujuan terpisah) karena A7.
6. `fn_sync_payment_alerts` masih memfilter `source_system = 'midtrans'`: alarm DOKU tercatat lewat jalur verifikasi langsung,
   tetapi jaring pengaman sinkronisasi belum mencakup DOKU (butuh migrasi; persetujuan terpisah).
7. Runbook refund & go-live khusus DOKU (belum ditulis; refund diasumsikan manual lewat Back Office).

## Syarat sebelum pembayaran production (di luar PR ini)
KYB DOKU disetujui; kode live ditambahkan dan ditinjau terpisah (saat ini TIDAK ada); semua asumsi di atas terbukti di sandbox;
persetujuan tertulis Founder; `PAYMENT_LIVE_ENABLED` tetap kosong sampai saat itu.

## Rollback
Kosongkan `PAYMENT_PROVIDER_NAME` (atau set `midtrans`) dan deploy ulang → adapter DOKU tidak terpilih; tidak ada data/skema yang perlu dikembalikan.
