-- LINOE - AUDIT PEMILIK OBJEK READ-ONLY (hanya SELECT). Tidak menampilkan data pelanggan.
-- Tujuan: memutuskan seberapa sempit hak role migrasi bisa dibuat SEBELUM role itu dibuat.
select item, value from (
  select 1 as o, 'login_role' as item, current_user::text as value
  union all select 2, 'login_superuser', (select rolsuper::text from pg_roles where rolname = current_user)
  union all select 3, 'login_createrole', (select rolcreaterole::text from pg_roles where rolname = current_user)
  union all select 4, 'login_bypassrls', (select rolbypassrls::text from pg_roles where rolname = current_user)
  union all select 5, 'login_anggota_postgres', coalesce((select pg_has_role(current_user, 'postgres', 'USAGE')::text where exists (select 1 from pg_roles where rolname = 'postgres')), 'n/a')
  union all select 6, 'login_anggota_supabase_admin', coalesce((select pg_has_role(current_user, 'supabase_admin', 'USAGE')::text where exists (select 1 from pg_roles where rolname = 'supabase_admin')), 'n/a')
  union all select 7, 'login_create_di_schema_public', has_schema_privilege(current_user, 'public', 'CREATE')::text
  union all select 10, 'pemilik_fn_apply_verified_payment', coalesce((select string_agg(distinct pg_get_userbyid(p.proowner), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_apply_verified_payment'), 'tidak ada')
  union all select 11, 'pemilik_prompter_invoices', coalesce((select pg_get_userbyid(c.relowner) from pg_class c where c.oid = to_regclass('public.prompter_invoices')), 'tidak ada')
  union all select 12, 'pemilik_prompter_payment_transactions', coalesce((select pg_get_userbyid(c.relowner) from pg_class c where c.oid = to_regclass('public.prompter_payment_transactions')), 'tidak ada')
  union all select 13, 'pemilik_prompter_subscriptions', coalesce((select pg_get_userbyid(c.relowner) from pg_class c where c.oid = to_regclass('public.prompter_subscriptions')), 'tidak ada')
  union all select 20, 'jumlah_objek_public_prompter_per_pemilik', coalesce((select string_agg(o || '=' || n, ', ' order by o) from (select pg_get_userbyid(c.relowner) as o, count(*) as n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','S') and c.relname like 'prompter\_%' group by 1) x), 'tidak ada')
  union all select 21, 'jumlah_objek_public_non_prompter_per_pemilik', coalesce((select string_agg(o || '=' || n, ', ' order by o) from (select pg_get_userbyid(c.relowner) as o, count(*) as n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','S') and c.relname not like 'prompter\_%' group by 1) x), 'tidak ada')
  union all select 22, 'jumlah_fungsi_public_per_pemilik', coalesce((select string_agg(o || '=' || n, ', ' order by o) from (select pg_get_userbyid(p.proowner) as o, count(*) as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' group by 1) x), 'tidak ada')
) q order by o;
