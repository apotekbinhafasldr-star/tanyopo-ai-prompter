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
    union all select 6, 'policy_public_total', '71', (select count(*)::text from pg_policies where schemaname = 'public')
    union all select 7, 'fungsi_dikenal_ada_semua(58)', '58', (select count(distinct proname)::text from fnc where proname = any(array['fn_acct_bank_rec_guard','fn_acct_journal_balanced','fn_acct_journal_has_lines','fn_acct_line_postable','fn_acct_period_open','fn_ack_payment_alert','fn_activate_product','fn_apply_expired_subscriptions','fn_apply_scheduled_cancellations','fn_apply_verified_payment','fn_archive_product','fn_begin_checkout','fn_block_client_subscription_update','fn_claim_payment_notification_batch','fn_complete_payment_notification_batch','fn_consume_demo_ai_usage','fn_create_ai_job_if_entitled','fn_current_role','fn_current_tenant_id','fn_enforce_trial_subscription_insert','fn_expire_stale_payment_transactions','fn_fail_payment_notification_batch','fn_finance_admins_keep_super_admin','fn_finance_admins_no_escalation','fn_finance_audit','fn_finance_block_mutation','fn_finance_expense_guard','fn_guard_ai_job_delete','fn_guard_ai_job_immutable','fn_guard_ai_job_truncate','fn_guard_subscription_plan_availability','fn_is_payment_operator','fn_note_payment_alert_sync_failure','fn_payment_notification_budget_used','fn_payment_notification_recipient_ids','fn_payment_txn_insert_guard','fn_preview_payment_notifications','fn_prompter_manual_ad_metrics_audit','fn_prompter_manual_ad_metrics_guard','fn_prompter_payment_alert_actions_immutable','fn_prompter_payment_alert_protect','fn_prompter_payment_notification_batch_frozen','fn_prompter_payment_notification_immutable','fn_record_payment_alarm','fn_reserve_active_campaign_slot','fn_resolve_payment_alert','fn_resolve_review_payment','fn_schedule_cancellation','fn_set_trial_plan_preference','fn_subscription_trial_carryover','fn_sync_payment_alerts','fn_tax_opt_decision_guard','fn_tax_opt_refs_ok','prompter_claim_next_job','prompter_set_updated_at','tax_opt_effective_status','tax_opt_record_decision','tax_opt_verify_chain']))
    union all select 19, 'fungsi_tak_dikenal_di_public(selain_anggota_ekstensi/event_trigger)', '0', (select coalesce(string_agg(proname, ',' order by proname), '0') from fnc
      where not (proname = any(array['fn_acct_bank_rec_guard','fn_acct_journal_balanced','fn_acct_journal_has_lines','fn_acct_line_postable','fn_acct_period_open','fn_ack_payment_alert','fn_activate_product','fn_apply_expired_subscriptions','fn_apply_scheduled_cancellations','fn_apply_verified_payment','fn_archive_product','fn_begin_checkout','fn_block_client_subscription_update','fn_claim_payment_notification_batch','fn_complete_payment_notification_batch','fn_consume_demo_ai_usage','fn_create_ai_job_if_entitled','fn_current_role','fn_current_tenant_id','fn_enforce_trial_subscription_insert','fn_expire_stale_payment_transactions','fn_fail_payment_notification_batch','fn_finance_admins_keep_super_admin','fn_finance_admins_no_escalation','fn_finance_audit','fn_finance_block_mutation','fn_finance_expense_guard','fn_guard_ai_job_delete','fn_guard_ai_job_immutable','fn_guard_ai_job_truncate','fn_guard_subscription_plan_availability','fn_is_payment_operator','fn_note_payment_alert_sync_failure','fn_payment_notification_budget_used','fn_payment_notification_recipient_ids','fn_payment_txn_insert_guard','fn_preview_payment_notifications','fn_prompter_manual_ad_metrics_audit','fn_prompter_manual_ad_metrics_guard','fn_prompter_payment_alert_actions_immutable','fn_prompter_payment_alert_protect','fn_prompter_payment_notification_batch_frozen','fn_prompter_payment_notification_immutable','fn_record_payment_alarm','fn_reserve_active_campaign_slot','fn_resolve_payment_alert','fn_resolve_review_payment','fn_schedule_cancellation','fn_set_trial_plan_preference','fn_subscription_trial_carryover','fn_sync_payment_alerts','fn_tax_opt_decision_guard','fn_tax_opt_refs_ok','prompter_claim_next_job','prompter_set_updated_at','tax_opt_effective_status','tax_opt_record_decision','tax_opt_verify_chain']))
        and not exists (select 1 from pg_event_trigger et where et.evtfoid = fnc.oid)
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = fnc.oid and d.deptype = 'e'))
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
    union all select 18, 'user_profiles_FK_cascade_ke_auth.users_dan_tenants', '2', (select count(*)::text from pg_constraint
      where conrelid = to_regclass('public.user_profiles') and contype = 'f' and confdeltype = 'c')
    union all select 17, 'tak_ada_tabel_umkmpro', '0', (select count(*)::text from pubt where relname in (
      'products','product_batches','warehouses','warehouse_stock','inventory_movements','purchase_orders','transactions',
      'transaction_items','online_orders','pesanan_meja','receivables','employees','attendance','payroll_notes','kontrak_karyawan','leave_requests'))
  )
select n, k as pemeriksaan, e as diharapkan, a as aktual, case when e = a then 'PASS' else 'FAIL' end as status from checks
union all select 99, 'ALL_PASS', 'semua PASS', '', case when bool_and(e = a) then 'PASS' else 'FAIL' end from checks
order by n;
