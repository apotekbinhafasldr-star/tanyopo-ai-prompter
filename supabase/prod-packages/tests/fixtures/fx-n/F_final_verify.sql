-- FIXTURE fx-n - F. VERIFIKASI AKHIR READ-ONLY, setelah D (konstanta, tanpa baseline).
select
  (select count(*) from supabase_migrations.schema_migrations where version = '20990101000000') as ledger_fx_harus_1,
  (select max(version) from supabase_migrations.schema_migrations) as versi_terakhir_harus_20990101000000,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('FX tenant select', 'FX tenant insert', 'FX tenant update', 'FX tenant delete')) as policy_baru_harus_4,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'FX tenant all') as policy_lama_harus_0,
  (select count(*) from storage.buckets b where b.id in ('fx-reserved-1', 'fx-reserved-2') and b.public = false) as bucket_cadangan_privat_harus_2,
  (select count(*) from pg_trigger t where t.tgname = 'trg_fx_audit_no_update' and t.tgenabled = 'O' and not t.tgisinternal) as trigger_audit_aktif_harus_1,
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(n), (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(x) where has_table_privilege(r.n, 'public.fx_audit_logs', p.x)) as acl_audit_tulis_harus_0,
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(n) where has_function_privilege(r.n, 'public.fn_fx_evidence_purge(timestamptz)', 'EXECUTE')) as purge_exec_harus_0;
