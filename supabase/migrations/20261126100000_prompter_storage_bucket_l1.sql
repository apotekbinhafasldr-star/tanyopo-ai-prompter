-- LINOE Paket 2 L1: ketatkan Storage LINOE. BELUM DITERAPKAN ke database mana pun oleh PR yang menambahkannya.
--
-- Masalah (migrasi Phase 1, 20260829092303): empat bucket public-read dibuat dan satu policy `FOR ALL` pada storage.objects
-- mengizinkan tenant MENULIS (insert/update/delete) ke keempatnya. Hanya `product-media` dipakai kode (features/products/*);
-- `creative-assets`, `brand-assets`, `generated-content` adalah bucket CADANGAN: tak ada penulis, tak ada pembaca, harus kosong.
--
-- Perubahan (hanya objek milik LINOE, dikenali lewat nama):
--   1. Tiga bucket cadangan -> PRIVAT (public = false), HANYA bila bucket ada dan tidak berisi objek.
--      Bila ada satu objek pun di salah satunya, migrasi berhenti dengan RAISE EXCEPTION dan SEMUA perubahan batal (satu transaksi).
--      Karantina/penghapusan objek = Jalur C, hanya dengan persetujuan khusus per kelas dan jumlah. Migrasi ini TIDAK menghapus objek.
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
-- Urutan sengaja: DROP policy lama dulu (mengambil kunci tabel storage.objects), baru hitung objek, sehingga hitungan dan perubahan
-- terjadi di bawah kunci yang sama. lock_timeout membatasi waktu tunggu; bila kunci tak didapat, migrasi gagal dan tak mengubah apa pun.
-- Rollback: supabase/rollback/20261126100000_prompter_storage_bucket_l1.down.sql
-- Pemilik storage.objects / storage.buckets di Supabase adalah supabase_storage_admin; apakah role migrasi boleh mengubahnya =
-- UNKNOWN sampai PRECHECK (Q7) dijalankan Founder. Migrasi Phase 1 membuat policy yang sama pada tabel yang sama.

set local lock_timeout = '3s';

drop policy if exists "Tenant kelola file marketing miliknya sendiri" on storage.objects;

do $$
declare
  v_reserved constant text[] := array['creative-assets', 'brand-assets', 'generated-content'];
  v_count bigint;
  v_bucket text;
begin
  select count(*) into v_count from storage.objects where bucket_id = any (v_reserved);
  if v_count > 0 then
    raise exception 'L1 BERHENTI: % objek ada di bucket cadangan (creative-assets/brand-assets/generated-content). Tidak ada yang diubah. Jalur C (karantina/hapus) butuh persetujuan khusus per kelas dan jumlah.', v_count
      using errcode = 'P0001';
  end if;

  foreach v_bucket in array v_reserved loop
    if not exists (select 1 from storage.buckets where id = v_bucket) then
      raise notice 'L1: bucket % tidak ada, dilewati', v_bucket;
    end if;
  end loop;

  update storage.buckets set public = false
  where id = any (v_reserved) and public is distinct from false;
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
