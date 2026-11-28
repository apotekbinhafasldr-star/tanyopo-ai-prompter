-- LINOE - VERIFIKASI LEDGER READ-ONLY (hanya SELECT). Dijalankan runner setelah D: psql -v ver=... -v nm=... -v sha=... (dari manifest).
-- Memastikan baris ledger: tepat satu untuk versi itu, namanya cocok, dan statements memuat sha256 isi migrasi di manifest; tidak ada nama ganda.
select
  (select count(*) from supabase_migrations.schema_migrations where version = :'ver') as ledger_baris_harus_1,
  (select count(*) from supabase_migrations.schema_migrations where name = :'nm') as ledger_nama_baris_harus_1,
  coalesce((select name = :'nm' from supabase_migrations.schema_migrations where version = :'ver'), false) as ledger_nama_cocok_harus_true,
  coalesce((select position(:'sha' in coalesce(array_to_string(statements, chr(10)), '')) > 0 from supabase_migrations.schema_migrations where version = :'ver'), false) as ledger_sha_cocok_harus_true;
