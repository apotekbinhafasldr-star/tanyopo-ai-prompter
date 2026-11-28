-- FIXTURE fx-n - G. KEADAAN SETELAH ROLLBACK, READ-ONLY. NOTICE tidak terlihat di log runner, jadi pemulihan diperiksa lewat keadaan, bukan pesan.
select
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'FX tenant all' and cmd = 'ALL') as policy_lama_harus_1,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('FX tenant select', 'FX tenant insert', 'FX tenant update', 'FX tenant delete')) as policy_baru_harus_0,
  (select count(*) from pg_trigger t where t.tgname = 'trg_fx_audit_no_update' and not t.tgisinternal) as trigger_audit_harus_0,
  (select count(*) from pg_proc where proname in ('fn_fx_block_audit_change', 'fn_fx_evidence_purge')) as fungsi_fx_harus_0,
  (select count(*) from storage.buckets b where b.id in ('fx-reserved-1', 'fx-reserved-2') and b.public = true) as bucket_cadangan_publik_harus_2,
  (select count(*) from (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(x) where has_table_privilege('service_role', 'public.fx_audit_logs', p.x)) as acl_audit_service_role_harus_3,
  (select count(*) from (values ('anon'), ('authenticated')) r(n) where has_table_privilege(r.n, 'storage.objects', 'TRUNCATE')) as acl_objects_truncate_harus_2,
  (obj_description('public.fx_audit_logs'::regclass, 'pg_class') is null) as komentar_audit_kosong_harus_true;
