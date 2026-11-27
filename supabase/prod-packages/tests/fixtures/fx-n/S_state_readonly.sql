-- FIXTURE fx-n - S. DETEKSI KEADAAN READ-ONLY. Satu kolom `keadaan` dihitung di SQL (kosakata tertutup: PRE / APPLIED_UNRECORDED / DONE / ROLLED_BACK / UNKNOWN).
select case
  when n_old = 1 and n_new = 0 and trg = 0 and led = 0 then 'PRE'
  when n_old = 0 and n_new = 4 and trg = 1 and led = 0 then 'APPLIED_UNRECORDED'
  when n_old = 0 and n_new = 4 and trg = 1 and led = 1 then 'DONE'
  when n_old = 1 and n_new = 0 and trg = 0 and led = 1 then 'ROLLED_BACK'
  else 'UNKNOWN' end as keadaan
from (select
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'FX tenant all') as n_old,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('FX tenant select', 'FX tenant insert', 'FX tenant update', 'FX tenant delete')) as n_new,
  (select count(*) from pg_trigger t where t.tgname = 'trg_fx_audit_no_update' and not t.tgisinternal) as trg,
  (select count(*) from supabase_migrations.schema_migrations where version = '20990101000000') as led) s;
