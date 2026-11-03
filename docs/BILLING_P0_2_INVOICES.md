# P0-2 — Invoice / kwitansi untuk setiap pembayaran terverifikasi

Status: **diimplementasi di cabang lokal, BELUM diterapkan ke database mana pun, BELUM di-PR.** Pembayaran live, cron baru, dan Budget Gate tetap HOLD.

## Masalah
`fn_apply_verified_payment` (B2 v2) mengaktifkan paket tetapi tidak menulis `prompter_invoices`, dan tidak ada kode lain yang menulisnya (`recordInvoiceFromProvider` tidak punya pemanggil). Pelanggan yang sudah membayar melihat daftar tagihan kosong dan tidak punya bukti bayar.

## Perubahan (aditif, satu migrasi)
`supabase/migrations/20261103170000_prompter_p0_2_payment_invoices.sql`

| # | Perubahan | Alasan |
|---|---|---|
| 1 | Kolom `prompter_invoices.transaction_id` (FK nullable, tanpa cascade) + indeks **unik parsial** | Satu transaksi = satu invoice, tahan balapan. Tanpa cascade agar penghapusan tenant tetap berjalan |
| 2 | `fn_apply_verified_payment` v3 = B2 v2 + satu `INSERT` invoice | Invoice dan aktivasi dalam satu transaksi (atomik) |
| 3 | `REVOKE INSERT/UPDATE/DELETE/TRUNCATE` pada `prompter_invoices` dari `anon`/`authenticated` | Lapis pertahanan tambahan. SELECT dan RLS tenant tidak berubah |
| 4 | Penjaga pra-terap | Migrasi **berhenti** bila badan fungsi bukan B2 v2 yang dikenal (hash md5 dinormalisasi) |

Tidak ada: tabel baru, backfill, perubahan migrasi lama, nomor invoice (keputusan Founder D1: ditunda; invoice dikenali dari ID internalnya), klaim pajak.

## Aturan yang dijamin
* Invoice berstatus `PAID` hanya lahir di jalur yang sudah mensyaratkan PAID terverifikasi gateway + nominal/mata uang sama. Jalur REVIEW, ALREADY_PROCESSED, dan TRANSACTION_NOT_FOUND **tidak** membuat invoice.
* `tenant_id`, `amount`, `currency` diambil dari baris transaksi, bukan dari masukan.
* `period_end` dibaca dari `UPDATE ... RETURNING`, yaitu **setelah** trigger carryover trial berjalan. Karena itu selalu sama dengan akhir periode langganan (termasuk sisa trial maksimal 14 hari). `period_start` = waktu aktivasi, atau akhir periode lama bila perpanjangan bertumpuk.
* `ON CONFLICT (transaction_id) DO NOTHING`. Kegagalan lain (mis. bentrok `(provider, external_invoice_id)`) membatalkan seluruh panggilan: tanda PAID, aktivasi, dan audit ikut rollback, gateway mencoba ulang.
* `external_invoice_id` = referensi pembayaran gateway, atau ID transaksi bila tidak ada.
* Baris audit `payment.succeeded` kini memuat `invoice_id` (kunci lama tetap).

## Pengujian
`bash supabase/tests/p0-2-invoices/run-local.sh` (PostgreSQL; CI memakai 17). Rantai: B10 → #74 → B1 → carryover → B2 → tabel invoice asli + grant default Supabase → P0-2.
* Sukses, periode = akhir akhir-langganan (carryover 13 hari, batas 14 hari, trial habis), perpanjangan bertumpuk, ACTIVE kedaluwarsa.
* Webhook duplikat berurutan, 10 paralel, 40 paralel lintas 8 tenant, 6 invoice berbeda dibayar bersamaan, 6 PENDING legacy.
* Nominal/mata uang salah, bayar telat setelah kedaluwarsa + resolusi bukti gateway, konflik paket: tidak ada invoice.
* Kegagalan parsial: bentrok kunci lain, kegagalan saat insert invoice, kegagalan setelah insert (audit), UPDATE 0 baris.
* Isolasi tenant, penguncian tulis klien, penghapusan tenant tetap cascade.
* Penjaga menolak fungsi yang menyimpang / tanpa B2, toleran terhadap beda spasi/CRLF.
* Regresi: seluruh skenario B2 lulus di atas P0-2; B4 dapat diterapkan sebelum maupun sesudah P0-2.
* Rollback fail-closed + mengembalikan badan B2 persis.
* Vitest statis: `tests/unit/migrations/p0-2-payment-invoices.test.ts` (membuktikan v3 = B2 v2 + hanya tambahan invoice).

## Urutan penerapan production (setelah persetujuan, dijalankan manual oleh Founder)
Pola paket A–E seperti B4.2: pra-periksa read-only (jumlah transaksi PAID tanpa invoice, hash badan fungsi, ledger terakhir), terapkan migrasi dalam satu transaksi, verifikasi read-only, catat ledger. **Tidak** menjalankan SQL production dari sesi AI.

## Risiko tersisa
* Bila hash badan fungsi di production berbeda dari B2 v2, penjaga menghentikan migrasi (aman); perlu dibandingkan dulu.
* Transaksi PAID yang sudah ada sebelum P0-2 (bila ada) tidak mendapat invoice otomatis; periode historis tidak boleh dikarang. Pra-periksa menghitungnya.
* Tampilan kwitansi yang dapat diunduh (PDF) belum ada; daftar tagihan sudah menampilkan invoice yang baru.
