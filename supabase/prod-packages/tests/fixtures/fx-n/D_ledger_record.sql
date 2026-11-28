-- FIXTURE fx-n - D. CATAT LEDGER. Hanya dijalankan runner (psql -v created_by=...) setelah B sukses DAN C lolos. Tepat satu INSERT; menolak bila belum terpasang lengkap.
begin;
do $$ begin
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('FX tenant select', 'FX tenant insert', 'FX tenant update', 'FX tenant delete')) <> 4
     or (select count(*) from pg_trigger t where t.tgname = 'trg_fx_audit_no_update' and not t.tgisinternal) <> 1
     or (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'FX tenant all') <> 0 then
    raise exception 'DIBATALKAN: migrasi fixture belum terpasang lengkap. Tidak ada yang dicatat.';
  end if;
end $$;
insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values ('20990101000000', 'fixture_native_txn',
  array['-- Fixture gladi bersih. Isi = supabase/prod-packages/tests/fixtures/fx-n/migration/20990101000000_fixture_native_txn.sql (SHA-256 c9b80b904fed46fe645dbab2d541e80c54b6dda50164393c0a14696abe972f45).'],
  :'created_by')
on conflict (version) do nothing;
commit;
select (select count(*) from supabase_migrations.schema_migrations where version = '20990101000000') as tercatat_fx_harus_1;
