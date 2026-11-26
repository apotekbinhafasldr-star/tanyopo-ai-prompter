-- Rollback untuk 20261126100000_prompter_storage_bucket_l1.sql.
-- Memulihkan keadaan Phase 1 HANYA untuk objek yang terbukti milik LINOE:
--   * tiga bucket cadangan public = true, tetapi hanya bila sidiknya cocok literal Phase 1 (file_size_limit, allowed_mime_types, tanpa owner/owner_id).
--     Bucket yang tidak cocok TIDAK disentuh dan memicu RAISE NOTICE (bukan error: policy tetap dipulihkan). Bucket tidak ada = dilewati.
--   * policy FOR ALL semula pada empat bucket; empat policy L1 dihapus (nama LINOE saja).
-- Tidak menyentuh objek, file_size_limit, allowed_mime_types, bucket product-media, atau policy pihak lain. Idempoten.
-- Catatan: public = true adalah keadaan semula menurut Phase 1. Bila PRECHECK Q2 sebelum L1 mencatat keadaan lain, ikuti ROLLBACK.md.
-- Transaksi eksplisit: atomik walau dijalankan tanpa `psql -1`; lock_timeout 3 detik, statement_timeout 10 detik (jalankan di jam sepi).
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

drop policy if exists "Tenant baca file marketing miliknya sendiri" on storage.objects;
drop policy if exists "Tenant unggah file product-media miliknya sendiri" on storage.objects;
drop policy if exists "Tenant ubah file product-media miliknya sendiri" on storage.objects;
drop policy if exists "Tenant hapus file product-media miliknya sendiri" on storage.objects;

do $$
declare
  v_ref record;
begin
  for v_ref in select * from (values
      ('creative-assets', 104857600::bigint, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']::text[]),
      ('brand-assets', 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']::text[]),
      ('generated-content', 104857600::bigint, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']::text[])
    ) as t(id, lim, mimes) loop
    if not exists (select 1 from storage.buckets b where b.id = v_ref.id) then
      raise notice 'ROLLBACK L1: bucket % tidak ada, dilewati', v_ref.id;
    elsif exists (
      select 1 from storage.buckets b
      where b.id = v_ref.id
        and b.file_size_limit is not distinct from v_ref.lim
        and coalesce(b.allowed_mime_types @> v_ref.mimes and b.allowed_mime_types <@ v_ref.mimes, false)
        and (to_jsonb(b) ->> 'owner') is null and (to_jsonb(b) ->> 'owner_id') is null
    ) then
      update storage.buckets b set public = true where b.id = v_ref.id and b.public is distinct from true;
    else
      raise notice 'ROLLBACK L1: bucket % tidak cocok sidik Phase 1 LINOE, TIDAK disentuh', v_ref.id;
    end if;
  end loop;
end
$$;

drop policy if exists "Tenant kelola file marketing miliknya sendiri" on storage.objects;
create policy "Tenant kelola file marketing miliknya sendiri"
  on storage.objects for all
  using (
    bucket_id in ('product-media', 'creative-assets', 'brand-assets', 'generated-content')
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  )
  with check (
    bucket_id in ('product-media', 'creative-assets', 'brand-assets', 'generated-content')
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  );

commit;
