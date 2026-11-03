-- LINOE P0-2 - A. PREFLIGHT READ-ONLY (hanya SELECT). Proyek: umkmpro-ai. Jalankan lebih dulu.
-- Kolom "harus" wajib sesuai sebelum B boleh dipertimbangkan. Kolom "catat" = simpan nilainya (dibandingkan lagi di C).
select
  (to_regclass('public.prompter_invoices') is not null and to_regclass('public.prompter_payment_transactions') is not null and to_regclass('public.prompter_subscriptions') is not null) as tabel_ada_harus_true,
  ((select md5(regexp_replace(p.prosrc,'\s+','','g')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fn_apply_verified_payment' and pg_get_function_identity_arguments(p.oid)='p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text')='dbd3a48a43c2959bbc02ad0575b23803') as fungsi_b2v2_hash_harus_true,
  (select count(*) from pg_proc where proname='fn_apply_verified_payment') as fungsi_jumlah_harus_1,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='prompter_invoices' and column_name='transaction_id') as kolom_transaction_id_harus_0,
  (select count(*) from pg_indexes where indexname='uq_prompter_invoices_transaction') as indeks_unik_harus_0,
  (select count(*) from supabase_migrations.schema_migrations where version='20261103170000') as ledger_p02_harus_0,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='fn_resolve_review_payment')
    + (select count(*) from pg_indexes where indexname='uq_prompter_payment_txn_one_pending_per_tenant')
    + (select count(*) from pg_trigger where tgname='trg_prompter_subscriptions_trial_carryover' and not tgisinternal) as objek_b2_b1_harus_3,
  (select count(*) from pg_proc x where x.oid=(select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fn_apply_verified_payment' and pg_get_function_identity_arguments(p.oid)='p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text') and (has_function_privilege('anon',x.oid,'EXECUTE') or has_function_privilege('authenticated',x.oid,'EXECUTE'))) as fungsi_exec_anon_auth_harus_0,
  coalesce((select x.prosecdef and x.proconfig::text like '%search_path=public%' from pg_proc x where x.oid=(select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fn_apply_verified_payment' and pg_get_function_identity_arguments(p.oid)='p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text')),false) as fungsi_secdef_searchpath_harus_true,
  coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.prompter_invoices')),false) as rls_invoice_harus_true,
  (select count(*) from pg_policies where schemaname='public' and tablename='prompter_invoices' and policyname='Lihat invoice tenant sendiri' and cmd='SELECT') as policy_invoice_harus_1,
  (select count(distinct c.relname) from pg_depend d join pg_rewrite w on w.oid=d.objid join pg_class c on c.oid=w.ev_class where d.refobjid='public.prompter_invoices'::regclass and c.relname<>'prompter_invoices') as view_bergantung_harus_0,
  (select count(*) from public.prompter_payment_transactions t join public.prompter_invoices i on i.provider=t.provider and i.external_invoice_id=coalesce(t.provider_payment_id,t.id::text) where t.status='PAID') as invoice_bentrok_harus_0,
  (select count(*) from public.prompter_payment_transactions where status='PAID') as paid_info,
  (select count(*) from public.prompter_invoices) as invoice_total_info_harus_0,
  (select count(*) from public.prompter_payment_transactions t where t.status='PAID' and exists (select 1 from public.prompter_audit_logs a where a.resource_id::text=t.id::text and a.action='payment.succeeded')) as paid_dengan_audit_info,
  (select max(version) from supabase_migrations.schema_migrations) as versi_terakhir_info,
  (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.prompter_payment_transactions t) as txn_md5_catat,
  (select md5(coalesce(string_agg(t::text,'|' order by tenant_id),'')) from public.prompter_subscriptions t) as sub_md5_catat,
  (select md5(coalesce(string_agg(id::text,'|' order by id),'')) from public.prompter_invoices) as invoice_id_md5_catat,
  (select md5(coalesce(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid::regprocedure::text),'')) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname<>'fn_apply_verified_payment' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')) as fungsi_lain_md5_catat,
  (select md5(string_agg(c.oid::text||c.relname,'|' order by c.relname)) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','m','S')) as tabel_md5_catat,
  (select md5(coalesce(string_agg(c.relname||'.'||t.tgname,'|' order by c.relname,t.tgname),'')) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal) as trigger_md5_catat,
  (select md5(coalesce(string_agg(tablename||'.'||policyname||'.'||cmd||'.'||coalesce(qual,'')||'.'||coalesce(with_check,''),'|' order by tablename,policyname),'')) from pg_policies where schemaname='public') as policy_md5_catat;
