-- ============================================================================
-- EKSTRAKSI DEFINISI OBJEK BERSAMA — READ-ONLY, KATALOG SAJA (satu pernyataan SELECT)
-- ============================================================================
-- Untuk: SQL Editor project umkmpro-ai, DIJALANKAN FOUNDER SENDIRI. Claude tidak menjalankannya.
-- Tujuan: mengganti shim 01_shim_shared_objects.sql dengan definisi ASLI tenants, user_profiles,
--         fn_current_tenant_id(), fn_current_role(), handle_new_user dan trigger-nya.
-- Yang dibaca (semuanya metadata/skema): information_schema.columns, information_schema.role_table_grants,
--   pg_class, pg_constraint, pg_indexes, pg_policies, pg_proc, pg_trigger.
-- Yang TIDAK dibaca: isi baris tabel apa pun (tenants, user_profiles, auth.users, transaksi, dst.), secret, kunci.
-- Tidak ada: INSERT/UPDATE/DELETE/DDL/GRANT/SET, begin/commit, pemanggilan fungsi aplikasi.
--   pg_get_functiondef() hanya MENAMPILKAN teks fungsi, tidak mengeksekusinya.
-- Pengaman: objek yang tidak ada -> hasil null (to_regclass), bukan error. Teks mirip token/JWT/kunci
--   otomatis diganti [REDACTED]. Tetap baca sekilas hasilnya sebelum mengirim.
-- Hasil: SATU sel teks JSON bernama definisi_objek_bersama.
-- ============================================================================
select regexp_replace(
  jsonb_pretty(jsonb_build_object(
    'server_version', current_setting('server_version'),
    'columns', (select jsonb_agg(jsonb_build_object('tabel', table_name, 'kolom', column_name, 'tipe', data_type,
        'nullable', is_nullable, 'default', column_default) order by table_name, ordinal_position)
      from information_schema.columns where table_schema = 'public' and table_name in ('tenants','user_profiles')),
    'constraints', (select jsonb_agg(jsonb_build_object('tabel', conrelid::regclass::text, 'nama', conname,
        'def', pg_get_constraintdef(oid)) order by conrelid::regclass::text, conname)
      from pg_constraint where conrelid in (to_regclass('public.tenants'), to_regclass('public.user_profiles'))),
    'indexes', (select jsonb_agg(jsonb_build_object('tabel', tablename, 'def', indexdef) order by tablename, indexname)
      from pg_indexes where schemaname = 'public' and tablename in ('tenants','user_profiles')),
    'rls', (select jsonb_agg(jsonb_build_object('tabel', relname, 'rls', relrowsecurity, 'force', relforcerowsecurity,
        'owner', pg_get_userbyid(relowner)))
      from pg_class where oid in (to_regclass('public.tenants'), to_regclass('public.user_profiles'))),
    'policies', (select jsonb_agg(jsonb_build_object('tabel', tablename, 'nama', policyname, 'cmd', cmd, 'roles', roles::text,
        'using', qual, 'check', with_check) order by tablename, policyname)
      from pg_policies where schemaname = 'public' and tablename in ('tenants','user_profiles')),
    'grants_tabel', (select jsonb_agg(jsonb_build_object('tabel', table_name, 'grantee', grantee, 'hak', privilege_type)
        order by table_name, grantee, privilege_type)
      from information_schema.role_table_grants where table_schema = 'public' and table_name in ('tenants','user_profiles')
        and grantee in ('anon','authenticated','service_role','public')),
    'fungsi', (select jsonb_agg(jsonb_build_object('sig', p.oid::regprocedure::text, 'def', pg_get_functiondef(p.oid),
        'acl', p.proacl::text, 'owner', pg_get_userbyid(p.proowner)) order by p.proname)
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and p.proname in ('fn_current_tenant_id','fn_current_role','handle_new_user')),
    'trigger', (select jsonb_agg(jsonb_build_object('nama', t.tgname, 'tabel', t.tgrelid::regclass::text,
        'def', pg_get_triggerdef(t.oid)) order by t.tgname)
      from pg_trigger t where not t.tgisinternal
        and t.tgrelid in (to_regclass('auth.users'), to_regclass('public.tenants'), to_regclass('public.user_profiles'))),
    'auth_users_kolom', (select jsonb_agg(jsonb_build_object('kolom', column_name, 'tipe', data_type, 'nullable', is_nullable)
        order by ordinal_position)
      from information_schema.columns where table_schema = 'auth' and table_name = 'users'),
    'jumlah_fk_ke_user_profiles_atau_auth_users', (select count(*) from pg_constraint
      where contype = 'f' and confrelid in (to_regclass('public.user_profiles'), to_regclass('auth.users')))
  )),
  '(eyJ[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_[A-Za-z0-9_-]+|[Bb]earer[[:space:]]+[A-Za-z0-9._~+/=-]{10,})',
  '[REDACTED]', 'g'
) as definisi_objek_bersama;
