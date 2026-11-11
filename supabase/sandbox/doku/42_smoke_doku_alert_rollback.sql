-- ============================================================================
-- 42_smoke_doku_alert_rollback.sql (T17)  -- SANDBOX DOKU SAJA
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- TES ASAP alert DOKU (provider 'doku', data dummy). SELALU DIBATALKAN: blok DO di akhir sengaja memunculkan EXCEPTION berisi laporan.
-- DIBANGUN OTOMATIS oleh tools/build_p03_package.py dari supabase/migrations/20261111130000_prompter_p0_3_doku_alert_coverage.sql. Jangan diedit tangan.
-- ============================================================================
-- Laporan muncul sebagai teks error:  "SMOKE_REPORT ... SMOKE_OVERALL=PASS" -> lulus.  Tidak ada panggilan jaringan ke DOKU.
do $smoke$
declare
  rep text := ''; ok_all boolean;
  te1 uuid := '00000000-0000-4000-8000-00000d0ce101'; ue1 uuid := '00000000-0000-4000-8000-00000d0ce111'; te2 uuid := '00000000-0000-4000-8000-00000d0ce201'; ue2 uuid := '00000000-0000-4000-8000-00000d0ce211';
  r record; t1 uuid; t2 uuid; t3 uuid; t4 uuid; amt numeric; n int; n2 int; sub_before text; sub_after text; s1 text; s2 text; s3 text;
begin
  if to_regclass('public._linoe_sandbox_marker') is null then raise exception 'ABORT: marker sandbox tidak ada. Bukan project sandbox.'; end if;
  insert into auth.users (id, aud, role, email) values (ue1,'authenticated','authenticated','smoke-e1@example.invalid'),(ue2,'authenticated','authenticated','smoke-e2@example.invalid');
  insert into public.tenants (id, nama_usaha) values (te1,'SMOKE E1'),(te2,'SMOKE E2');
  insert into public.user_profiles (id, tenant_id, nama, role) values (ue1,te1,'owner e1','owner'),(ue2,te2,'owner e2','owner')
    on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'owner';
  insert into public.prompter_subscriptions (tenant_id, plan, status, current_period_start, current_period_end, billing_provider)
    values (te1,'FREE','TRIALING',now()-interval '1 day',now()+interval '13 days',null),(te2,'FREE','TRIALING',now()-interval '1 day',now()+interval '13 days',null);
  -- tiga transaksi DOKU PAID (dua tenant) + satu transaksi MIDTRANS PAID, semuanya lewat fungsi resmi (tanpa menulis status langsung)
  select * into r from public.fn_begin_checkout(te1, ue1, 'STARTER', 'doku'); t1 := r.out_transaction_id; amt := r.out_amount;
  perform public.fn_apply_verified_payment(t1, 'doku_pay_e1', 'doku_evt_e1', amt, 'IDR');
  select * into r from public.fn_begin_checkout(te1, ue1, 'STARTER', 'doku'); t2 := r.out_transaction_id;
  perform public.fn_apply_verified_payment(t2, 'doku_pay_e2', 'doku_evt_e2', amt, 'IDR');
  select * into r from public.fn_begin_checkout(te2, ue2, 'STARTER', 'doku'); t3 := r.out_transaction_id;
  perform public.fn_apply_verified_payment(t3, 'doku_pay_e3', 'doku_evt_e3', amt, 'IDR');
  select * into r from public.fn_begin_checkout(te2, ue2, 'STARTER', 'midtrans'); t4 := r.out_transaction_id;
  perform public.fn_apply_verified_payment(t4, 'mid_pay_e4', 'mid_evt_e4', amt, 'IDR');
  select count(*) into n from public.prompter_payment_transactions where id in (t1,t2,t3,t4) and status = 'PAID';
  rep := rep || format(E'\n%s S0 prasyarat: 4 transaksi PAID dibuat lewat fungsi resmi (n=%s)', case when n = 4 then 'PASS' else 'FAIL' end, n);
  select string_agg(tenant_id::text || status || plan, ',' order by tenant_id) into sub_before from public.prompter_subscriptions where tenant_id in (te1, te2);

  insert into public.prompter_webhook_events (source_system, external_event_id, event_type, payload, status, error) values
    ('doku','smk-refund-1','payment.refunded', jsonb_build_object('orderId', t1, 'evidenceRef', 'gw:doku:smoke:refund'), 'FAILED', 'ALARM_REFUND'),
    ('doku','smk-refund-1-resend','payment.refunded', jsonb_build_object('orderId', t1, 'evidenceRef', 'gw:doku:smoke:refund'), 'FAILED', 'ALARM_REFUND'),
    ('doku','smk-cb-1','payment.chargeback', jsonb_build_object('orderId', t3), 'FAILED', 'ALARM_CHARGEBACK'),
    ('doku','smk-rev-1','payment.reversal', jsonb_build_object('orderId', t2), 'FAILED', 'ALARM_REVERSAL'),
    ('doku','smk-doku-on-mid','payment.refunded', jsonb_build_object('orderId', t4), 'FAILED', 'ALARM_REFUND'),
    ('midtrans','smk-mid-on-doku','payment.refunded', jsonb_build_object('orderId', t3), 'FAILED', 'ALARM_REFUND'),
    ('doku','smk-unknown','payment.updated', jsonb_build_object('orderId', t3), 'FAILED', 'VERIFIED_STATUS_UNKNOWN'),
    ('midtrans','smk-mid-refund','payment.refunded', jsonb_build_object('orderId', t4), 'FAILED', 'ALARM_REFUND');
  select * into r from public.fn_sync_payment_alerts();
  select count(*) into n from public.prompter_payment_alerts where transaction_id in (t1,t2,t3,t4);
  rep := rep || format(E'\n%s S1 sync #1: skipped=%s alarm_created=%s alert_total=%s (harus false/4/4: 3 DOKU + 1 Midtrans)', case when r.skipped is false and r.alarm_created = 4 and n = 4 then 'PASS' else 'FAIL' end, r.skipped, r.alarm_created, n);
  select string_agg(kind, ',' order by kind) into s1 from public.prompter_payment_alerts where transaction_id in (t1,t2,t3);
  rep := rep || format(E'\n%s S2 DOKU: REFUND(t1) + REVERSAL(t2) + CHARGEBACK(t3), event kembar tidak menggandakan: %s', case when s1 = 'CHARGEBACK,REFUND,REVERSAL' then 'PASS' else 'FAIL' end, s1);
  select count(*) into n from public.prompter_payment_alerts where transaction_id = t3 and kind = 'REFUND';
  select count(*) into n2 from public.prompter_payment_alerts where transaction_id = t4 and kind = 'REFUND';
  rep := rep || format(E'\n%s S3 provider tak tertukar: event midtrans pada txn DOKU=%s alert (harus 0); event doku pada txn Midtrans tetap hanya 1 alert dari event Midtrans=%s', case when n = 0 and n2 = 1 then 'PASS' else 'FAIL' end, n, n2);
  select count(*) into n from public.prompter_payment_alerts a join public.prompter_payment_transactions t on t.id = a.transaction_id
   where a.transaction_id in (t1,t2,t3,t4) and a.tenant_id = t.tenant_id and a.source = 'WEBHOOK_EVENT';
  select severity into s2 from public.prompter_payment_alerts where transaction_id = t3 and kind = 'CHARGEBACK';
  rep := rep || format(E'\n%s S4 tenant dari baris transaksi (n=%s dari 4), chargeback=%s', case when n = 4 and s2 = 'CRITICAL' then 'PASS' else 'FAIL' end, n, s2);
  select * into r from public.fn_sync_payment_alerts(); select count(*) into n from public.prompter_payment_alerts where transaction_id in (t1,t2,t3,t4);
  rep := rep || format(E'\n%s S5 sync #2 idempoten: alarm_created=%s alert_total=%s', case when r.alarm_created = 0 and n = 4 then 'PASS' else 'FAIL' end, r.alarm_created, n);
  select string_agg(tenant_id::text || status || plan, ',' order by tenant_id) into sub_after from public.prompter_subscriptions where tenant_id in (te1, te2);
  rep := rep || format(E'\n%s S6 langganan tidak berubah oleh sync', case when sub_before = sub_after then 'PASS' else 'FAIL' end);
  rep := rep || format(E'\n%s S7 ACL: anon/authenticated tak bisa execute sync, service_role bisa', case when
      not has_function_privilege('anon','public.fn_sync_payment_alerts(interval)','execute')
      and not has_function_privilege('authenticated','public.fn_sync_payment_alerts(interval)','execute')
      and has_function_privilege('service_role','public.fn_sync_payment_alerts(interval)','execute') then 'PASS' else 'FAIL' end);
  ok_all := position('FAIL' in rep) = 0;
  raise exception E'SMOKE_REPORT (rollback disengaja, tidak ada data tersimpan)%\nSMOKE_OVERALL=%', rep, case when ok_all then 'PASS' else 'FAIL' end;
end $smoke$;
