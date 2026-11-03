-- LINOE P0-2 - D. CATAT LEDGER. Hanya dijalankan runner (psql -v created_by=...) setelah B sukses DAN semua kolom C sesuai.
-- Hanya MENCATAT versi 20261103170000; tidak menjalankan ulang migrasi. Aman diulang. Menolak jika P0-2 belum terpasang lengkap.
begin;
do $$ begin
  if (select md5(regexp_replace(p.prosrc,'\s+','','g')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fn_apply_verified_payment' and pg_get_function_identity_arguments(p.oid)='p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text') is distinct from 'fed9cc40c66292168cf7d26b53adaec0' or (select count(*) from information_schema.columns where table_schema='public' and table_name='prompter_invoices' and column_name='transaction_id' and data_type='uuid' and is_nullable='YES') <> 1 or (select count(*) from pg_indexes where schemaname='public' and tablename='prompter_invoices' and indexname='uq_prompter_invoices_transaction' and indexdef ilike '%unique%' and indexdef ilike '%transaction_id%' and indexdef ilike '%where%') <> 1 or (select count(*) from pg_constraint where conrelid='public.prompter_invoices'::regclass and contype='f' and confrelid='public.prompter_payment_transactions'::regclass and confdeltype='a' and conkey=(select array_agg(attnum) from pg_attribute where attrelid='public.prompter_invoices'::regclass and attname='transaction_id')) <> 1
     or not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.prompter_invoices')),false) or (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='prompter_invoices' and grantee in ('anon','authenticated','PUBLIC') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) <> 0 or (select count(*) from pg_proc x where x.oid=(select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fn_apply_verified_payment' and pg_get_function_identity_arguments(p.oid)='p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text') and (has_function_privilege('anon',x.oid,'EXECUTE') or has_function_privilege('authenticated',x.oid,'EXECUTE'))) <> 0 then
    raise exception 'DIBATALKAN: migrasi P0-2 belum terpasang lengkap. Tidak ada yang dicatat.';
  end if;
end $$;
insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values ('20261103170000','prompter_p0_2_payment_invoices',
  array['-- Diterapkan lewat workflow Production Migration (PR #81, main 1205572). Isi = supabase/migrations/20261103170000_prompter_p0_2_payment_invoices.sql (SHA-256 21d860e5e2f9a20ecf35900cc2705be717f1fd4ee4c16855bd404ff705668bbd).'],
  :'created_by')
on conflict (version) do nothing;
commit;
select (select count(*) from supabase_migrations.schema_migrations where version='20261103170000') as tercatat_p02_harus_1,
       (select max(version) from supabase_migrations.schema_migrations) as versi_terakhir_harus_20261103170000;
