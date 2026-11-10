-- ============================================================================
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- 31 TES ASAP checkout -> pembayaran terverifikasi -> invoice -> langganan (provider 'doku', data dummy)
-- SELALU DIBATALKAN: blok DO di akhir sengaja memunculkan EXCEPTION berisi laporan, sehingga
-- transaksi di-rollback dan tidak ada data tertinggal. Laporan muncul sebagai teks error:
--   "SMOKE_REPORT ... SMOKE_OVERALL=PASS"  -> lulus.   Selain itu -> baca baris FAIL.
-- Fungsi dipanggil sebagai role editor (postgres); batasan ACL diperiksa lewat has_function_privilege.
-- Ini tes SQL jalur pembayaran, BUKAN tes DOKU (tanpa panggilan jaringan ke DOKU).
-- ============================================================================
do $smoke$
declare
  rep text := ''; ok_all boolean := true;
  tc uuid := '00000000-0000-4000-8000-00000d0c0c01'; uc uuid := '00000000-0000-4000-8000-00000d0c0c11';
  td uuid := '00000000-0000-4000-8000-00000d0c0d01'; ud uuid := '00000000-0000-4000-8000-00000d0c0d11';
  r record; txn uuid; txn2 uuid; amt numeric; n int; v_status text; v_plan text;
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: marker sandbox tidak ada. Bukan project sandbox.';
  end if;

  -- prompter_audit_logs.actor_user_id merujuk auth.users: pengguna dummy HARUS ada di auth.users (ikut di-rollback).
  insert into auth.users (id, aud, role, email) values
    (uc,'authenticated','authenticated','smoke-c@example.invalid'),(ud,'authenticated','authenticated','smoke-d@example.invalid');
  insert into public.tenants (id, nama_usaha) values (tc,'SMOKE C'),(td,'SMOKE D');
  -- 'on conflict' agar tetap benar bila trigger opsional handle_new_user (02) sudah terpasang dan membuat profil lebih dulu
  insert into public.user_profiles (id, tenant_id, nama, role) values (uc,tc,'owner c','owner'),(ud,td,'owner d','owner')
    on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'owner';
  insert into public.prompter_subscriptions (tenant_id, plan, status, current_period_start, current_period_end, billing_provider)
    values (tc,'FREE','TRIALING',now()-interval '1 day',now()+interval '13 days',null),
           (td,'FREE','TRIALING',now()-interval '1 day',now()+interval '13 days',null);

  -- T1 checkout dibuka, harga dari katalog DB (tanpa parameter jumlah)
  select * into r from public.fn_begin_checkout(tc, uc, 'STARTER', 'doku');
  txn := r.out_transaction_id; amt := r.out_amount;
  rep := rep || format(E'\n%s T1 checkout doku: outcome=%s amount=%s %s', case when r.out_outcome='CREATED' and amt>0 and r.out_currency='IDR' then 'PASS' else 'FAIL' end, r.out_outcome, amt, r.out_currency);
  -- T2 checkout kedua = idempoten (satu invoice terbuka per tenant)
  select * into r from public.fn_begin_checkout(tc, uc, 'STARTER', 'doku');
  rep := rep || format(E'\n%s T2 checkout ulang idempoten: outcome=%s same_txn=%s', case when r.out_outcome='EXISTING' and r.out_transaction_id=txn then 'PASS' else 'FAIL' end, r.out_outcome, (r.out_transaction_id=txn));
  -- T3 isolasi tenant: owner tenant D tidak boleh membuka checkout untuk tenant C
  select * into r from public.fn_begin_checkout(tc, ud, 'STARTER', 'doku');
  rep := rep || format(E'\n%s T3 isolasi tenant: outcome=%s', case when r.out_outcome='NOT_MEMBER' then 'PASS' else 'FAIL' end, r.out_outcome);
  -- T4 provider tak valid ditolak
  select * into r from public.fn_begin_checkout(tc, uc, 'STARTER', 'bad provider!');
  rep := rep || format(E'\n%s T4 provider tak valid: outcome=%s', case when r.out_outcome='INVALID' then 'PASS' else 'FAIL' end, r.out_outcome);
  -- T5 jumlah terverifikasi SALAH -> tidak aktif (REVIEW/mismatch)
  select * into r from public.fn_apply_verified_payment(txn, 'doku_pay_c1', 'doku_evt_c1', amt - 1, 'IDR');
  select status into v_status from public.prompter_subscriptions where tenant_id = tc;
  rep := rep || format(E'\n%s T5 jumlah salah tidak mengaktifkan: allowed=%s reason=%s sub_status=%s', case when r.allowed is false and v_status='TRIALING' then 'PASS' else 'FAIL' end, r.allowed, r.reason, v_status);
  -- T6 tenant D: bayar benar -> aktif + tepat 1 invoice
  select * into r from public.fn_begin_checkout(td, ud, 'STARTER', 'doku'); txn2 := r.out_transaction_id; amt := r.out_amount;
  select * into r from public.fn_apply_verified_payment(txn2, 'doku_pay_d1', 'doku_evt_d1', amt, 'IDR');
  select status, plan into v_status, v_plan from public.prompter_subscriptions where tenant_id = td;
  select count(*) into n from public.prompter_invoices where transaction_id = txn2;
  rep := rep || format(E'\n%s T6 pembayaran terverifikasi: allowed=%s sub=%s/%s invoice=%s', case when r.allowed and v_status='ACTIVE' and v_plan='STARTER' and n=1 then 'PASS' else 'FAIL' end, r.allowed, v_plan, v_status, n);
  -- T7 pengiriman ulang = ALREADY_PROCESSED, tidak menambah invoice
  select * into r from public.fn_apply_verified_payment(txn2, 'doku_pay_d1', 'doku_evt_d1', amt, 'IDR');
  select count(*) into n from public.prompter_invoices where transaction_id = txn2;
  rep := rep || format(E'\n%s T7 replay: reason=%s invoice=%s', case when r.reason='ALREADY_PROCESSED' and n=1 then 'PASS' else 'FAIL' end, r.reason, n);
  -- T8 mata uang salah ditolak
  select * into r from public.fn_begin_checkout(tc, uc, 'STARTER', 'doku');
  select * into r from public.fn_apply_verified_payment(coalesce(r.out_transaction_id, txn), 'doku_pay_c2', 'doku_evt_c2', amt, 'USD');
  rep := rep || format(E'\n%s T8 mata uang bukan IDR tidak mengaktifkan: allowed=%s reason=%s', case when r.allowed is false then 'PASS' else 'FAIL' end, r.allowed, r.reason);
  -- T9 transaksi tak dikenal
  select * into r from public.fn_apply_verified_payment('00000000-0000-4000-8000-0000deadbeef', 'x', 'y', 1, 'IDR');
  rep := rep || format(E'\n%s T9 transaksi tak dikenal: reason=%s', case when r.allowed is false and r.reason='TRANSACTION_NOT_FOUND' then 'PASS' else 'FAIL' end, r.reason);
  -- T10 ACL
  rep := rep || format(E'\n%s T10 ACL: anon/authenticated tak bisa execute, service_role bisa', case when
      not has_function_privilege('anon','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')
      and not has_function_privilege('authenticated','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')
      and not has_function_privilege('authenticated','public.fn_begin_checkout(uuid,uuid,text,text)','execute')
      and has_function_privilege('service_role','public.fn_begin_checkout(uuid,uuid,text,text)','execute') then 'PASS' else 'FAIL' end);

  ok_all := position('FAIL' in rep) = 0;
  raise exception E'SMOKE_REPORT (rollback disengaja, tidak ada data tersimpan)%\nSMOKE_OVERALL=%', rep, case when ok_all then 'PASS' else 'FAIL' end;
end $smoke$;
