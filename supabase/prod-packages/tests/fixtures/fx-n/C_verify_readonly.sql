-- FIXTURE fx-n - C. VERIFIKASI POST-APPLY READ-ONLY. Kolom samakan_A dibandingkan dengan baseline A. ACL diperiksa MENTAH (aclexplode/has_*_privilege):
-- REVOKE oleh non-pemilik berupa no-op diam-diam, jadi hanya pemeriksaan ACL yang menangkapnya.
select
  (select count(*) from storage.buckets b where b.id in ('fx-reserved-1', 'fx-reserved-2') and b.public = false) as bucket_cadangan_privat_harus_2,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'FX tenant all') as policy_lama_harus_0,
  (select count(distinct cmd) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('FX tenant select', 'FX tenant insert', 'FX tenant update', 'FX tenant delete')) as policy_baru_perintah_harus_4,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'FX tenant %' and cmd = 'ALL') as policy_all_harus_0,
  (select count(*) from pg_trigger t where t.tgname = 'trg_fx_audit_no_update' and t.tgenabled = 'O' and not t.tgisinternal) as trigger_audit_aktif_harus_1,
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(n), (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(x) where has_table_privilege(r.n, 'public.fx_audit_logs', p.x)) as acl_audit_tulis_harus_0,
  (select count(*) from (values ('anon'), ('authenticated')) r(n) where has_table_privilege(r.n, 'storage.objects', 'TRUNCATE')) as acl_objects_truncate_harus_0,
  (select count(*) from aclexplode((select relacl from pg_class where oid = 'public.fx_audit_logs'::regclass)) a where a.privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE') and a.grantee <> (select relowner from pg_class where oid = 'public.fx_audit_logs'::regclass)) as acl_audit_mentah_harus_0,
  (obj_description('public.fx_audit_logs'::regclass, 'pg_class') is not null) as komentar_audit_harus_true,
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(n) where has_function_privilege(r.n, 'public.fn_fx_evidence_purge(timestamptz)', 'EXECUTE')) as purge_exec_harus_0,
  (select count(*) from supabase_migrations.schema_migrations where version = '20990101000000') as ledger_fx_sebelum_D_harus_0,
  (select count(*) from public.fx_audit_logs) as audit_baris_samakan_A,
  (select md5(coalesce(string_agg(p.policyname || p.cmd || coalesce(p.qual, '') || coalesce(p.with_check, ''), '|' order by p.policyname), '')) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname not like 'FX tenant %') as policy_lain_md5_samakan_A,
  (select md5(coalesce(string_agg(b.id || b.public::text || coalesce(b.file_size_limit::text, ''), '|' order by b.id), '')) from storage.buckets b where b.id not in ('fx-reserved-1', 'fx-reserved-2')) as bucket_lain_md5_samakan_A,
  (select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.oid::regprocedure::text), '')) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('fn_fx_block_audit_change', 'fn_fx_evidence_purge') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) as fungsi_lain_md5_samakan_A,
  (select md5(coalesce(string_agg(c.relname || '.' || t.tgname, '|' order by c.relname, t.tgname), '')) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgname <> 'trg_fx_audit_no_update') as trigger_lain_md5_samakan_A;
