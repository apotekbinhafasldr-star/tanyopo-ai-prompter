-- ============================================================================
-- 41_verify_p03_readonly.sql (T16)  -- SANDBOX DOKU SAJA
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- VERIFIKASI P0-3 (READ-ONLY, hanya SELECT). Menggantikan 30_ setelah T15 (30_ mengharapkan 49 migrasi).
-- DIBANGUN OTOMATIS oleh tools/build_p03_package.py dari supabase/migrations/20261111130000_prompter_p0_3_doku_alert_coverage.sql. Jangan diedit tangan.
-- ============================================================================
with
  sp as (select p.oid, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.oid = to_regprocedure('public.fn_sync_payment_alerts(interval)')),
  np as (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.fn_note_payment_alert_sync_failure(text)')),
  pubt as (select c.relname, c.relrowsecurity from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'),
  checks as (
    select 1 n, 'migrasi_tercatat' k, '50' e, (select count(*)::text from public._linoe_sandbox_applied) a
    union all select 2, 'versi_terakhir', '20261111130000', (select max(version) from public._linoe_sandbox_applied)
    union all select 3, 'sha256_tercatat_sama_dengan_berkas_repo', 'f6c1efecaec769c76470900dbd92d5256e2da1753386d3501dff81ad248b9976', (select sha256 from public._linoe_sandbox_applied where version = '20261111130000')
    union all select 4, 'badan_sync_md5_P0-3', 'dde5c5a74f68c890a5f123c7b57c016f', (select md5(prosrc) from sp)
    union all select 5, 'sync_hanya_midtrans_dan_doku', '1', (select (prosrc like '%source_system in (''midtrans'', ''doku'')%' and prosrc not like '%source_system = ''midtrans''%')::int::text from sp)
    union all select 6, 'badan_fn_note_tidak_berubah', '1a3eedfe67a0e5b6d0f33de9b14fa342', (select md5(prosrc) from np)
    union all select 7, 'sync_security_definer_search_path', '1', (select (prosecdef and proconfig::text like '%search_path=public, pg_temp%')::int::text from sp)
    union all select 8, 'acl_sync_service_role_saja', '1', (has_function_privilege('service_role', 'public.fn_sync_payment_alerts(interval)', 'execute')
      and not has_function_privilege('anon', 'public.fn_sync_payment_alerts(interval)', 'execute')
      and not has_function_privilege('authenticated', 'public.fn_sync_payment_alerts(interval)', 'execute'))::int::text
    union all select 9, 'acl_fn_note_service_role_saja', '1', (has_function_privilege('service_role', 'public.fn_note_payment_alert_sync_failure(text)', 'execute')
      and not has_function_privilege('anon', 'public.fn_note_payment_alert_sync_failure(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.fn_note_payment_alert_sync_failure(text)', 'execute'))::int::text
    union all select 10, 'tabel_alert_RLS_aktif', '4', (select count(*)::text from pubt where relrowsecurity and relname in ('prompter_payment_alerts','prompter_payment_alert_actions','prompter_payment_alert_evidence','prompter_payment_alert_sync_state'))
    union all select 11, 'tabel_alert_tanpa_policy', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('prompter_payment_alerts','prompter_payment_alert_actions','prompter_payment_alert_evidence','prompter_payment_alert_sync_state'))
    union all select 12, 'tabel_public_tanpa_RLS', '0', (select count(*)::text from pubt where not relrowsecurity)
    union all select 13, 'fungsi_definer_tanpa_search_path', '0', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') and coalesce(p.proconfig::text, '') not like '%search_path=%')
    union all select 14, 'pg_cron_job', '3', (case when to_regclass('cron.job') is null then 'cron.job_tidak_ada'
      else (xpath('/row/c/text()', query_to_xml('select count(*) as c from cron.job where jobname like ''prompter-%''', false, true, '')))[1]::text end)
    union all select 15, 'tak_ada_tabel_umkmpro', '0', (select count(*)::text from pubt where relname in (
      'products','product_batches','warehouses','warehouse_stock','inventory_movements','purchase_orders','transactions',
      'transaction_items','online_orders','pesanan_meja','receivables','employees','attendance','payroll_notes','kontrak_karyawan','leave_requests'))
  )
select n, k as pemeriksaan, e as diharapkan, a as aktual, case when e = a then 'PASS' else 'FAIL' end as status from checks
union all select 99, 'ALL_PASS', 'semua PASS', '', case when bool_and(e = a) then 'PASS' else 'FAIL' end from checks
order by n;
