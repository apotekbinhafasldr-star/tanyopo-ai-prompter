-- ============================================================================
-- EKSTRAKSI DEFINISI ASLI (READ-ONLY, KATALOG SAJA, TANPA DATA BARIS)
-- ============================================================================
-- Tujuan: mengganti shim 01_shim_shared_objects.sql dengan definisi ASLI objek UMKMpro.
-- DIJALANKAN OLEH FOUNDER SENDIRI, HANYA bila Founder memutuskan (project itu berstatus
-- "mutlak tidak disentuh" untuk Claude; Claude TIDAK menjalankan berkas ini).
-- Isinya hanya SELECT pada katalog sistem (pg_catalog/information_schema): tidak membaca isi tabel
-- tenants/user_profiles/auth.users, tidak menulis, tidak ada DDL. Hasil: SATU sel JSON.
-- Salin hasilnya (tanpa menambah apa pun) untuk dibuatkan bootstrap yang setara.
-- ============================================================================
select jsonb_pretty(jsonb_build_object(
  'server_version', current_setting('server_version'),
  'columns', (select jsonb_agg(jsonb_build_object('tabel', table_name, 'kolom', column_name, 'tipe', data_type,
      'nullable', is_nullable, 'default', column_default) order by table_name, ordinal_position)
    from information_schema.columns where table_schema = 'public' and table_name in ('tenants','user_profiles')),
  'constraints', (select jsonb_agg(jsonb_build_object('tabel', conrelid::regclass::text, 'nama', conname,
      'def', pg_get_constraintdef(oid)) order by conrelid::regclass::text, conname)
    from pg_constraint where conrelid in ('public.tenants'::regclass, 'public.user_profiles'::regclass)),
  'indexes', (select jsonb_agg(jsonb_build_object('tabel', tablename, 'def', indexdef) order by tablename, indexname)
    from pg_indexes where schemaname = 'public' and tablename in ('tenants','user_profiles')),
  'rls', (select jsonb_agg(jsonb_build_object('tabel', relname, 'rls', relrowsecurity, 'force', relforcerowsecurity, 'owner', pg_get_userbyid(relowner)))
    from pg_class where oid in ('public.tenants'::regclass, 'public.user_profiles'::regclass)),
  'policies', (select jsonb_agg(jsonb_build_object('tabel', tablename, 'nama', policyname, 'cmd', cmd, 'roles', roles::text,
      'using', qual, 'check', with_check) order by tablename, policyname)
    from pg_policies where schemaname = 'public' and tablename in ('tenants','user_profiles')),
  'grants_tabel', (select jsonb_agg(jsonb_build_object('tabel', table_name, 'grantee', grantee, 'hak', privilege_type) order by table_name, grantee, privilege_type)
    from information_schema.role_table_grants where table_schema = 'public' and table_name in ('tenants','user_profiles')
      and grantee in ('anon','authenticated','service_role','public')),
  'fungsi', (select jsonb_agg(jsonb_build_object('sig', p.oid::regprocedure::text, 'def', pg_get_functiondef(p.oid),
      'acl', p.proacl::text, 'owner', pg_get_userbyid(p.proowner)) order by p.proname)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('fn_current_tenant_id','fn_current_role','handle_new_user')),
  'trigger', (select jsonb_agg(jsonb_build_object('nama', t.tgname, 'tabel', t.tgrelid::regclass::text,
      'def', pg_get_triggerdef(t.oid)) order by t.tgname)
    from pg_trigger t where not t.tgisinternal
      and t.tgrelid in ('auth.users'::regclass, 'public.tenants'::regclass, 'public.user_profiles'::regclass)),
  'auth_users_kolom', (select jsonb_agg(jsonb_build_object('kolom', column_name, 'tipe', data_type, 'nullable', is_nullable) order by ordinal_position)
    from information_schema.columns where table_schema = 'auth' and table_name = 'users'),
  'fk_dari_prompter_ke_user_profiles_atau_users', (select count(*) from pg_constraint
    where contype = 'f' and confrelid in ('public.user_profiles'::regclass, 'auth.users'::regclass))
)) as definisi_objek_bersama;
