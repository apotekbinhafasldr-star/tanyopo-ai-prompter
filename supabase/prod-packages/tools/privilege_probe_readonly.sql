-- LINOE - PROBE HAK READ-ONLY (hanya SELECT; tidak menulis, tidak mencoba DROP/CREATE). Dijalankan runner dengan
-- psql -v probe_spec='<json>' (spec diturunkan dari allow-list paket di manifest). Keluaran: (probe, status, info).
-- status: PASS = hak ada; BLOCK = hak tidak ada; UNKNOWN = objek tidak ditemukan/tidak bisa dinilai (diperlakukan seperti BLOCK);
-- INFO = nilai catatan (boolean/hitungan, TANPA nama; tanpa md5/isi ACL). Label probe = urutan + jenis (mis. tbl1.owner), tidak memuat nama objek.
-- Aturan PostgreSQL (dokumentasi, bukan bukti Supabase): CREATE/DROP POLICY, DROP TRIGGER, COMMENT, ALTER TABLE menuntut hak role pemilik
-- (owner). Dicek dengan pg_has_role(..., 'USAGE') = hak pemilik benar-benar DIWARISI; 'MEMBER' saja salah untuk role NOINHERIT; CREATE TRIGGER menuntut hak TRIGGER; UPDATE/DELETE baris menuntut hak tabel; REVOKE oleh non-pemilik = no-op diam-diam.
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
      when kind = 'owner' then case when pg_has_role(current_user, (select c.relowner from pg_class c where c.oid = tk.oid), 'USAGE') then 'PASS' else 'BLOCK' end
      when kind in ('select', 'insert', 'update', 'delete', 'truncate', 'trigger', 'references')
        then case when has_table_privilege(current_user, tk.oid, upper(kind)) then 'PASS' else 'BLOCK' end
      else 'UNKNOWN' end as status,
    ''::text as info
  from tk
),
fn as (
  select 'fn' || o::text as lbl, x as q from spec, jsonb_array_elements_text(coalesce(j->'functions', '[]'::jsonb)) with ordinality as a(x, o)
),
r_fn as (
  select lbl || '.owner' as probe,
    case when to_regprocedure(q) is null then 'UNKNOWN'
         when pg_has_role(current_user, (select p.proowner from pg_proc p where p.oid = to_regprocedure(q)), 'USAGE') then 'PASS' else 'BLOCK' end as status,
    ''::text as info
  from fn
),
rp as (
  select 'rep' || o::text as lbl, x as q from spec, jsonb_array_elements_text(coalesce(j->'replaces', '[]'::jsonb)) with ordinality as a(x, o)
),
r_rep as (  -- CREATE OR REPLACE FUNCTION: when the function already exists it must be owned (USAGE = the owner's rights are inherited); when it does not exist there is nothing to own (CREATE on the schema is probed separately)
  select lbl || '.owner' as probe,
    case when to_regprocedure(q) is null then 'PASS'
         when pg_has_role(current_user, (select p.proowner from pg_proc p where p.oid = to_regprocedure(q)), 'USAGE') then 'PASS' else 'BLOCK' end as status,
    ''::text as info
  from rp
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
  select * from r_tbl union all select * from r_fn union all select * from r_rep union all select * from r_sc
  union all select * from r_ledger union all select * from r_role
) u order by probe;
