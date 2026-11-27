-- Rollback untuk 20261128090000_prompter_retention_vault.sql. Idempoten (aman dijalankan dua kali).
-- TIDAK PERNAH membuang riwayat yang sudah diarsipkan:
--   * brankas KOSONG: trigger, fungsi, dan tabel dibuang (kembali ke keadaan sebelum 4r);
--   * brankas BERISI dan GUC tidak diset: transaksi dibatalkan utuh (tidak ada yang berubah);
--   * brankas BERISI dan GUC diset: tabel brankas di-RENAME menjadi prompter_retention_vault_arsip_<UTC yyyymmddhh24miss> (isi, indeks, dan penjaga hanya-tambah tetap),
--     trigger penyalin dan fungsi lain dibuang. Penjaga (fungsi append_only_guard) sengaja dipertahankan selama ada tabel arsip.
--       PGOPTIONS="-c linoe.rename_retention_vault=ARSIPKAN-VAULT-20261128090000"
-- Urutan anti-balapan: trigger penyalin dilepas dahulu (menunggu transaksi DELETE yang sedang berjalan selesai), brankas dikunci eksklusif, BARU dihitung.
-- Untuk melepas penyalinan tanpa menyentuh brankas pakai .down-soft.sql.
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

do $d$
declare
  v_rows   bigint := 0;
  v_rename boolean;
  v_suffix text := to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS');
begin
  v_rename := coalesce(current_setting('linoe.rename_retention_vault', true), '') = 'ARSIPKAN-VAULT-20261128090000';
  if to_regclass('public.prompter_retention_vault') is not null then
    lock table public.prompter_retention_vault in access exclusive mode;
    execute 'select count(*) from public.prompter_retention_vault' into v_rows;
    if v_rows > 0 and not v_rename then
      raise exception 'DIBATALKAN down 4r: brankas berisi % baris (bukti). Tidak dibuang. Untuk melepas penyalinan tanpa menyentuh brankas pakai down-soft; untuk melepas semuanya dengan menyimpan brankas sebagai tabel arsip set linoe.rename_retention_vault.', v_rows;
    end if;
    if v_rows > 0 then
      execute format('alter table public.prompter_retention_vault rename to %I', 'prompter_retention_vault_arsip_' || v_suffix);
      execute format('alter index if exists public.idx_prompter_retention_vault_tenant rename to %I', 'idx_prompter_retention_vault_arsip_tenant_' || v_suffix);
      execute format('alter index if exists public.idx_prompter_retention_vault_pk rename to %I', 'idx_prompter_retention_vault_arsip_pk_' || v_suffix);
      execute format('alter index if exists public.prompter_retention_vault_pkey rename to %I', 'prompter_retention_vault_arsip_pkey_' || v_suffix);
      execute format('alter sequence if exists public.prompter_retention_vault_id_seq rename to %I', 'prompter_retention_vault_arsip_id_seq_' || v_suffix);
    else
      drop table public.prompter_retention_vault;      -- kosong dan terkunci: tidak ada riwayat yang hilang
    end if;
  end if;
end $d$;

drop function if exists public.fn_prompter_retention_vault_status();
drop function if exists public.fn_prompter_retention_vault_capture();
drop function if exists public.fn_prompter_retention_block_truncate();

-- fungsi penjaga hanya dibuang bila tidak ada lagi trigger yang memakainya (tabel arsip hasil RENAME tetap terjaga)
do $g$
begin
  if not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                  where p.proname = 'fn_prompter_retention_vault_append_only_guard' and p.pronamespace = 'public'::regnamespace) then
    drop function if exists public.fn_prompter_retention_vault_append_only_guard();
  end if;
end $g$;

commit;
