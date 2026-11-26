-- LINOE Paket 2 L1: ketatkan Storage LINOE. BELUM DITERAPKAN ke database mana pun oleh PR yang menambahkannya.
--
-- Masalah (migrasi Phase 1, 20260829092303): empat bucket public-read dibuat dan satu policy `FOR ALL` pada storage.objects
-- mengizinkan tenant MENULIS (insert/update/delete) ke keempatnya. Hanya `product-media` dipakai kode (features/products/*);
-- `creative-assets`, `brand-assets`, `generated-content` adalah bucket CADANGAN: tak ada penulis, tak ada pembaca, harus kosong.
--
-- Perubahan (hanya objek milik LINOE, dikenali lewat nama DAN sidik Phase 1):
--   1. Tiga bucket cadangan -> PRIVAT (public = false), HANYA bila bucket itu terbukti milik LINOE: file_size_limit dan allowed_mime_types
--      sama dengan literal Phase 1 dan tanpa owner/owner_id (bukan bucket pihak lain yang kebetulan senama). Bucket ada tetapi sidiknya
--      berbeda = RAISE EXCEPTION, seluruh migrasi batal. Bucket tidak ada = dilewati (NOTICE).
--      Juga HANYA bila tanpa objek: ada satu objek pun = RAISE EXCEPTION (Jalur C = karantina/hapus hanya dengan persetujuan khusus per kelas
--      dan jumlah). Migrasi ini TIDAK menghapus objek.
--   2. Policy "Tenant kelola file marketing miliknya sendiri" (FOR ALL, empat bucket) diganti empat policy per-perintah:
--        SELECT -> empat bucket LINOE, folder tenant sendiri (tidak berubah dibanding sebelumnya)
--        INSERT / UPDATE / DELETE -> HANYA bucket_id = 'product-media', folder tenant sendiri
--      UPDATE product-media SENGAJA dipertahankan di L1 (kode memakai upsert:false dan tampak tak memakai update/move;
--      diverifikasi ulang saat PR; penutupan di L1b/L3).
--   3. Idempoten: dijalankan ulang menghasilkan keadaan yang sama. Hanya empat nama policy baru dan satu nama policy lama di bawah
--      yang disentuh; policy pihak lain (PUBLOE, MITAPENG, UMKMpro, Apotek) tidak pernah di-drop atau diubah.
--   4. TIDAK mengubah file_size_limit, allowed_mime_types, bucket `product-media` (baris bucket maupun flag public), atau objek apa pun (itu L1b).
--
-- TIDAK ditutup oleh L1 (dilaporkan, bukan diperbaiki): policy PERMISSIVE tulis milik pihak lain pada storage.objects yang TIDAK menyebut
-- bucket_id. Policy semacam itu (bila ada) tetap mengizinkan tenant menulis ke bucket cadangan walau bucketnya privat. PRECHECK Q0 / POSTCHECK P9 mendeteksinya.
--
-- Transaksi eksplisit (begin ... commit) agar `set local` berlaku dan semua langkah atomik walau dijalankan TANPA `psql -1` (SQL Editor per pernyataan):
-- error di mana pun = tidak ada perubahan. Urutan: (a) guard sidik bucket dan hitungan objek SEBELUM DROP POLICY yang destruktif;
-- (b) DROP policy lama (mengambil kunci tabel storage.objects); (c) hitung objek lagi di bawah kunci itu, baru ubah bucket dan buat policy baru.
-- DROP/CREATE POLICY mengambil kunci tabel yang kuat pada storage.objects: unggah/hapus file ditahan selama transaksi (milidetik pada kondisi normal).
-- lock_timeout 3 detik dan statement_timeout 10 detik membatasi tunggu; keduanya gagal = tidak ada perubahan. Jalankan di jam sepi.
-- Rollback: supabase/rollback/20261126100000_prompter_storage_bucket_l1.down.sql
-- Pemilik storage.objects / storage.buckets di Supabase adalah supabase_storage_admin; apakah role migrasi boleh mengubahnya =
-- UNKNOWN sampai dicoba (PRECHECK Q7 hanya melaporkan keanggotaan role, BUKAN bukti hak). Migrasi Phase 1 membuat policy yang sama pada tabel yang sama.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $$
declare
  v_reserved constant text[] := array['creative-assets', 'brand-assets', 'generated-content'];
  v_ref record;
  v_count bigint;
begin
  for v_ref in select * from (values
      ('creative-assets', 104857600::bigint, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']::text[]),
      ('brand-assets', 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']::text[]),
      ('generated-content', 104857600::bigint, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']::text[])
    ) as t(id, lim, mimes) loop
    if exists (select 1 from storage.buckets b where b.id = v_ref.id) then
      if not exists (
        select 1 from storage.buckets b
        where b.id = v_ref.id
        and b.file_size_limit is not distinct from v_ref.lim
        and coalesce(b.allowed_mime_types @> v_ref.mimes and b.allowed_mime_types <@ v_ref.mimes, false)
        and (to_jsonb(b) ->> 'owner') is null and (to_jsonb(b) ->> 'owner_id') is null
      ) then
        raise exception 'L1 BERHENTI: bucket % tidak cocok sidik Phase 1 LINOE (batas/mime/owner berbeda); bukan terbukti milik LINOE. Tidak ada yang diubah.', v_ref.id
          using errcode = 'P0001';
      end if;
    else
      raise notice 'L1: bucket % tidak ada, dilewati', v_ref.id;
    end if;
  end loop;

  select count(*) into v_count from storage.objects where bucket_id = any (v_reserved);
  if v_count > 0 then
    raise exception 'L1 BERHENTI: % objek ada di bucket cadangan (creative-assets/brand-assets/generated-content). Tidak ada yang diubah. Jalur C (karantina/hapus) butuh persetujuan khusus per kelas dan jumlah.', v_count
      using errcode = 'P0001';
  end if;
end
$$;

drop policy if exists "Tenant kelola file marketing miliknya sendiri" on storage.objects;

do $$
declare
  v_reserved constant text[] := array['creative-assets', 'brand-assets', 'generated-content'];
  v_ref record;
  v_count bigint;
begin
  select count(*) into v_count from storage.objects where bucket_id = any (v_reserved);
  if v_count > 0 then
    raise exception 'L1 BERHENTI: % objek muncul di bucket cadangan selama migrasi. Semua perubahan dibatalkan.', v_count
      using errcode = 'P0001';
  end if;

  for v_ref in select * from (values
      ('creative-assets', 104857600::bigint, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']::text[]),
      ('brand-assets', 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']::text[]),
      ('generated-content', 104857600::bigint, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']::text[])
    ) as t(id, lim, mimes) loop
    update storage.buckets b set public = false
    where b.id = v_ref.id
        and b.file_size_limit is not distinct from v_ref.lim
        and coalesce(b.allowed_mime_types @> v_ref.mimes and b.allowed_mime_types <@ v_ref.mimes, false)
        and (to_jsonb(b) ->> 'owner') is null and (to_jsonb(b) ->> 'owner_id') is null
      and b.public is distinct from false;
  end loop;
end
$$;

drop policy if exists "Tenant baca file marketing miliknya sendiri" on storage.objects;
create policy "Tenant baca file marketing miliknya sendiri"
  on storage.objects for select
  using (
    bucket_id in ('product-media', 'creative-assets', 'brand-assets', 'generated-content')
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  );

drop policy if exists "Tenant unggah file product-media miliknya sendiri" on storage.objects;
create policy "Tenant unggah file product-media miliknya sendiri"
  on storage.objects for insert
  with check (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  );

drop policy if exists "Tenant ubah file product-media miliknya sendiri" on storage.objects;
create policy "Tenant ubah file product-media miliknya sendiri"
  on storage.objects for update
  using (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  )
  with check (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  );

drop policy if exists "Tenant hapus file product-media miliknya sendiri" on storage.objects;
create policy "Tenant hapus file product-media miliknya sendiri"
  on storage.objects for delete
  using (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1] = public.fn_current_tenant_id()::text
  );

commit;
