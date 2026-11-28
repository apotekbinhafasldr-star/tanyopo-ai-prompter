-- LINOE - CEK LEDGER SEBELUM D (hanya SELECT). Dijalankan runner dengan psql -v ver=... -v nm=... (dari manifest).
-- Tujuan: D memakai "on conflict (version) do nothing". Kalau NAMA migrasi sudah ada di ledger dengan versi lain (atau versi sudah ada),
-- D bisa diam-diam tidak mencatat apa pun. Cek ini menolak LEBIH AWAL (sebelum B) dan lagi tepat sebelum D.
-- Keluaran hanya angka (tanpa nama).
select
  (select count(*) from supabase_migrations.schema_migrations where version = :'ver') as versi_sudah_ada_harus_0,
  (select count(*) from supabase_migrations.schema_migrations where name = :'nm') as nama_sudah_ada_harus_0;
