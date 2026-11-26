-- Rollback untuk 20261126100000_prompter_storage_bucket_l1.sql.
-- Memulihkan keadaan Phase 1: tiga bucket cadangan public = true dan policy FOR ALL semula pada empat bucket.
-- Tidak menyentuh objek, file_size_limit, allowed_mime_types, bucket product-media, atau policy pihak lain. Idempoten.
-- Catatan: public = true dipulihkan tanpa syarat untuk tiga bucket cadangan karena itulah keadaan semula dari migrasi Phase 1.
-- Bila PRECHECK Q2 mencatat keadaan semula yang berbeda, ikuti ROLLBACK.md (Jalur A/B/C), bukan skrip ini.
set local lock_timeout = '3s';

drop policy if exists "Tenant baca file marketing miliknya sendiri" on storage.objects;
drop policy if exists "Tenant unggah file product-media miliknya sendiri" on storage.objects;
drop policy if exists "Tenant ubah file product-media miliknya sendiri" on storage.objects;
drop policy if exists "Tenant hapus file product-media miliknya sendiri" on storage.objects;

update storage.buckets set public = true
where id in ('creative-assets', 'brand-assets', 'generated-content') and public is distinct from true;

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
