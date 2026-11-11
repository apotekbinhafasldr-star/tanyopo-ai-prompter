# Rancangan jenis alert `UNVERIFIED` (P0-B2) - HANYA RANCANGAN

Status: **BUTUH PERSETUJUAN FOUNDER**. Tidak ada migrasi yang dibuat atau diterapkan oleh pekerjaan ini. Rujukan: runbook DOKU bagian 9 (PR #122), P0-B2.

## Masalah
Antrean alert B4 hanya mengenal `REVIEW`, `REFUND`, `CHARGEBACK`, `REVERSAL` (CHECK pada `prompter_payment_alerts.kind`, `PaymentAlertKind` di `types/database.ts`,
peta label di `lib/billing/payment-alerts.ts`). Transaksi DOKU yang terus UNKNOWN atau gagal diverifikasi hanya tampak sebagai hitungan (kartu kesehatan webhook,
P0-B1) dan tidak punya alert yang bisa ditandai, diselesaikan, atau diemail.

## Rancangan
1. Perluas CHECK `kind` dengan `'UNVERIFIED'`.
2. `fn_sync_payment_alerts` v3, langkah (d): per transaksi DOKU yang masih `PENDING`, bila ada >= 3 event `prompter_webhook_events` dengan `error` dalam himpunan
   {`VERIFIED_STATUS_UNKNOWN`, `UNKNOWN_STATUS:%`, `GATEWAY_VERIFICATION_FAILED%`} atau yang tertua > 1 jam, buat alert `UNVERIFIED` severity HIGH.
   Idempoten lewat `unique (transaction_id, kind)`; resolve otomatis saat transaksi `PAID` atau `EXPIRED`.
3. `fn_record_payment_alarm` tidak diubah.
4. Rollback mengembalikan CHECK dan badan fungsi; ditolak bila ada alert `UNVERIFIED` yang belum `RESOLVED`.

## File masa depan (belum dibuat)
`supabase/migrations/<ts>_prompter_p0_4_unverified_alert.sql`, `supabase/rollback/<ts>_..._down.sql`, `types/database.ts`, `lib/billing/payment-alerts.ts`
(peta `Record<PaymentAlertKind, ...>` memaksa kompilasi gagal bila terlewat), paket sandbox `supabase/sandbox/doku/`, tes SQL di CI.

## Acceptance
Terapkan dulu ke sandbox lewat runner; smoke dummy membuat tepat 1 alert per transaksi; sync dua kali tidak menggandakan; md5 badan fungsi sebelum/sesudah sesuai audit;
produksi (umkmpro-ai, dibagi dengan PUBLOE/UMKMpro) tidak disentuh sampai ada persetujuan terpisah.

## Sementara (tanpa migrasi)
Penanda `UNKNOWN_STATUS:<kode>` dan kartu "Kesehatan webhook DOKU" di `/ops/payments` menutup visibilitas; tombol "Verifikasi ulang" menutup transaksi yang menggantung.
