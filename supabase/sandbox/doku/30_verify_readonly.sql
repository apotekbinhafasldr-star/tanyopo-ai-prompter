-- ============================================================================
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- 30 VERIFIKASI (READ-ONLY, hanya SELECT). Jalankan setelah 10_* bagian 8 selesai.
-- Angka "diharapkan" diukur dari replay lokal 49 migrasi + shim (PG16, stub Supabase) pada main a07942e.
-- Baris FAIL di Supabase asli = selisih yang HARUS dijelaskan (jangan diabaikan, jangan dipaksa PASS).
-- Baris terakhir ALL_PASS harus PASS.
-- ============================================================================
with
  pubt as (select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'),
  fnc as (select p.proname, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  idx as (select indexname from pg_indexes where schemaname = 'public'),
  checks as (
    select 1 n, 'migrasi_tercatat' k, '49' e, (select count(*)::text from public._linoe_sandbox_applied) a
    union all select 2, 'tabel_prompter', '47', (select count(*)::text from pubt where relname like 'prompter\_%')
    union all select 3, 'tabel_acct_finance_taxopt', '21', (select count(*)::text from pubt where relname ~ '^(acct|finance|tax_opt)_')
    union all select 4, 'tabel_public_total_(+tenants,user_profiles,2_penanda)', '72', (select count(*)::text from pubt)
    union all select 5, 'tabel_tanpa_RLS', '0', (select count(*)::text from pubt where not relrowsecurity)
    union all select 6, 'policy_public_total', '70', (select count(*)::text from pg_policies where schemaname = 'public')
    union all select 7, 'fungsi_public_total', '58', (select count(*)::text from fnc)
    union all select 8, 'fungsi_pembayaran_ada(3)', '3', (select count(*)::text from fnc where proname in ('fn_begin_checkout','fn_apply_verified_payment','fn_resolve_review_payment'))
    union all select 9, 'ACL_fungsi_pembayaran_hanya_service_role', 'true', (
      select (bool_and(not has_function_privilege('anon', oid, 'execute'))
          and bool_and(not has_function_privilege('authenticated', oid, 'execute'))
          and bool_and(has_function_privilege('service_role', oid, 'execute')))::text
        from fnc where proname in ('fn_begin_checkout','fn_apply_verified_payment','fn_resolve_review_payment'))
    union all select 10, 'klien_tak_bisa_tulis_transaksi_dan_invoice', 'true', (
      select (not (has_table_privilege('anon','public.prompter_payment_transactions','insert') or has_table_privilege('anon','public.prompter_payment_transactions','update') or has_table_privilege('anon','public.prompter_payment_transactions','delete')
              or has_table_privilege('authenticated','public.prompter_payment_transactions','insert') or has_table_privilege('authenticated','public.prompter_payment_transactions','update') or has_table_privilege('authenticated','public.prompter_payment_transactions','delete')
              or has_table_privilege('anon','public.prompter_invoices','insert') or has_table_privilege('anon','public.prompter_invoices','update') or has_table_privilege('anon','public.prompter_invoices','delete')
              or has_table_privilege('authenticated','public.prompter_invoices','insert') or has_table_privilege('authenticated','public.prompter_invoices','update') or has_table_privilege('authenticated','public.prompter_invoices','delete')))::text)
    union all select 11, 'ledger_tak_terbaca_anon_authenticated', 'true', (
      select (not has_table_privilege('anon','public.finance_ledger_entries','select') and not has_table_privilege('authenticated','public.finance_ledger_entries','select'))::text)
    union all select 12, 'indeks_unik_idempotensi(4)', '4', (select count(*)::text from idx where indexname in (
      'prompter_webhook_events_unique','prompter_payment_transactions_provider_payment_unique',
      'uq_prompter_payment_txn_one_pending_per_tenant','uq_prompter_invoices_transaction'))
    union all select 13, 'harga_plan_IDR_positif', '4', (select count(*)::text from public.prompter_plan_prices where currency = 'IDR' and price_idr > 0)
    union all select 14, 'storage_bucket', '4', (select count(*)::text from storage.buckets where id in ('product-media','creative-assets','brand-assets','generated-content'))
    union all select 15, 'pg_cron_job', '3', (case when to_regclass('cron.job') is null then 'cron.job_tidak_ada'
      else (xpath('/row/c/text()', query_to_xml('select count(*) as c from cron.job where jobname like ''prompter-%''', false, true, '')))[1]::text end)
    union all select 16, 'marker_sandbox', '1', (select count(*)::text from public._linoe_sandbox_marker)
    union all select 17, 'tak_ada_tabel_umkmpro', '0', (select count(*)::text from pubt where relname in (
      'products','product_batches','warehouses','warehouse_stock','inventory_movements','purchase_orders','transactions',
      'transaction_items','online_orders','pesanan_meja','receivables','employees','attendance','payroll_notes','kontrak_karyawan','leave_requests'))
  )
select n, k as pemeriksaan, e as diharapkan, a as aktual, case when e = a then 'PASS' else 'FAIL' end as status from checks
union all select 99, 'ALL_PASS', 'semua PASS', '', case when bool_and(e = a) then 'PASS' else 'FAIL' end from checks
order by n;
