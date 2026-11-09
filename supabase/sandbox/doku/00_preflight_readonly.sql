-- ============================================================================
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- 00 PREFLIGHT (READ-ONLY, hanya SELECT) -- LINOE DOKU sandbox database
-- ============================================================================
-- SEBELUM menjalankan: di bilah alamat Chrome pastikan URL dashboard memuat
-- ref project SANDBOX (20 karakter, DIPASTIKAN Founder dari Settings > General).
-- JANGAN jalankan di: umkmpro-ai (wjjyqovhmwenbcvbnkgx) atau linoe-otp-test
-- (bmwpykwoylmzrbmbdeqw).
-- SQL tidak bisa membaca ref project, jadi skrip ini hanya memeriksa SIDIK JARI:
--   * schema public harus KOSONG,
--   * auth.users harus 0 baris (linoe-otp-test punya 1 user OTP -> akan GAGAL),
--   * tidak boleh ada tabel milik UMKMpro (production -> akan GAGAL).
-- Hasil: satu tabel; kolom status harus PASS di semua baris, lalu baris
-- terakhir (ALL_PASS) = PASS. Ada FAIL -> BERHENTI, jangan lanjut.
-- ============================================================================
with
  pub as (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'),
  fp as (select table_name from pub where table_name in (
    'products','product_batches','warehouses','warehouse_stock','inventory_movements','purchase_orders',
    'transactions','transaction_items','online_orders','pesanan_meja','receivables','employees',
    'attendance','payroll_notes','kontrak_karyawan','leave_requests')),
  checks as (
    select 1 as n, 'public_tabel_kosong' as nama, '0' as diharapkan, (select count(*)::text from pub) as aktual
    union all select 2, 'tidak_ada_objek_prompter_linoe', '0',
      (select count(*)::text from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where s.nspname = 'public' and (c.relname like 'prompter\_%' or c.relname like 'linoe\_%'))
    union all select 3, 'auth_users_nol_(bukan_otp-test)', '0', (select count(*)::text from auth.users)
    union all select 4, 'tidak_ada_tabel_umkmpro_(bukan_production)', '0', (select count(*)::text from fp)
    union all select 5, 'shim_belum_ada(tenants,user_profiles,fn_current_*)', '0',
      ((select count(*) from pub where table_name in ('tenants','user_profiles'))
       + (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.proname in ('fn_current_tenant_id','fn_current_role')))::text
    union all select 6, 'kolom_auth.users_lengkap', '5',
      (select count(*)::text from information_schema.columns where table_schema = 'auth' and table_name = 'users'
        and column_name in ('id','email','email_confirmed_at','banned_until','deleted_at'))
    union all select 7, 'role_anon_authenticated_service_role', '3',
      (select count(*)::text from pg_roles where rolname in ('anon','authenticated','service_role'))
    union all select 8, 'fungsi_auth.uid_dan_auth.role', '2',
      (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'auth' and p.proname in ('uid','role'))
    union all select 9, 'storage.buckets_ada_(dipakai_phase1)', '1', (select count(*)::text from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'storage' and c.relname = 'buckets')
    union all select 10, 'pg_cron_tersedia_(dipakai_2_migrasi)', '1', (select count(*)::text from pg_available_extensions where name = 'pg_cron')
    union all select 11, 'postgres_mayor_>=_15', '1', (case when current_setting('server_version_num')::int >= 150000 then '1' else '0' end)
  )
select n, nama, diharapkan, aktual, case when diharapkan = aktual then 'PASS' else 'FAIL' end as status
from checks
union all
select 99, 'ALL_PASS', 'semua PASS', '',
  case when bool_and(diharapkan = aktual) then 'PASS' else 'FAIL' end from checks
order by n;
