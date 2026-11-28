-- FIXTURE fx-n - A. PREFLIGHT READ-ONLY (hanya SELECT). Hanya hitungan, boolean, md5: tidak ada nama policy/bucket/tabel pihak lain.
select
  (to_regclass('public.fx_audit_logs') is not null and to_regclass('public.fx_evidence') is not null and to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null) as tabel_ada_harus_true,
  (select count(*) from storage.buckets b where (b.id = 'fx-reserved-1' and b.file_size_limit = 1048576) or (b.id = 'fx-reserved-2' and b.file_size_limit = 2097152)) as bucket_cadangan_cocok_harus_2,
  (select count(*) from storage.buckets b where b.id in ('fx-reserved-1', 'fx-reserved-2')) - (select count(*) from storage.buckets b where (b.id = 'fx-reserved-1' and b.file_size_limit = 1048576) or (b.id = 'fx-reserved-2' and b.file_size_limit = 2097152)) as bucket_cadangan_tak_cocok_harus_0,
  (select count(*) from storage.objects where bucket_id in ('fx-reserved-1', 'fx-reserved-2')) as objek_cadangan_harus_0,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'FX tenant all') as policy_lama_harus_1,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('FX tenant select', 'FX tenant insert', 'FX tenant update', 'FX tenant delete')) as policy_baru_harus_0,
  (select count(*) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname not like 'FX tenant %' and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%fx-reserved-%') as policy_pihak_lain_cadangan_harus_0,
  (select count(*) from pg_trigger t where t.tgname = 'trg_fx_audit_no_update' and not t.tgisinternal) as trigger_audit_harus_0,
  (select count(*) from supabase_migrations.schema_migrations where version = '20990101000000') as ledger_fx_harus_0,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname not like 'FX tenant %') as policy_lain_jumlah_info,
  (select md5(coalesce(string_agg(p.policyname || p.cmd || coalesce(p.qual, '') || coalesce(p.with_check, ''), '|' order by p.policyname), '')) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname not like 'FX tenant %') as policy_lain_md5_catat,
  (select md5(coalesce(string_agg(b.id || b.public::text || coalesce(b.file_size_limit::text, ''), '|' order by b.id), '')) from storage.buckets b where b.id not in ('fx-reserved-1', 'fx-reserved-2')) as bucket_lain_md5_catat,
  (select md5(coalesce(string_agg(b.id || b.public::text, '|' order by b.id), '')) from storage.buckets b where b.id in ('fx-reserved-1', 'fx-reserved-2')) as bucket_cadangan_flag_md5_catat,
  (select count(*) from public.fx_audit_logs) as audit_baris_catat,
  (select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.oid::regprocedure::text), '')) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('fn_fx_block_audit_change', 'fn_fx_evidence_purge') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) as fungsi_lain_md5_catat,
  (select md5(coalesce(string_agg(c.relname || '.' || t.tgname, '|' order by c.relname, t.tgname), '')) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgname <> 'trg_fx_audit_no_update') as trigger_lain_md5_catat;
