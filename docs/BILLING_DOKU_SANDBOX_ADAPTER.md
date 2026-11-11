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
- **Guard database (P1-C)**: `PAYMENT_SANDBOX_DB_PROJECT_REFS` = daftar izin (dipisah koma) berisi *project ref* Supabase (20 karakter)
  yang BOLEH menjalankan pembayaran sandbox; DAN project yang dituju server bukan project production.
Hanya host `https://api-sandbox.doku.com` yang ada di kode. Host production sengaja tidak ditulis.
Menyalakan semua ini di Netlify adalah perubahan env production tersendiri yang butuh persetujuan; PR ini tidak melakukannya.

### Guard "sandbox tidak boleh menyentuh DB production" (P1-C)
Pembayaran sandbox memakai uang uji. Jika adapter hidup pada deploy yang terhubung ke DB production bersama (umkmpro-ai, dipakai
PUBLOE/UMKMpro), pembayaran uji bisa mengaktifkan langganan sungguhan. `NODE_ENV`/nama deploy tidak membuktikan apa pun, jadi
`lib/billing/providers/doku-sandbox-db-guard.ts` (fungsi murni, tanpa I/O, tanpa log) memeriksa identitas database itu sendiri,
dan berjalan di `resolveDokuConfig()` sehingga mencakup **create checkout, verifikasi pembayaran, dan autentikasi webhook**:
1. Project ref diturunkan di server dari `NEXT_PUBLIC_SUPABASE_URL` — URL yang sama persis dengan yang dipakai `createAdminClient()`
   untuk menulis. Hanya bentuk `https://<20-char-ref>.supabase.co` yang diterima. Domain kustom, localhost, placeholder, http,
   port, atau kredensial di URL = identitas **tak terbukti** → adapter MATI.
2. Ref tidak boleh ada di daftar tolak (hard-coded: `wjjyqovhmwenbcvbnkgx` = umkmpro-ai production). Daftar izin yang memuat
   ref production = kesalahan konfigurasi → semuanya ditolak.
3. Ref harus tercantum eksplisit di `PAYMENT_SANDBOX_DB_PROJECT_REFS` (kosong/rusak/tidak cocok → MATI).
4. Bila `SUPABASE_SECRET_KEY` berupa JWT lama, klaim `ref`-nya harus sama dengan URL (kunci production di URL sandbox → MATI).
   Kunci baru `sb_secret_…` tidak membawa ref; pemeriksaan ini dilewati dan tidak pernah melonggarkan aturan lain.
Efek: tanpa env baru ini (kondisi production sekarang) adapter tetap MATI. **Batas yang jujur:** guard ini membuktikan *project mana*
yang dituju server, bukan bahwa isi database adalah salinan buangan. Atestasi sisi-database (baris/fungsi penanda) lebih kuat tetapi
butuh migrasi → **BLOCKED**, butuh keputusan Founder (lihat blocker B-DB).

## Model kepercayaan
Signature webhook hanya membuktikan notifikasi dibuat dengan Secret Key kita. Status/nominal di body adalah KLAIM.
Aktivasi hanya dari Check Status server-ke-server (`getVerifiedPayment` → `verifyAndSettle` → `fn_apply_verified_payment`).
Jawaban Check Status yang tidak lengkap/ambigu **melempar error** (webhook 503 → retry aman) atau dipetakan ke status yang tidak
pernah mengaktifkan. Nominal beda/kedaluwarsa/transaksi sudah tertutup → REVIEW (B2, tidak berubah).

Pemetaan status (`mapDokuStatus`; satu-satunya tempat kata status DOKU ditafsirkan):
| DOKU | Hasil | Catatan |
|---|---|---|
| `SUCCESS` **dan** semua syarat berikut: tanpa objek `refund`, bentuk jawaban wajar, `order.status` (string atau array) tidak memuat `ORDER_EXPIRED`, `transaction.type` kosong/`SALE`/`CAPTURE`, blok `card_payment` (jika ada) bertipe `SALE`/`CAPTURE` dan `transaction_status=SUCCESS`, nominal > 0, referensi gateway ada, **`order.currency` = `"IDR"` persis** | PAID | Selain itu SUCCESS **tidak pernah** PAID |
| `SUCCESS` + tipe `AUTHORIZE`/`MOTO`/`RECURRING`/`INSTALLMENT`/tipe tak dikenal, atau `ORDER_EXPIRED`, atau field berbentuk aneh | UNKNOWN | `AUTHORIZE` = dana ditahan, belum ditangkap. Tipe lain belum terbukti sebagai settlement final → tidak aktif sampai ada bukti sandbox |
| `SUCCESS` + objek `refund` (nilai apa pun, termasuk `{}`) | REFUNDED | alarm saja; langganan tidak berubah |
| `PENDING`, `TIMEOUT`, `REDIRECT` | PENDING | |
| `FAILED` | PENDING | di Checkout, pelanggan bisa ganti metode; JANGAN menutup invoice |
| `EXPIRED` | EXPIRED | menutup invoice PENDING |
| `REFUNDED`, `PARTIAL_REFUNDED`, `VOIDED`, atau `transaction.type` ∈ {REFUND, FULL_REFUND, PARTIAL_REFUND, VOID} | REFUNDED | hanya alarm; langganan tidak dicabut |
| lainnya | UNKNOWN | tidak pernah PAID, tidak menutup invoice |

**Mata uang (P1-B).** Checkout mengirim `order.currency: "IDR"` secara eksplisit (DOKU Checkout mendukung `order.currency`, kode ISO 4217,
default IDR). Pada Check Status: nilai yang ada harus persis `"IDR"` (selain itu error); untuk jawaban **PAID** nilainya wajib ada.
Jawaban PAID tanpa `currency` melempar error → webhook 503 → retry; **tidak ada aktivasi dan tidak ada asumsi IDR**.
Dokumentasi DOKU menampilkan `currency` hanya pada contoh kartu, bukan VA/e-wallet. Artinya **pembayaran VA bisa terus 503 jika DOKU
memang tidak mengembalikan `currency`**. Ini diketahui dan didokumentasikan sebagai blocker B-CUR, bukan disembunyikan: tandanya di
`prompter_webhook_events` adalah `status=FAILED, error=GATEWAY_VERIFICATION_FAILED` berulang pada notifikasi SUCCESS. Cara membuka blokir:
bukti respons Check Status VA nyata dari sandbox, lalu keputusan terpisah (mis. menerima `currency` kosong hanya untuk channel VA
yang terbukti) — tidak diubah tanpa bukti tersebut.

**Replay (P2).** Event DOKU memakai `Request-Id` per-pengiriman sebagai ID event. Pengiriman ulang notifikasi yang sudah **PROCESSED**
(aktivasi selesai) atau yang alarm refund/chargeback-nya sudah tercatat dijawab `200 Already processed.` **tanpa** memanggil Check Status.
Pengiriman yang belum final (RECEIVED, PENDING, gateway belum bisa diverifikasi, UNKNOWN) tetap diproses ulang → retry aman. Short-circuit
ini hanya untuk provider yang menandatangani header (DOKU); Midtrans/Xendit berperilaku persis seperti sebelumnya. Konsekuensi: replay
notifikasi *lama* tidak lagi menemukan refund baru — refund baru harus datang sebagai notifikasi/Request-Id sendiri (A11 belum terbukti) atau
lewat halaman kembali/sweeper (sweeper tetap MATI).
`Request-Timestamp` tetap tidak dicek kesegarannya (A10: kebijakan retry DOKU tidak terdokumentasi); dengan short-circuit di atas,
replay tidak lagi menimbulkan panggilan Check Status berulang. Jendela timestamp ditambahkan setelah perilaku resend DOKU terukur di sandbox.

**UNKNOWN berulang (P2) dan P0-A.** Jawaban yang tidak bisa diklasifikasi dengan aman (tipe/status baru, `ORDER_EXPIRED`, bentuk field aneh) tidak
mengaktifkan dan tidak menutup invoice. Tiga penanda pada `prompter_webhook_events.error` (tanpa migrasi; CHECK `status` hanya mengizinkan
RECEIVED/PROCESSED/FAILED/IGNORED, jadi `status` tidak ditambah):
- Notifikasi mengklaim PAID, gateway UNKNOWN: `status=FAILED`, `error=VERIFIED_STATUS_UNKNOWN`, webhook 503 (DOKU mencoba ulang).
- Notifikasi **tidak** mengklaim PAID (mis. kata status baru), gateway UNKNOWN: `status=IGNORED`, `error=UNKNOWN_STATUS:<kata status gateway>`
  (hanya `[A-Za-z0-9_/+.-]`, maks. 60 karakter, tanpa payload), webhook 200. Sebelumnya baris ini `IGNORED` tanpa penanda sehingga tak terlihat.
- Gateway masih PENDING: `FAILED` + `VERIFIED_STATUS_NOT_PAID`.
Query pantau **tidak boleh menyaring kolom `status`**; saring pada `error`:
`source_system='doku' and (error='VERIFIED_STATUS_UNKNOWN' or error like 'UNKNOWN_STATUS:%' or error like 'GATEWAY_VERIFICATION_FAILED%' or error='VERIFIED_STATUS_NOT_PAID')`.
Hanya Midtrans yang tidak berubah (cabang baru khusus provider `doku`). Kartu "Kesehatan webhook DOKU" di `/ops/payments` menghitung 24 jam terakhir dari
penanda ini (hanya hitungan, tanpa payload). Alarm antrean khusus untuk UNKNOWN **BLOCKED** (butuh migrasi): rancangan di
`docs/DOKU_UNKNOWN_ALERT_DESIGN.md`.

**Verifikasi ulang operator (P0-C).** Di `/ops/payments`, operator (allowlist `prompter_payment_operators`) dapat menekan "Verifikasi ulang" untuk transaksi DOKU
`PENDING` lebih dari 10 menit. Aksi hanya menerima id transaksi dan memanggil `verifyAndSettle` (Check Status = satu-satunya sumber aktivasi; idempoten di
`fn_apply_verified_payment`); batas 6 kali per menit per operator; dua baris audit (`payment.operator_recheck_requested` dan `..._result`). Konfigurasi DOKU
sandbox yang fail-closed tetap berlaku (provider tidak terkonfigurasi = tidak ada panggilan).

## Nomor invoice (≤ 30 karakter)
`order.invoice_number = "LN" + 25 digit base-36 huruf besar` dari UUID transaksi (27 karakter). Deterministik, unik (injektif),
reversible, hanya alfanumerik (aman untuk metode yang melarang simbol), dan dibatasi 30 karakter karena batas DOKU saat kartu kredit aktif.
`decodeDokuInvoiceNumber` hanya menerima bentuk kanonik; selain itu `null` (webhook → 400, tidak menyentuh apa pun).

## Metode pembayaran
`payment.payment_method_types` sengaja TIDAK dikirim: DOKU menampilkan metode yang diaktifkan merchant di Back Office
(mis. VA, QRIS, e-wallet, kartu — sesuai dukungan resmi DOKU). Aplikasi tidak mengklaim satu metode pun aktif. Set status yang
berbeda per metode (VA: PENDING/SUCCESS/EXPIRED/FAILED; minimarket/e-wallet: TIMEOUT; kartu: REFUNDED/VOIDED/PARTIAL_REFUNDED)
semuanya ditangani oleh pemetaan di atas.

## Asumsi API vs dokumentasi resmi DOKU (hasil review keamanan)
Status: VERIFIED = tertulis di dokumentasi resmi; PARTIAL = sebagian; UNVERIFIED = dokumentasi diam; CONTRADICTED = dokumentasi berbeda.
Terverifikasi: host sandbox, path `POST /checkout/v1/payment` dan `GET /orders/v1/status/{invoice}`, header
`Client-Id`/`Request-Id`/`Request-Timestamp`/`Signature`, komponen signature (Digest hanya POST), `HMACSHA256=`, batas `invoice_number`
64/30, `order.amount` bilangan bulat ≤12 digit, `payment_due_date` menit, `order.currency` di Checkout (ISO 4217, default IDR).

| # | Asumsi | Status | Catatan / jika salah |
|---|---|---|---|
| A1 | Pemisah komponen signature = newline asli, tanpa newline akhir | VERIFIED | dokumentasi: tiap komponen satu baris |
| A2 | `Request-Target` webhook = path URL notifikasi kita apa adanya | PARTIAL | path benar; query string tidak disebut. Kode menolak path ber-`?`/`#` (fail-closed) |
| A3 | Respons dibungkus `response` atau polos | PARTIAL | create checkout memakai `response`; Check Status tanpa pembungkus. Dua bentuk ditoleransi |
| A4 | Check Status untuk invoice Checkout memberi `order.amount` dan `transaction.status` | VERIFIED | syarat: status level-order untuk Checkout hanya untuk merchant terdaftar sejak Des 2024; merchant lama harus minta aktivasi. Tipe `amount` tidak konsisten (number/string), ditangani |
| A5 | `transaction.original_request_id` layak jadi referensi pembayaran unik | PARTIAL | ada; artinya "Request-Id saat pembayaran diinisiasi". Unik per pembayaran belum terbukti; muncul juga saat PENDING (dipakai hanya setelah SUCCESS) |
| A6 | ~~API DOKU hanya IDR; `currency` kosong dianggap IDR~~ **DIKOREKSI** | **CONTRADICTED** | Checkout mendukung `order.currency` (default IDR). Kode kini: kirim `IDR` eksplisit, `currency` wajib ada dan `"IDR"` untuk PAID, tanpa default. Contoh Check Status VA/e-wallet tidak memuat `currency` → blocker B-CUR |
| A7 | Check Status dipanggil ≥ 60 dtk setelah bayar | VERIFIED (panduan) | sebelum itu bisa PENDING → webhook 503 → retry |
| A8 | Perilaku `Request-Id` saat kirim ulang | UNVERIFIED | dokumentasi hanya menyebut duplikat mungkin terjadi; keduanya aman (idempoten) |
| A9 | URL halaman bayar berada di `*.doku.com` | UNVERIFIED | domain tidak disebut; jika berbeda checkout ditolak (aman, tapi memblokir E2E) |
| A10 | `Request-Timestamp` tidak dicek kesegarannya | UNVERIFIED | dokumentasi diam; lihat bagian Replay |
| A11 | Kebijakan retry notifikasi, IP allowlist, notifikasi refund | UNVERIFIED | dokumentasi diam; tidak dipakai kode |
| A12 | Metode yang butuh data `customer` | PARTIAL | `customer` tidak wajib; sebagian field bersyarat per metode |
| A13 | Tipe `SALE`/`CAPTURE` adalah settlement final; tipe lain tidak | PARTIAL | dokumentasi menyebut tipe kartu SALE, INSTALLMENT, MOTO, AUTHORIZE, CAPTURE, RECURRING, REFUND. Hanya SALE/CAPTURE dibuka; sisanya UNKNOWN sampai terbukti. Tipe DANA tidak terdokumentasi lengkap |
| A14 | `order.status` bertipe array atau string | PARTIAL | tabel DOKU menulis array, contoh string. Keduanya diterima; bentuk lain = UNKNOWN |

## Blocker untuk sandbox E2E (belum ada yang selesai)
1. Akun sandbox DOKU + Client ID/Secret Key sandbox (Founder).
2. **Project Supabase terpisah (non-production)** untuk uji, mis. project gratis baru, dengan ref-nya diisi di `PAYMENT_SANDBOX_DB_PROJECT_REFS`.
   Tanpa itu adapter sengaja MATI. Deploy Preview yang menunjuk DB production dilarang dan kini juga ditolak oleh kode.
3. Notification URL sandbox di Back Office diarahkan ke endpoint uji (path persis, tanpa query).
4. Bukti dari transaksi sandbox nyata: A1, A2, A4, A5, A9, A13 (bayar, expired, kirim ulang, refund); VA, QRIS, e-wallet, kartu masing-masing.
5. Keputusan sweeper (default MATI; perlu pengecualian `proxy.ts` dan secret → persetujuan terpisah) karena A7/A11.
6. Runbook refund & go-live khusus DOKU (belum ditulis; refund diasumsikan manual lewat Back Office).
7. **B-CUR** — apakah Check Status VA/e-wallet mengembalikan `order.currency`. Jika tidak, pembayaran channel itu tetap 503 (aman) sampai ada bukti dan keputusan terpisah.
8. **B-DB** (BLOCKED, butuh migrasi + persetujuan): atestasi sisi-database bahwa DB adalah lingkungan uji (mis. baris penanda yang
   diperiksa server). Guard kode di atas membuktikan project yang dituju, bukan isinya.
9. **B-ALERT** (SEBAGIAN: migrasi P0-3 disiapkan, BELUM diterapkan ke database mana pun): migrasi
   `20261111130000_prompter_p0_3_doku_alert_coverage.sql` memperluas `fn_sync_payment_alerts` ke `source_system in ('midtrans','doku')`, sehingga event
   `ALARM_REFUND/CHARGEBACK/REVERSAL` dari DOKU ikut menjadi alert (idempoten, provider transaksi harus sama dengan provider event). Masih terbuka:
   tidak ada jenis alarm untuk UNKNOWN/unverifiable berulang (`VERIFIED_STATUS_UNKNOWN` hanya tercatat di `prompter_webhook_events`). Menerapkan P0-3 ke
   database apa pun butuh persetujuan terpisah (paket produksi tidak dibuat di PR ini).
10. Rate limit per-IP/endpoint untuk webhook publik butuh infrastruktur (edge/WAF) — belum ada; short-circuit replay hanya menutup
    pengiriman ulang yang sudah final.

## Syarat sebelum pembayaran production (di luar PR ini)
KYB DOKU disetujui; kode live ditambahkan dan ditinjau terpisah (saat ini TIDAK ada); semua asumsi di atas terbukti di sandbox;
persetujuan tertulis Founder; `PAYMENT_LIVE_ENABLED` tetap kosong sampai saat itu.

## Rollback
Kosongkan `PAYMENT_PROVIDER_NAME` (atau set `midtrans`) dan deploy ulang → adapter DOKU tidak terpilih; tidak ada data/skema yang perlu dikembalikan.
