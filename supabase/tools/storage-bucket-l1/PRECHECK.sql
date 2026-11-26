-- LINOE Paket 2 L1 - PRECHECK (HANYA SELECT, read-only). JANGAN dijalankan sebelum Founder menyetujui PRECHECK production.
-- Tidak ada DML/DDL, tidak membaca isi/nama file objek (hanya hitungan), tidak mengeluarkan token/kunci.
-- Satu pernyataan, satu tabel hasil (cocok untuk SQL Editor di HP). Salin kolom "nilai" untuk Q1, Q2, Q5, Q6 dan Q0 ke POSTCHECK.
-- Status: LANJUT | LANJUT-DENGAN-CATATAN | BERHENTI | TINJAU | SUDAH-DITERAPKAN | UNKNOWN
with
lin as (  -- nama policy milik LINOE (satu-satunya yang boleh disentuh L1)
  select unnest(array[
    'Tenant kelola file marketing miliknya sendiri',
    'Tenant baca file marketing miliknya sendiri',
    'Tenant unggah file product-media miliknya sendiri',
    'Tenant ubah file product-media miliknya sendiri',
    'Tenant hapus file product-media miliknya sendiri']) as n
),
res as (select unnest(array['creative-assets','brand-assets','generated-content']) as b),
pol as (select * from pg_policies where schemaname = 'storage' and tablename = 'objects'),
fw as (  -- policy PERMISSIVE tulis untuk public/authenticated/anon milik PIHAK LAIN
  select p.*, coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as ekspr
  from pol p
  where p.permissive = 'PERMISSIVE' and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    and p.roles && array['public', 'authenticated', 'anon']::name[]
    and p.policyname not in (select n from lin)
),
fw_stop as (select * from fw where ekspr ~ '(product-media|creative-assets|brand-assets|generated-content)'),
fw_note as (select * from fw where ekspr !~ 'bucket_id'),
cnt as (select r.b, (select count(*) from storage.objects o where o.bucket_id = r.b) as n from res r),
fp as (  -- sidik product-media: baris bucket + perintah (ALL dipecah) yang diizinkan policy LINOE dengan batas folder tenant
  select md5(
    coalesce((select concat_ws('|', id, public::text, file_size_limit::text, array_to_string(allowed_mime_types, ',')) from storage.buckets where id = 'product-media'), 'TIDAK-ADA')
    || '#' ||
    coalesce((select string_agg(c, ',' order by c) from (
        select distinct unnest(case when p.cmd = 'ALL' then array['SELECT','INSERT','UPDATE','DELETE'] else array[p.cmd::text] end) as c
        from pol p
        where p.policyname in (select n from lin) and p.permissive = 'PERMISSIVE'
          and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ 'product-media'
          and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ 'fn_current_tenant_id') s), '')
  ) as h
  from (select 1) x
)
select kode, uraian, nilai, status from (
  select 0 as o, 'Q0' as kode,
    'Policy PERMISSIVE tulis pihak lain TANPA bucket_id (L1 TIDAK menutup/menyentuh policy itu; tenant masih bisa menulis ke bucket cadangan lewat policy itu). BERHENTI bila policy pihak lain menyebut bucket LINOE.' as uraian,
    'tanpa_bucket_id=' || (select count(*) from fw_note) || '; menyebut_bucket_linoe=' || (select count(*) from fw_stop)
      || '; md5_daftar=' || coalesce((select md5(string_agg(policyname || '/' || cmd, '|' order by policyname)) from fw_note), 'KOSONG')
      || '; daftar=' || coalesce((select string_agg(policyname || '/' || cmd, ' | ' order by policyname) from fw_note), '-') as nilai,
    case when (select count(*) from fw_stop) > 0 then 'BERHENTI'
         when (select count(*) from fw_note) > 0 then 'LANJUT-DENGAN-CATATAN' else 'LANJUT' end as status
  union all
  select 1, 'Q1', 'Sidik md5 product-media (baris bucket + perintah tulis/baca LINOE). Salin nilai ke POSTCHECK P3.',
    (select h from fp), 'CATAT'
  union all
  select 2, 'Q2', 'Bucket: md5 batas ukuran+mime keempat bucket LINOE (tanpa flag public, untuk P8); daftar semua bucket (hanya id:public).',
    'md5_batas_mime_empat_bucket=' || coalesce((select md5(string_agg(concat_ws(':', id, file_size_limit::text, array_to_string(allowed_mime_types, ',')), '|' order by id))
        from storage.buckets where id in ('product-media','creative-assets','brand-assets','generated-content')), 'KOSONG')
      || '; semua=' || coalesce((select string_agg(id || ':' || public::text, ' | ' order by id) from storage.buckets), '-'),
    'CATAT'
  union all
  select 3, 'Q3', 'Policy pada storage.objects (nama/perintah/permissive/role).',
    coalesce((select string_agg(policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ','), ' | ' order by policyname) from pol), '-'), 'CATAT'
  union all
  select 4, 'Q4:' || b, 'Jumlah objek di bucket cadangan (harus 0). >0 = migrasi BERHENTI, Jalur C (butuh persetujuan khusus per kelas dan jumlah).',
    n::text, case when n = 0 then 'LANJUT' else 'BERHENTI' end from cnt
  union all
  select 5, 'Q5', 'Hak role pada storage.objects/buckets (md5 untuk P7).',
    md5(string_agg(r || ':' || t || ':' || pr || '=' || has_table_privilege(r, t, pr)::text, '|' order by r, t, pr)), 'CATAT'
  from (select r, t, pr from unnest(array['anon','authenticated','service_role']) r,
          unnest(array['storage.objects','storage.buckets']) t, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr) g
  union all
  select 6, 'Q6', 'Baseline md5 policy LAIN (bukan nama LINOE) pada storage.objects. Harus sama di POSTCHECK P6.',
    coalesce((select md5(string_agg(policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ',') || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' order by policyname))
      from pol where policyname not in (select n from lin)), 'KOSONG'), 'CATAT'
  union all
  select 7, 'Q7', 'Pemilik storage.objects/buckets dan hak role migrasi (linoe_migrator bila ada). mengubah storage.buckets dan policy storage.objects butuh kepemilikan; tanpa itu migrasi gagal (tidak ada perubahan).',
    'pemilik_objects=' || (select pg_get_userbyid(relowner) from pg_class where oid = 'storage.objects'::regclass)
      || '; pemilik_buckets=' || (select pg_get_userbyid(relowner) from pg_class where oid = 'storage.buckets'::regclass)
      || '; sesi=' || current_user
      || '; migrator_ada=' || exists (select 1 from pg_roles where rolname = 'linoe_migrator')::text
      || '; migrator_pemilik_objects=' || coalesce((select pg_has_role('linoe_migrator', (select relowner from pg_class where oid = 'storage.objects'::regclass), 'USAGE')::text from pg_roles where rolname = 'linoe_migrator'), 'n/a')
      || '; migrator_update_buckets=' || coalesce((select has_table_privilege('linoe_migrator', 'storage.buckets', 'UPDATE')::text from pg_roles where rolname = 'linoe_migrator'), 'n/a'),
    case when exists (select 1 from pg_roles where rolname = 'linoe_migrator') then 'TINJAU' else 'UNKNOWN' end
  union all
  select 8, 'Q8', 'Keadaan awal: policy lama FOR ALL ada (1) dan policy baru L1 belum ada (0).',
    'lama=' || (select count(*) from pol where policyname = 'Tenant kelola file marketing miliknya sendiri')
      || '; baru=' || (select count(*) from pol where policyname in (select n from lin) and policyname <> 'Tenant kelola file marketing miliknya sendiri'),
    case when (select count(*) from pol where policyname = 'Tenant kelola file marketing miliknya sendiri') = 1
              and (select count(*) from pol where policyname in (select n from lin) and policyname <> 'Tenant kelola file marketing miliknya sendiri') = 0 then 'LANJUT'
         when (select count(*) from pol where policyname = 'Tenant kelola file marketing miliknya sendiri') = 0
              and (select count(*) from pol where policyname in (select n from lin) and policyname <> 'Tenant kelola file marketing miliknya sendiri') = 4 then 'SUDAH-DITERAPKAN'
         else 'BERHENTI' end
) q order by o, kode;
