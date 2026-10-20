-- pre-migration snapshot (catalog hashes) used by assert_after.sql
create table t_pre as
 select 'policies'::text k, md5(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' order by tablename, policyname)) v from pg_policies where schemaname='public'
 union all
 select 'functions', md5(string_agg(p.oid::regprocedure::text||p.prosecdef||coalesce(p.proacl::text,''), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' where p.proname !~ '^t_'
 union all
 select 'owners', md5(string_agg(c.relname||pg_get_userbyid(c.relowner), '|' order by c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind='r' and c.relname !~ '^t_'
 union all
 select 'defacl', md5(string_agg(defaclrole::regrole::text||defaclnamespace::regnamespace::text||defaclobjtype::text||defaclacl::text, '|' order by defaclrole::regrole::text, defaclnamespace::regnamespace::text, defaclobjtype::text)) from pg_default_acl
 union all
 select 'acl_nonprompter', md5(string_agg(c.relname||coalesce(c.relacl::text,''), '|' order by c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind='r' and c.relname !~ '^(t_|prompter_)'
 union all
 select 'acl_seq_views', coalesce(md5(string_agg(c.relname||coalesce(c.relacl::text,''), '|' order by c.relname)),'none') from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind in ('S','v','m');
