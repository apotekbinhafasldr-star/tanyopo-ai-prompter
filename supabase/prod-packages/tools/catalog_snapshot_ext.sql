-- LINOE - SIDIK KATALOG TAMBAHAN READ-ONLY (hanya SELECT): policy/trigger/ACL/komentar di skema public dan storage, baris bucket.
-- Pelengkap catalog_snapshot.sql (yang hanya skema public) untuk gladi bersih paket yang menyentuh storage. Hanya digest md5, tanpa nilai mentah.
select item, md5(detail) as digest from (
  select 'policy:' || schemaname || '.' || tablename || '.' || policyname as item, permissive || '|' || array_to_string(roles, ',') || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as detail
    from pg_policies where schemaname = 'storage'
  union all select 'table_acl:storage.' || c.relname, coalesce(c.relacl::text, '') || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|' || pg_get_userbyid(c.relowner)
    from pg_class c where c.relnamespace = 'storage'::regnamespace and c.relkind in ('r', 'v', 'm', 'S')
  union all select 'bucket:' || b.id, b.public::text || '|' || coalesce(b.file_size_limit::text, '') || '|' || coalesce(array_to_string(b.allowed_mime_types, ','), '')
    from storage.buckets b where to_regclass('storage.buckets') is not null
  union all select 'comment:' || c.relnamespace::regnamespace || '.' || c.relname, coalesce(obj_description(c.oid, 'pg_class'), '')
    from pg_class c where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace) and c.relkind = 'r'
  union all select 'trigger_state:' || c.relname || '.' || t.tgname, t.tgenabled::text
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
) s order by 1;
