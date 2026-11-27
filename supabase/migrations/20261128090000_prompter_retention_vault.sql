-- 4r (Opsi A): brankas arsip minimal untuk bukti billing LINOE, supaya DELETE FROM tenants (cascade) tidak menghapus riwayat transaksi tanpa jejak.
-- DRAFT: belum diterapkan ke database mana pun (bukan Supabase, bukan produksi). Flag aplikasi tidak terlibat (tidak ada kode aplikasi).
--
-- Yang dilakukan:
--   1. Tabel public.prompter_retention_vault TANPA foreign key (tidak ikut terhapus bersama tenants / auth.users). RLS aktif tanpa policy; semua hak klien dicabut.
--   2. Trigger BEFORE DELETE (per baris) pada TIGA tabel billing LINOE saja: prompter_subscriptions, prompter_invoices, prompter_payment_transactions.
--      Fungsi penyalin menyalin hanya kolom ALLOWLIST (bukan to_jsonb(old) utuh) ke brankas dalam transaksi DELETE yang sama.
--   3. FAIL-CLOSED: bila penyalinan gagal, seluruh pernyataan DELETE (termasuk DELETE FROM tenants yang men-cascade) dibatalkan dengan galat LR001,
--      tanpa isi baris di pesan (hindari data pribadi di log).
--   4. Penolak TRUNCATE pada tiga tabel billing (LR003) dan penjaga hanya-tambah pada brankas (LR004).
--   5. Trigger penyalin dan penolak ENABLE ALWAYS (tetap menyala di session_replication_role = replica).
--   6. Fungsi status baca-saja untuk preflight dan pemeriksaan operator.
--
-- BATAS JUJUR (jangan ditulis sebagai klaim "immutable"):
--   - Hanya-tambah OLEH TRIGGER database. Pemilik tabel / superuser tetap dapat DISABLE/DROP TRIGGER, DROP TABLE, atau mengubah baris. Cadangan/PITR tidak dicakup.
--   - Tidak ada durasi retensi yang ditetapkan di sini: retain_until dibiarkan NULL (belum ditetapkan) dan TIDAK ADA fungsi/penjadwal penghapusan otomatis.
--     Durasi dan dasar hukum penyimpanan menunggu keputusan konsultan hukum dan Founder.
--   - Tidak mengubah tenants, auth.users, user_profiles, tabel produk lain, kolom/RLS/GRANT tabel billing, maupun badan fungsi billing.
--     Satu-satunya perubahan pada objek yang sudah ada: trigger baru (BEFORE DELETE / BEFORE TRUNCATE) pada tiga tabel billing LINOE.
--
-- Rollback: supabase/rollback/20261128090000_prompter_retention_vault.down-soft.sql (lepas penyalinan, SIMPAN brankas),
--           20261128090000_prompter_retention_vault.down.sql (menolak bila brankas berisi), dan down paksa (GUC linoe.drop_retention_vault) - lihat docs/RETENTION_VAULT.md.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

-- 0. Prasyarat fail-closed (semua atau tidak sama sekali; transaksi dibatalkan utuh bila gagal)
do $pre$
declare
  t text;
begin
  foreach t in array array['prompter_subscriptions', 'prompter_invoices', 'prompter_payment_transactions'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'DIBATALKAN 4r: tabel % tidak ada', t;
    end if;
  end loop;
  if to_regclass('public.tenants') is null then
    raise exception 'DIBATALKAN 4r: public.tenants tidak ada';
  end if;
  -- fungsi penyalin berjalan sebagai pemilik migrasi dan MEMBACA tenants saat runtime (hanya untuk label alasan arsip)
  if not has_table_privilege(current_user, 'public.tenants', 'SELECT') then
    raise exception 'DIBATALKAN 4r: pemilik migrasi tidak punya SELECT pada public.tenants';
  end if;
end $pre$;

-- 1. Brankas (tanpa FK ke tenants/auth.users, sengaja)
create table if not exists public.prompter_retention_vault (
  id             bigint generated always as identity primary key,
  source_table   text        not null check (source_table in
                   ('prompter_subscriptions', 'prompter_invoices', 'prompter_payment_transactions')),
  source_pk      text        not null,
  tenant_id      uuid        not null,
  row_data       jsonb       not null check (jsonb_typeof(row_data) = 'object'),
  archive_reason text        not null check (archive_reason in ('TENANT_CASCADE', 'ROW_DELETE', 'UNDETERMINED')),
  allowlist_ver  smallint    not null default 1,
  deleted_by     text        not null default session_user,
  capture_txid   bigint      not null default txid_current(),
  archived_at    timestamptz not null default clock_timestamp(),
  retain_until   timestamptz null
);
create index if not exists idx_prompter_retention_vault_tenant on public.prompter_retention_vault (tenant_id, source_table);
create index if not exists idx_prompter_retention_vault_pk on public.prompter_retention_vault (source_table, source_pk);
alter table public.prompter_retention_vault enable row level security;   -- tanpa policy = tertutup untuk klien
revoke all on public.prompter_retention_vault from public, anon, authenticated, service_role;
do $seq$
declare
  v_seq text := pg_get_serial_sequence('public.prompter_retention_vault', 'id');
begin
  if v_seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', v_seq);
  end if;
end $seq$;
comment on table public.prompter_retention_vault is
  '4r: salinan kolom-allowlist baris billing LINOE yang akan dihapus. Hanya-tambah oleh trigger (dapat dilewati pemilik/superuser; bukan immutable). Tanpa FK. retain_until NULL = belum ditetapkan (keputusan konsultan hukum); tidak ada penghapusan otomatis.';

-- 2. Penyalin (BEFORE DELETE, per baris). Gagal = seluruh DELETE (termasuk DELETE tenants) batal.
create or replace function public.fn_prompter_retention_vault_capture()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_row    jsonb := to_jsonb(old);
  v_keys   text[];
  v_data   jsonb;
  v_pk     text;
  v_reason text := 'ROW_DELETE';
  v_gone   boolean;
  v_see    boolean;
begin
  v_keys := case tg_table_name
    when 'prompter_subscriptions' then array['tenant_id', 'plan', 'status', 'billing_provider',
         'provider_subscription_id', 'cancel_at_period_end', 'current_period_start',
         'current_period_end', 'created_at', 'updated_at']
    when 'prompter_invoices' then array['id', 'tenant_id', 'transaction_id', 'provider',
         'external_invoice_id', 'status', 'amount', 'currency', 'period_start', 'period_end',
         'issued_at', 'paid_at', 'created_at', 'updated_at']
    when 'prompter_payment_transactions' then array['id', 'tenant_id', 'provider', 'provider_payment_id',
         'provider_event_id', 'plan', 'amount', 'currency', 'status', 'created_at', 'updated_at', 'paid_at']
  end;
  if v_keys is null then
    raise exception 'LR002 tabel tidak dikenal %', tg_table_name using errcode = 'LR002';
  end if;

  -- proyeksi allowlist; kolom yang belum ada (mis. transaction_id sebelum p0-2) tidak muncul, tanpa galat
  select coalesce(jsonb_object_agg(k, v_row -> k), '{}'::jsonb)
    into v_data
    from unnest(v_keys) as k
   where v_row ? k;

  v_pk := case tg_table_name when 'prompter_subscriptions' then old.tenant_id::text
                             else v_row ->> 'id' end;

  -- alasan = metadata saja; tidak boleh menggagalkan penyalinan karena hak baca, RLS, atau tabel hilang.
  -- Label hanya ditentukan bila peran penyalin pasti melihat SELURUH baris tenants (superuser, BYPASSRLS, pemilik tenants tanpa FORCE RLS, atau RLS tenants mati);
  -- selain itu RLS tenants akan menyembunyikan baris dan label akan menyesatkan, jadi dicatat UNDETERMINED.
  v_see := coalesce((select r.rolsuper or r.rolbypassrls from pg_catalog.pg_roles r where r.rolname = current_user), false)
        or coalesce((select (not c.relrowsecurity) or (pg_has_role(current_user, c.relowner, 'USAGE') and not c.relforcerowsecurity)
                       from pg_catalog.pg_class c where c.oid = to_regclass('public.tenants')), false);
  if not v_see then
    v_reason := 'UNDETERMINED';
  else
    begin
      select not exists (select 1 from public.tenants t where t.id = old.tenant_id) into v_gone;
      if v_gone then v_reason := 'TENANT_CASCADE'; end if;
    exception when insufficient_privilege or undefined_table then
      v_reason := 'UNDETERMINED';
    end;
  end if;

  begin
    insert into public.prompter_retention_vault
      (source_table, source_pk, tenant_id, row_data, archive_reason)
    values (tg_table_name, v_pk, old.tenant_id, v_data, v_reason);
  exception when others or query_canceled then
    -- pesan tanpa data baris (hindari data pribadi di log)
    raise exception 'LR001 gagal menyalin arsip retensi (% / sqlstate %); penghapusan dibatalkan',
      tg_table_name, sqlstate using errcode = 'LR001';
  end;

  return old;
end $fn$;

-- 3. Penolak TRUNCATE (tiga tabel billing) dan penjaga hanya-tambah pada brankas
create or replace function public.fn_prompter_retention_block_truncate()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  raise exception 'LR003 TRUNCATE % ditolak: bukti billing dilindungi 4r', tg_table_name using errcode = 'LR003';
end $fn$;

create or replace function public.fn_prompter_retention_vault_immutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  raise exception 'LR004 prompter_retention_vault hanya-tambah (% ditolak)', tg_op using errcode = 'LR004';
end $fn$;

-- 4. Pemasangan trigger (nama zz = urutan abjad terakhir di antara BEFORE DELETE: bila trigger lain membatalkan hapus, salinan tidak dibuat)
drop trigger if exists trg_zz_retention_capture on public.prompter_subscriptions;
create trigger trg_zz_retention_capture before delete on public.prompter_subscriptions
  for each row execute function public.fn_prompter_retention_vault_capture();
drop trigger if exists trg_zz_retention_capture on public.prompter_invoices;
create trigger trg_zz_retention_capture before delete on public.prompter_invoices
  for each row execute function public.fn_prompter_retention_vault_capture();
drop trigger if exists trg_zz_retention_capture on public.prompter_payment_transactions;
create trigger trg_zz_retention_capture before delete on public.prompter_payment_transactions
  for each row execute function public.fn_prompter_retention_vault_capture();

drop trigger if exists trg_retention_no_truncate on public.prompter_subscriptions;
create trigger trg_retention_no_truncate before truncate on public.prompter_subscriptions
  for each statement execute function public.fn_prompter_retention_block_truncate();
drop trigger if exists trg_retention_no_truncate on public.prompter_invoices;
create trigger trg_retention_no_truncate before truncate on public.prompter_invoices
  for each statement execute function public.fn_prompter_retention_block_truncate();
drop trigger if exists trg_retention_no_truncate on public.prompter_payment_transactions;
create trigger trg_retention_no_truncate before truncate on public.prompter_payment_transactions
  for each statement execute function public.fn_prompter_retention_block_truncate();

drop trigger if exists trg_retention_vault_immutable on public.prompter_retention_vault;
create trigger trg_retention_vault_immutable before update or delete on public.prompter_retention_vault
  for each row execute function public.fn_prompter_retention_vault_immutable();
drop trigger if exists trg_retention_vault_no_truncate on public.prompter_retention_vault;
create trigger trg_retention_vault_no_truncate before truncate on public.prompter_retention_vault
  for each statement execute function public.fn_prompter_retention_vault_immutable();

-- 4b. Tetap menyala walau session_replication_role = replica (pernyataan DELETE langsung tetap tersalin)
alter table public.prompter_subscriptions         enable always trigger trg_zz_retention_capture;
alter table public.prompter_invoices              enable always trigger trg_zz_retention_capture;
alter table public.prompter_payment_transactions  enable always trigger trg_zz_retention_capture;
alter table public.prompter_subscriptions         enable always trigger trg_retention_no_truncate;
alter table public.prompter_invoices              enable always trigger trg_retention_no_truncate;
alter table public.prompter_payment_transactions  enable always trigger trg_retention_no_truncate;

-- 5. Status baca-saja (dibaca preflight dan pemeriksaan operator)
create or replace function public.fn_prompter_retention_vault_status()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $fn$
  with c as (
    select
      (select count(*) from pg_trigger where tgname = 'trg_zz_retention_capture' and not tgisinternal
          and tgenabled in ('O', 'A')
          and tgrelid in ('public.prompter_subscriptions'::regclass, 'public.prompter_invoices'::regclass,
                          'public.prompter_payment_transactions'::regclass)) as capture_on,
      (select count(*) from pg_trigger where tgname = 'trg_zz_retention_capture' and not tgisinternal
          and tgenabled = 'A'
          and tgrelid in ('public.prompter_subscriptions'::regclass, 'public.prompter_invoices'::regclass,
                          'public.prompter_payment_transactions'::regclass)) as capture_always,
      (select count(*) from pg_trigger where tgname = 'trg_retention_no_truncate' and not tgisinternal
          and tgenabled in ('O', 'A')
          and tgrelid in ('public.prompter_subscriptions'::regclass, 'public.prompter_invoices'::regclass,
                          'public.prompter_payment_transactions'::regclass)) as trunc_on,
      (select count(*) from pg_trigger where tgrelid = 'public.prompter_retention_vault'::regclass
          and not tgisinternal and tgenabled in ('O', 'A')) as vault_on,
      (select count(*) from public.prompter_retention_vault) as vault_rows
  )
  select jsonb_build_object(
    'capture_triggers_enabled', capture_on,
    'capture_triggers_always', capture_always,
    'truncate_guards_enabled', trunc_on,
    'vault_guards_enabled', vault_on,
    'vault_rows', vault_rows,
    'ok', (capture_on = 3 and trunc_on = 3 and vault_on = 2)) from c;
$fn$;

-- 6. Hak fungsi: tidak ada EXECUTE untuk klien (hak EXECUTE tidak diperiksa saat trigger menyala)
revoke all on function public.fn_prompter_retention_vault_capture()   from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_retention_block_truncate()  from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_retention_vault_immutable() from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_retention_vault_status()    from public, anon, authenticated, service_role;

commit;
