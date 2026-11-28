-- Rollback LUNAK untuk 20261128090000_prompter_retention_vault.sql. Idempoten.
-- Melepas penyalinan dan penolak TRUNCATE dari tiga tabel billing LINOE sehingga DELETE FROM tenants kembali seperti sebelum 4r,
-- TETAPI MENYIMPAN brankas beserta isinya (riwayat yang sudah diarsipkan tidak hilang), penjaga hanya-tambah brankas, dan fungsi status.
-- Setelah ini fn_prompter_retention_vault_status() menampilkan ok=false (penyalinan tidak aktif); jangan melanjutkan penghapusan data tenant.
-- Tidak menyentuh tenants, auth.users, user_profiles, tabel produk lain, atau baris tabel billing.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

drop trigger if exists trg_zz_retention_capture  on public.prompter_subscriptions;
drop trigger if exists trg_zz_retention_capture  on public.prompter_invoices;
drop trigger if exists trg_zz_retention_capture  on public.prompter_payment_transactions;
drop trigger if exists trg_retention_no_truncate on public.prompter_subscriptions;
drop trigger if exists trg_retention_no_truncate on public.prompter_invoices;
drop trigger if exists trg_retention_no_truncate on public.prompter_payment_transactions;
drop function if exists public.fn_prompter_retention_vault_capture();
drop function if exists public.fn_prompter_retention_block_truncate();

commit;
