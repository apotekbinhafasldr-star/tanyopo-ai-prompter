-- ============================================================================
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- 99 ROLLBACK SANDBOX -- membongkar semua yang dipasang 01 + 10_* + 20 (+ 02 bila dipasang).
-- HANYA untuk project sandbox. Aman-gagal: berhenti bila marker sandbox tidak ada
-- (artinya BUKAN project yang kita bootstrap) atau bila terlihat tabel UMKMpro (production).
-- Hanya menghapus objek yang DIKENAL (prompter_*, acct_*, finance_*, tax_opt_*, tenants, user_profiles, _linoe_*, fn_*).
-- Ada objek asing di public -> ABORT sebelum menghapus apa pun.
-- TIDAK dapat dibatalkan. Cara paling bersih tetap: hapus project sandbox di dashboard, lalu
-- buat project baru (ref baru -> allow-list env harus diperbarui).
-- Batasan: Supabase melarang DELETE langsung pada storage.buckets; bila ditolak, 4 bucket
-- (product-media, creative-assets, brand-assets, generated-content) tertinggal dan ada NOTICE.
-- ============================================================================
begin;
do $rb$
declare r record; v_n int := 0; v_unknown text;
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: marker sandbox tidak ada. Ini BUKAN project hasil bootstrap kita. Tidak ada yang dihapus.';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in (
      'products','product_batches','warehouses','warehouse_stock','inventory_movements','purchase_orders','transactions',
      'transaction_items','online_orders','pesanan_meja','receivables','employees','attendance','payroll_notes','kontrak_karyawan','leave_requests')) then
    raise exception 'ABORT: tabel UMKMpro terdeteksi -> kemungkinan PRODUCTION. Tidak ada yang dihapus.';
  end if;

  -- guard objek asing: semua pemeriksaan DI SINI, sebelum ada penghapusan
  select string_agg(c.relname, ', ') into v_unknown from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m')
     and c.relname !~ '^(prompter_|acct_|finance_|tax_opt_|_linoe_)' and c.relname not in ('tenants','user_profiles');
  if v_unknown is not null then
    raise exception 'ABORT: ada tabel/view tak dikenal di public (%). Tidak ada yang dihapus. Hapus manual atau hapus project.', v_unknown;
  end if;
  select string_agg(p.proname, ', ') into v_unknown from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f','p') and p.proname <> 'rls_auto_enable'
     and p.proname !~ '^(fn_|prompter_|tax_opt_|acct_|finance_|handle_new_user$)'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if v_unknown is not null then
    raise exception 'ABORT: ada fungsi tak dikenal di public (%). Tidak ada yang dihapus.', v_unknown;
  end if;

  -- 1. job pg_cron milik migrasi
  if to_regclass('cron.job') is not null then
    for r in execute 'select jobname from cron.job where jobname like ''prompter-%''' loop
      perform cron.unschedule(r.jobname); v_n := v_n + 1;
    end loop;
  end if;

  -- 1b. pengguna dummy dari 20_seed (email @sandbox.invalid); cascade ke user_profiles
  begin
    delete from auth.users where email like 'seed-%@sandbox.invalid';
  exception when others then raise notice 'auth.users seed tidak bisa dihapus: %', sqlerrm;
  end;

  -- 2. trigger opsional pada auth.users (02), bila ada
  begin
    execute 'drop trigger if exists on_auth_user_created on auth.users';
  exception when others then raise notice 'trigger on_auth_user_created tidak bisa dihapus: %', sqlerrm;
  end;

  -- 3. policy storage buatan migrasi phase1
  begin
    execute 'drop policy if exists "Tenant kelola file marketing miliknya sendiri" on storage.objects';
  exception when others then raise notice 'policy storage tidak bisa dihapus: %', sqlerrm;
  end;

  -- 4. bucket (mungkin ditolak oleh proteksi Storage)
  begin
    delete from storage.buckets where id in ('product-media','creative-assets','brand-assets','generated-content');
  exception when others then raise notice 'bucket tidak bisa dihapus lewat SQL (%). Hapus manual lewat dashboard Storage atau hapus project.', sqlerrm;
  end;

  -- 5. tabel: HANYA yang dikenal (prompter_*, acct_*, finance_*, tax_opt_*, tenants, user_profiles, _linoe_*).
  --    Bila ada tabel lain di public (mis. dibuat manual), berhenti dan tidak menghapus apa pun.
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('drop table if exists public.%I cascade', r.relname);
  end loop;

  -- 6. fungsi: HANYA yang dikenal; rls_auto_enable (bawaan Supabase) dan anggota ekstensi tidak disentuh
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind in ('f','p')
              and p.proname ~ '^(fn_|prompter_|tax_opt_|acct_|finance_|handle_new_user$)'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $rb$;
commit;
-- Cek hasil (read-only): jalankan ulang 00_preflight_readonly.sql; baris 1,2,4,5 harus kembali PASS.
-- Baris 3 (auth.users = 0) baru PASS bila TIDAK ada pengguna asli/signup: rollback hanya menghapus pengguna seed
-- (seed-*@sandbox.invalid), BUKAN pengguna lain. Hapus sisanya lewat Dashboard -> Authentication -> Users, atau buat ulang project.
