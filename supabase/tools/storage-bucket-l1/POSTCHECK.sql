-- LINOE Paket 2 L1 - POSTCHECK (HANYA SELECT, read-only). Dijalankan Founder SETELAH L1 diterapkan (dengan persetujuan terpisah).
-- Isi lima placeholder di CTE "ref" dengan nilai dari PRECHECK (BUKAN nilai tertanam). Placeholder tak diisi = status UNKNOWN, bukan PASS.
--   q1  = nilai Q1 (sidik product-media)             q0  = HANYA 32 karakter heksadesimal setelah "md5_daftar=" pada Q0 (atau kata KOSONG); jangan salin tanda titik koma/teks lain
--   q2  = md5_batas_mime_empat_bucket dari baris Q2        q5  = nilai Q5                    q6 = nilai Q6
-- Catatan: sidik Q1/P3 hanya memeriksa kata kunci (product-media, fn_current_tenant_id, perintah), bukan predikat penuh; P11 menambah pemeriksaan predikat folder tenant.
-- Status: PASS | PASS-DENGAN-CATATAN | TINJAU | GAGAL | UNKNOWN
with
ref as (select 'ISI_Q1'::text as q1, 'ISI_Q0'::text as q0, 'ISI_Q2'::text as q2, 'ISI_Q5'::text as q5, 'ISI_Q6'::text as q6),
lin as (
  select unnest(array[
    'Tenant kelola file marketing miliknya sendiri',
    'Tenant baca file marketing miliknya sendiri',
    'Tenant unggah file product-media miliknya sendiri',
    'Tenant ubah file product-media miliknya sendiri',
    'Tenant hapus file product-media miliknya sendiri']) as n
),
pol as (select * from pg_policies where schemaname = 'storage' and tablename = 'objects'),
fw_note as (
  select * from pol p
  where p.permissive = 'PERMISSIVE' and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    and p.roles && array['public', 'authenticated', 'anon']::name[]
    and p.policyname not in (select n from lin)
    and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) !~ 'bucket_id'
),
fp as (
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
)
select kode, uraian, nilai, status from (
  select 1 as o, 'P1' as kode, 'Bucket cadangan yang ada harus privat (public=false).' as uraian,
    'ada=' || (select count(*) from storage.buckets where id in ('creative-assets','brand-assets','generated-content'))
      || '; masih_publik=' || (select count(*) from storage.buckets where id in ('creative-assets','brand-assets','generated-content') and public) as nilai,
    case when (select count(*) from storage.buckets where id in ('creative-assets','brand-assets','generated-content') and public) = 0 then 'PASS' else 'GAGAL' end as status
  union all
  select 2, 'P2', 'Policy lama FOR ALL hilang (0); empat policy baru ada (4) dengan perintah SELECT/INSERT/UPDATE/DELETE masing-masing sekali.',
    'lama=' || (select count(*) from pol where policyname = 'Tenant kelola file marketing miliknya sendiri')
      || '; baru=' || (select count(*) from pol where policyname in (select n from lin) and policyname <> 'Tenant kelola file marketing miliknya sendiri')
      || '; perintah=' || coalesce((select string_agg(cmd, ',' order by cmd) from pol where policyname in (select n from lin) and policyname <> 'Tenant kelola file marketing miliknya sendiri'), '-'),
    case when (select count(*) from pol where policyname = 'Tenant kelola file marketing miliknya sendiri') = 0
          and (select string_agg(cmd, ',' order by cmd) from pol where policyname in (select n from lin)) = 'DELETE,INSERT,SELECT,UPDATE' then 'PASS' else 'GAGAL' end
  union all
  select 3, 'P3', 'Sidik product-media setelah L1 harus SAMA dengan Q1 PRECHECK (nilai Q1 diisi di CTE ref, bukan baseline tertanam).',
    (select h from fp) || ' vs ' || (select q1 from ref),
    case when (select q1 from ref) like 'ISI\_Q%' then 'UNKNOWN' when (select h from fp) = (select q1 from ref) then 'PASS' else 'GAGAL' end
  union all
  select 4, 'P4', 'Setiap policy tulis LINOE (INSERT/UPDATE/DELETE) hanya menyebut product-media dan bukan FOR ALL.',
    'tulis_tanpa_product_media=' || (select count(*) from pol where policyname in (select n from lin) and cmd in ('ALL','INSERT','UPDATE','DELETE')
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'product-media')
      || '; semua_perintah_ALL=' || (select count(*) from pol where policyname in (select n from lin) and cmd = 'ALL')
      || '; menyebut_bucket_cadangan=' || (select count(*) from pol where policyname in (select n from lin) and cmd in ('INSERT','UPDATE','DELETE')
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(creative-assets|brand-assets|generated-content)'),
    case when (select count(*) from pol where policyname in (select n from lin) and (cmd = 'ALL' or (cmd in ('INSERT','UPDATE','DELETE') and
        ((coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'product-media' or (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(creative-assets|brand-assets|generated-content)')))) = 0
      then 'PASS' else 'GAGAL' end
  union all
  select 5, 'P5', 'Objek di bucket cadangan tetap 0 (L1 tidak menghapus/memindah objek).',
    (select count(*) from storage.objects where bucket_id in ('creative-assets','brand-assets','generated-content'))::text,
    case when (select count(*) from storage.objects where bucket_id in ('creative-assets','brand-assets','generated-content')) = 0 then 'PASS' else 'TINJAU' end
  union all
  select 6, 'P6', 'Md5 policy LAIN (bukan nama LINOE) sama dengan Q6 PRECHECK: L1 tidak menyentuh policy pihak lain.',
    coalesce((select md5(string_agg(policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ',') || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' order by policyname))
      from pol where policyname not in (select n from lin)), 'KOSONG') || ' vs ' || (select q6 from ref),
    case when (select q6 from ref) like 'ISI\_Q%' then 'UNKNOWN'
         when coalesce((select md5(string_agg(policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ',') || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' order by policyname))
           from pol where policyname not in (select n from lin)), 'KOSONG') = (select q6 from ref) then 'PASS' else 'GAGAL' end
  union all
  select 7, 'P7', 'Hak role (anon/authenticated/service_role) pada storage.objects/buckets sama dengan Q5.',
    md5(string_agg(r || ':' || t || ':' || pr || '=' || has_table_privilege(r, t, pr)::text, '|' order by r, t, pr)) || ' vs ' || (select q5 from ref),
    case when (select q5 from ref) like 'ISI\_Q%' then 'UNKNOWN'
         when md5(string_agg(r || ':' || t || ':' || pr || '=' || has_table_privilege(r, t, pr)::text, '|' order by r, t, pr)) = (select q5 from ref) then 'PASS' else 'GAGAL' end
  from (select r, t, pr from unnest(array['anon','authenticated','service_role']) r,
          unnest(array['storage.objects','storage.buckets']) t, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr) g
  union all
  select 8, 'P8', 'Batas ukuran dan mime keempat bucket LINOE tidak berubah (md5 sama dengan Q2 md5_batas_mime_empat_bucket; flag public sengaja tidak ikut).',
    coalesce((select md5(string_agg(concat_ws(':', id, file_size_limit::text, array_to_string(allowed_mime_types, ',')), '|' order by id))
        from storage.buckets where id in ('product-media','creative-assets','brand-assets','generated-content')), 'KOSONG') || ' vs ' || (select q2 from ref),
    case when (select q2 from ref) like 'ISI\_Q%' then 'UNKNOWN'
         when coalesce((select md5(string_agg(concat_ws(':', id, file_size_limit::text, array_to_string(allowed_mime_types, ',')), '|' order by id))
           from storage.buckets where id in ('product-media','creative-assets','brand-assets','generated-content')), 'KOSONG') = (select q2 from ref) then 'PASS' else 'GAGAL' end
  union all
  select 9, 'P9', 'Policy PERMISSIVE tulis pihak lain TANPA bucket_id. Sama dengan daftar Q0 = PASS-DENGAN-CATATAN (bukan dibuat L1; L1 tidak menutupnya; tenant masih bisa menulis ke bucket cadangan lewat policy itu). Beda = TINJAU.',
    'jumlah=' || (select count(*) from fw_note) || '; md5=' || coalesce((select md5(string_agg(policyname || '/' || cmd, '|' order by policyname)) from fw_note), 'KOSONG')
      || '; daftar=' || coalesce((select string_agg(policyname || '/' || cmd, ' | ' order by policyname) from fw_note), '-'),
    case when (select count(*) from fw_note) = 0 then 'PASS'
         when (select q0 from ref) like 'ISI\_Q%' then 'TINJAU'
         when coalesce((select md5(string_agg(policyname || '/' || cmd, '|' order by policyname)) from fw_note), 'KOSONG') = (select q0 from ref) then 'PASS-DENGAN-CATATAN'
         else 'TINJAU' end
  union all
  select 10, 'P10', 'UJI MANUAL (tidak bisa dari SQL): unggah file uji ke bucket cadangan lewat API Storage memakai akun QA TETAP; harus DITOLAK (HTTP 400/403, "row-level security"). Lalu unggah ke product-media folder tenant akun itu; harus BERHASIL. Token JANGAN ditempel di chat.',
    'dijalankan_Founder=belum', 'UNKNOWN (bila tak bisa dari HP)'
  union all
  select 11, 'P11', 'Setiap policy baru LINOE memuat predikat folder tenant (storage.foldername(name))[1] = fn_current_tenant_id()::text (sidik Q1/P3 hanya memeriksa kata kunci, bukan predikat; ini pemeriksaan tambahan).',
    'tanpa_predikat_folder=' || (select count(*) from pol where policyname in (select n from lin) and policyname <> 'Tenant kelola file marketing miliknya sendiri'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'foldername\(name\)\)\[1\] = \((public\.)?fn_current_tenant_id\(\)\)::text'),
    case when (select count(*) from pol where policyname in (select n from lin) and policyname <> 'Tenant kelola file marketing miliknya sendiri') = 4
          and (select count(*) from pol where policyname in (select n from lin) and policyname <> 'Tenant kelola file marketing miliknya sendiri'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'foldername\(name\)\)\[1\] = \((public\.)?fn_current_tenant_id\(\)\)::text') = 0 then 'PASS' else 'GAGAL' end
) q order by o;
