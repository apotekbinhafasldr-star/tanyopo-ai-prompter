-- LINOE - SIDIK JARI KATALOG READ-ONLY (hanya SELECT). Dipakai gladi bersih CI untuk membuktikan HANYA objek yang diharapkan yang berubah.
select item, md5(detail) as digest from (
  select 'function:' || p.pronamespace::regnamespace || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item, pg_get_functiondef(p.oid) as detail
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all select 'function_acl:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', coalesce(p.proacl::text, '')
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all select 'column:public.' || table_name || '.' || column_name, data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all select 'index:' || schemaname || '.' || indexname, indexdef from pg_indexes where schemaname = 'public'
  union all select 'constraint:' || conrelid::regclass || '.' || conname, pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'trigger:' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  union all select 'policy:' || tablename || '.' || policyname, cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
  union all select 'table_acl:' || c.relname, coalesce(c.relacl::text, '') || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S')
) s order by 1;
