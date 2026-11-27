-- Rollback untuk 20261128090000_prompter_retention_vault.sql. Idempoten (aman dijalankan dua kali).
-- Trigger dan fungsi selalu dibuang. Tabel brankas dibuang HANYA bila kosong, atau bila GUC eksplisit diset di sesi yang sama:
--   PGOPTIONS="-c linoe.drop_retention_vault=DROP-VAULT-20261128090000"   (membuang BUKTI yang sudah diarsipkan; ekspor dahulu dan butuh persetujuan tertulis)
-- Bila brankas berisi dan GUC tidak diset: transaksi dibatalkan utuh (tidak ada yang dibuang). Untuk melepas penyalinan TANPA membuang brankas pakai .down-soft.sql.
-- Tidak menyentuh tenants, auth.users, user_profiles, tabel produk lain, atau baris tabel billing.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $d$
declare
  v_rows bigint := 0;
  v_force boolean;
begin
  v_force := coalesce(current_setting('linoe.drop_retention_vault', true), '') = 'DROP-VAULT-20261128090000';
  if to_regclass('public.prompter_retention_vault') is not null then
    execute 'select count(*) from public.prompter_retention_vault' into v_rows;
    if v_rows > 0 and not v_force then
      raise exception 'DIBATALKAN down 4r: brankas berisi % baris (bukti). Tidak dibuang. Untuk melepas penyalinan tanpa membuang brankas pakai down-soft; membuang brankas butuh persetujuan eksplisit.', v_rows;
    end if;
  end if;
end $d$;

drop trigger if exists trg_zz_retention_capture  on public.prompter_subscriptions;
drop trigger if exists trg_zz_retention_capture  on public.prompter_invoices;
drop trigger if exists trg_zz_retention_capture  on public.prompter_payment_transactions;
drop trigger if exists trg_retention_no_truncate on public.prompter_subscriptions;
drop trigger if exists trg_retention_no_truncate on public.prompter_invoices;
drop trigger if exists trg_retention_no_truncate on public.prompter_payment_transactions;
drop table if exists public.prompter_retention_vault;        -- trigger penjaga brankas ikut terbuang
drop function if exists public.fn_prompter_retention_vault_status();
drop function if exists public.fn_prompter_retention_vault_capture();
drop function if exists public.fn_prompter_retention_block_truncate();
drop function if exists public.fn_prompter_retention_vault_immutable();

commit;
