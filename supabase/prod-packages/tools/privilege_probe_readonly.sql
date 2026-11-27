-- LINOE - PROBE HAK READ-ONLY (hanya SELECT; tidak menulis, tidak mencoba DROP/CREATE). Dijalankan runner dengan
-- psql -v probe_spec='<json>' (spec diturunkan dari allow-list paket di manifest). Keluaran: (probe, status, info).
-- status: PASS = hak ada; BLOCK = hak tidak ada; UNKNOWN = objek tidak ditemukan/tidak bisa dinilai (diperlakukan seperti BLOCK);
-- INFO = nilai catatan (hitungan/md5, TANPA nama). Label probe = urutan + jenis (mis. tbl1.owner), tidak memuat nama objek.
-- Aturan PostgreSQL (dokumentasi, bukan bukti Supabase): CREATE/DROP POLICY, DROP TRIGGER, COMMENT, ALTER TABLE menuntut keanggotaan role
-- pemilik (owner); CREATE TRIGGER menuntut hak TRIGGER; UPDATE/DELETE baris menuntut hak tabel; REVOKE oleh non-pemilik = no-op diam-diam.
with spec as (select :'probe_spec'::jsonb as j),
tb as (
  select 'tbl' || o::text as lbl, x->>'table' as q, x->'need' as need
  from spec, jsonb_array_elements(coalesce(j->'tables', '[]'::jsonb)) with ordinality as a(x, o)
),
tk as (
  select lbl, q, n as kind, to_regclass(q) as oid from tb, jsonb_array_elements_text(need) as n
),
r_tbl as (
  select lbl || '.' || kind as probe,
    case
      when oid is null then 'UNKNOWN'
      when kind = 'owner' then case when pg_has_role(current_user, (select c.relowner from pg_class c where c.oid = tk.oid), 'MEMBER') then 'PASS' else 'BLOCK' end
      when kind in ('select', 'insert', 'update', 'delete', 'truncate', 'trigger', 'references')
        then case when has_table_privilege(current_user, tk.oid, upper(kind)) then 'PASS' else 'BLOCK' end
      else 'UNKNOWN' end as status,
    ''::text as info
  from tk
),
r_acl as (
  select 'acl_' || t.lbl as probe, 'INFO'::text as status, coalesce(md5(c.relacl::text), md5('')) as info
    from tb t join pg_class c on c.oid = to_regclass(t.q)
  union all
  select 'aclw_' || t.lbl, 'INFO', (select count(*) from aclexplode(c.relacl) a where a.privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE') and a.grantee <> c.relowner)::text
    from tb t join pg_class c on c.oid = to_regclass(t.q)
),
fn as (
  select 'fn' || o::text as lbl, x as q from spec, jsonb_array_elements_text(coalesce(j->'functions', '[]'::jsonb)) with ordinality as a(x, o)
),
r_fn as (
  select lbl || '.owner' as probe,
    case when to_regprocedure(q) is null then 'UNKNOWN'
         when pg_has_role(current_user, (select p.proowner from pg_proc p where p.oid = to_regprocedure(q)), 'MEMBER') then 'PASS' else 'BLOCK' end as status,
    ''::text as info
  from fn
),
sc as (
  select 'schema' || o::text as lbl, x as q from spec, jsonb_array_elements_text(coalesce(j->'schemas', '[]'::jsonb)) with ordinality as a(x, o)
),
r_sc as (
  select lbl || '.create' as probe, case when to_regnamespace(q) is null then 'UNKNOWN' when has_schema_privilege(current_user, q, 'CREATE') then 'PASS' else 'BLOCK' end as status, ''::text as info from sc
  union all
  select lbl || '.usage', case when to_regnamespace(q) is null then 'UNKNOWN' when has_schema_privilege(current_user, q, 'USAGE') then 'PASS' else 'BLOCK' end, '' from sc
),
r_ledger as (
  select 'ledger.insert' as probe,
    case when to_regclass('supabase_migrations.schema_migrations') is null then 'UNKNOWN'
         when has_table_privilege(current_user, to_regclass('supabase_migrations.schema_migrations'), 'INSERT') then 'PASS' else 'BLOCK' end as status,
    ''::text as info
  from spec where coalesce((j->>'ledger_insert')::boolean, false)
),
r_role as (
  select 'role.superuser' as probe, 'INFO'::text as status, (select rolsuper::text from pg_roles where rolname = current_user) as info
  union all
  select 'role.priv_member_count', 'INFO', (select count(*) from pg_roles r where r.rolname in ('postgres', 'supabase_admin') and pg_has_role(current_user, r.oid, 'MEMBER'))::text
)
select probe, status, case info when 'true' then 't' when 'false' then 'f' else info end as info from (
  select * from r_tbl union all select * from r_acl union all select * from r_fn union all select * from r_sc
  union all select * from r_ledger union all select * from r_role
) u order by probe;
