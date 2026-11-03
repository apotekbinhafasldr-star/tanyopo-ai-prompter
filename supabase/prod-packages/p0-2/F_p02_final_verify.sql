-- LINOE P0-2 - F. VERIFIKASI AKHIR READ-ONLY (hanya SELECT), setelah D. Proyek: umkmpro-ai.
select
  (select count(*) from supabase_migrations.schema_migrations where version='20261103170000') as ledger_p02_harus_1,
  (select max(version) from supabase_migrations.schema_migrations) as versi_terakhir_harus_20261103170000,
  ((select md5(regexp_replace(p.prosrc,'\s+','','g')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fn_apply_verified_payment' and pg_get_function_identity_arguments(p.oid)='p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text')='fed9cc40c66292168cf7d26b53adaec0') as fungsi_v3_harus_true,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='prompter_invoices' and column_name='transaction_id' and data_type='uuid' and is_nullable='YES') as kolom_harus_1,
  (select count(*) from pg_indexes where schemaname='public' and tablename='prompter_invoices' and indexname='uq_prompter_invoices_transaction' and indexdef ilike '%unique%' and indexdef ilike '%transaction_id%' and indexdef ilike '%where%') as indeks_unik_harus_1,
  coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.prompter_invoices')),false) as rls_harus_true,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='prompter_invoices' and grantee in ('anon','authenticated','PUBLIC') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) as hak_tulis_anon_auth_harus_0,
  (select count(*) from pg_proc x where x.oid=(select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fn_apply_verified_payment' and pg_get_function_identity_arguments(p.oid)='p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text') and (has_function_privilege('anon',x.oid,'EXECUTE') or has_function_privilege('authenticated',x.oid,'EXECUTE'))) as fungsi_exec_anon_auth_harus_0,
  (select count(*) from public.prompter_invoices where transaction_id is null) as invoice_historis_harus_0,
  (select count(*) from public.prompter_payment_transactions where status='PAID') as paid_info,
  (select count(*) from public.prompter_payment_transactions where status='PAID' and not exists (select 1 from public.prompter_invoices i where i.transaction_id=prompter_payment_transactions.id)) as paid_tanpa_invoice_info_dua_lama;
