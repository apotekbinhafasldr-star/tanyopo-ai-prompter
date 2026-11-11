#!/usr/bin/env python3
"""Membangun paket P0-3 untuk SANDBOX DOKU saja: 40_ (T15 apply), 41_ (T16 verify, baca-saja), 42_ (T17 smoke, selalu rollback),
98_ (rollback manual). Isi migrasi disalin APA ADANYA dari supabase/migrations dan hash badan fungsi dihitung dari berkas repo,
sehingga tidak ada nilai yang diketik tangan. Pemakaian:  python3 tools/build_p03_package.py [--check]
--check: tidak menulis; gagal bila berkas di repo berbeda dari hasil bangun (dipakai tes lokal)."""
import hashlib, os, re, sys
here = os.path.dirname(os.path.abspath(__file__)); doku = os.path.dirname(here)
root = os.path.abspath(os.path.join(doku, "..", "..", ".."))
MIG = os.path.join(root, "supabase/migrations/20261111130000_prompter_p0_3_doku_alert_coverage.sql")
B41 = os.path.join(root, "supabase/migrations/20261031100000_prompter_b4_payment_alerts.sql")
DOWN = os.path.join(root, "supabase/rollback/20261111130000_prompter_p0_3_doku_alert_coverage.down.sql")
PART8 = os.path.join(doku, "10_migrations_part_8.sql")
VER = "20261111130000"; PREV_VER = "20261103170000"; REF = "eskqngzhtndkfqjoxxou"
rd = lambda p: open(p, encoding="utf-8").read()
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
md5 = lambda s: hashlib.md5(s.encode()).hexdigest()

def prosrc(sql, name):
    m = re.search(r"create or replace function public\." + name + r"\(.*?\bas \$\$(.*?)\$\$;", sql, re.S)
    assert m, name
    return m.group(1)

mig, b41, down = rd(MIG), rd(B41), rd(DOWN)
OLD_SYNC, NEW_SYNC = md5(prosrc(b41, "fn_sync_payment_alerts")), md5(prosrc(mig, "fn_sync_payment_alerts"))
NOTE, NOTE_NEW = md5(prosrc(b41, "fn_note_payment_alert_sync_failure")), md5(prosrc(mig, "fn_note_payment_alert_sync_failure"))
assert NOTE == NOTE_NEW and OLD_SYNC != NEW_SYNC and md5(prosrc(down, "fn_sync_payment_alerts")) == OLD_SYNC
MIG_SHA = sha(mig)
# daftar tabel UMKMpro dan pesan ABORT disalin dari guard bagian 8 (satu sumber kebenaran)
g = rd(PART8); gm = re.search(r"  if exists \(select 1 from information_schema\.tables where table_schema = 'public' and table_name in \(.*?\n  end if;", g, re.S)
assert gm; UMKM_GUARD = gm.group(0)

HDR = lambda no, title: f"""-- ============================================================================
-- {no}  -- SANDBOX DOKU SAJA
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref {REF} (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- {title}
-- DIBANGUN OTOMATIS oleh tools/build_p03_package.py dari supabase/migrations/{os.path.basename(MIG)}. Jangan diedit tangan.
-- ============================================================================
"""

PRE = f"""  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: marker sandbox tidak ada. Bukan project sandbox / 01_shim belum dijalankan.';
  end if;
{UMKM_GUARD}"""

STATE_OLD = f"""  -- PREFLIGHT DRIFT: keadaan harus persis keadaan acuan (T14). Selisih sekecil apa pun = berhenti, tidak ada yang berubah.
  if (select count(*) from public._linoe_sandbox_applied) <> 49
     or (select max(version) from public._linoe_sandbox_applied) <> '{PREV_VER}'
     or exists (select 1 from public._linoe_sandbox_applied where version = '{VER}') then
    raise exception 'ABORT: urutan/versi tidak sesuai (harus 49 migrasi, terakhir {PREV_VER}, P0-3 belum tercatat).';
  end if;
  if to_regclass('public.prompter_payment_alerts') is null or to_regclass('public.prompter_webhook_events') is null
     or to_regprocedure('public.fn_sync_payment_alerts(interval)') is null
     or to_regprocedure('public.fn_note_payment_alert_sync_failure(text)') is null then
    raise exception 'ABORT: objek B4.1 tidak lengkap.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.fn_sync_payment_alerts(interval)')) <> '{OLD_SYNC}' then
    raise exception 'ABORT: DRIFT. fn_sync_payment_alerts bukan badan B4.1 yang diaudit. Tidak ditimpa.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.fn_note_payment_alert_sync_failure(text)')) <> '{NOTE}' then
    raise exception 'ABORT: DRIFT. fn_note_payment_alert_sync_failure bukan badan B4.1 yang diaudit.';
  end if;
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.fn_sync_payment_alerts(interval)') and prosecdef
                   and proconfig::text like '%search_path=public, pg_temp%')
     or not has_function_privilege('service_role', 'public.fn_sync_payment_alerts(interval)', 'execute')
     or has_function_privilege('anon', 'public.fn_sync_payment_alerts(interval)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_sync_payment_alerts(interval)', 'execute') then
    raise exception 'ABORT: DRIFT pada keamanan/ACL fn_sync_payment_alerts.';
  end if;
"""

POST_NEW = f"""do $post$
begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.fn_sync_payment_alerts(interval)')) <> '{NEW_SYNC}' then
    raise exception 'ABORT: badan fn_sync_payment_alerts setelah migrasi tidak sesuai.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.fn_note_payment_alert_sync_failure(text)')) <> '{NOTE}' then
    raise exception 'ABORT: fn_note_payment_alert_sync_failure berubah.';
  end if;
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.fn_sync_payment_alerts(interval)') and prosecdef
                   and proconfig::text like '%search_path=public, pg_temp%')
     or not has_function_privilege('service_role', 'public.fn_sync_payment_alerts(interval)', 'execute')
     or has_function_privilege('anon', 'public.fn_sync_payment_alerts(interval)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_sync_payment_alerts(interval)', 'execute') then
    raise exception 'ABORT: ACL/keamanan fn_sync_payment_alerts setelah migrasi tidak sesuai.';
  end if;
end $post$;
"""

apply_sql = (HDR("40_p03_doku_alert_coverage.sql (T15)", "Menerapkan P0-3: fn_sync_payment_alerts v2 (midtrans + doku). Satu transaksi; gagal/drift = tidak ada yang berubah.")
  + "begin;\ndo $guard$\nbegin\n" + PRE + STATE_OLD + "end $guard$;\n\n"
  + f"-- >>> {os.path.basename(MIG)}  sha256={MIG_SHA}\n" + mig.rstrip("\n") + "\n\n" + POST_NEW
  + f"insert into public._linoe_sandbox_applied (version, sha256) values ('{VER}', '{MIG_SHA}');\n\ncommit;\n")

STATE_NEW = f"""  if (select count(*) from public._linoe_sandbox_applied) <> 50
     or (select max(version) from public._linoe_sandbox_applied) <> '{VER}' then
    raise exception 'ABORT: rollback hanya dari keadaan P0-3 (50 migrasi, terakhir {VER}).';
  end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.fn_sync_payment_alerts(interval)')) <> '{NEW_SYNC}' then
    raise exception 'ABORT: DRIFT. fn_sync_payment_alerts bukan badan P0-3. Tidak ditimpa.';
  end if;
"""
body_down = down[down.index("create or replace function public.fn_sync_payment_alerts"):]
rollback_sql = (HDR("98_rollback_p03_sandbox.sql (MANUAL, bukan bagian runner)", "Mengembalikan fn_sync_payment_alerts ke badan B4.1. Tidak menghapus data (alert yang sudah dibuat tetap).")
  + "begin;\nset local lock_timeout = '3s';\ndo $guard$\nbegin\n" + PRE + STATE_NEW + "end $guard$;\n\n"
  + body_down.rstrip("\n") + "\n\n"
  + f"""do $post$
begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.fn_sync_payment_alerts(interval)')) <> '{OLD_SYNC}' then
    raise exception 'ABORT: badan setelah rollback bukan B4.1.';
  end if;
end $post$;
delete from public._linoe_sandbox_applied where version = '{VER}';

commit;
""")

verify_sql = (HDR("41_verify_p03_readonly.sql (T16)", "VERIFIKASI P0-3 (READ-ONLY, hanya SELECT). Menggantikan 30_ setelah T15 (30_ mengharapkan 49 migrasi).")
  + f"""with
  sp as (select p.oid, p.prosrc, p.prosecdef, p.proconfig from pg_proc p where p.oid = to_regprocedure('public.fn_sync_payment_alerts(interval)')),
  np as (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.fn_note_payment_alert_sync_failure(text)')),
  pubt as (select c.relname, c.relrowsecurity from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'),
  checks as (
    select 1 n, 'migrasi_tercatat' k, '50' e, (select count(*)::text from public._linoe_sandbox_applied) a
    union all select 2, 'versi_terakhir', '{VER}', (select max(version) from public._linoe_sandbox_applied)
    union all select 3, 'sha256_tercatat_sama_dengan_berkas_repo', '{MIG_SHA}', (select sha256 from public._linoe_sandbox_applied where version = '{VER}')
    union all select 4, 'badan_sync_md5_P0-3', '{NEW_SYNC}', (select md5(prosrc) from sp)
    union all select 5, 'sync_hanya_midtrans_dan_doku', '1', (select (prosrc like '%source_system in (''midtrans'', ''doku'')%' and prosrc not like '%source_system = ''midtrans''%')::int::text from sp)
    union all select 6, 'badan_fn_note_tidak_berubah', '{NOTE}', (select md5(prosrc) from np)
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
""")

def S(i): return f"'00000000-0000-4000-8000-00000d0c{i}'"
smoke_sql = (HDR("42_smoke_doku_alert_rollback.sql (T17)", "TES ASAP alert DOKU (provider 'doku', data dummy). SELALU DIBATALKAN: blok DO di akhir sengaja memunculkan EXCEPTION berisi laporan.")
  + f"""-- Laporan muncul sebagai teks error:  "SMOKE_REPORT ... SMOKE_OVERALL=PASS" -> lulus.  Tidak ada panggilan jaringan ke DOKU.
do $smoke$
declare
  rep text := ''; ok_all boolean;
  te1 uuid := {S('e101')}; ue1 uuid := {S('e111')}; te2 uuid := {S('e201')}; ue2 uuid := {S('e211')};
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
  rep := rep || format(E'\\n%s S0 prasyarat: 4 transaksi PAID dibuat lewat fungsi resmi (n=%s)', case when n = 4 then 'PASS' else 'FAIL' end, n);
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
  rep := rep || format(E'\\n%s S1 sync #1: skipped=%s alarm_created=%s alert_total=%s (harus false/4/4: 3 DOKU + 1 Midtrans)', case when r.skipped is false and r.alarm_created = 4 and n = 4 then 'PASS' else 'FAIL' end, r.skipped, r.alarm_created, n);
  select string_agg(kind, ',' order by kind) into s1 from public.prompter_payment_alerts where transaction_id in (t1,t2,t3);
  rep := rep || format(E'\\n%s S2 DOKU: REFUND(t1) + REVERSAL(t2) + CHARGEBACK(t3), event kembar tidak menggandakan: %s', case when s1 = 'CHARGEBACK,REFUND,REVERSAL' then 'PASS' else 'FAIL' end, s1);
  select count(*) into n from public.prompter_payment_alerts where transaction_id = t3 and kind = 'REFUND';
  select count(*) into n2 from public.prompter_payment_alerts where transaction_id = t4 and kind = 'REFUND';
  rep := rep || format(E'\\n%s S3 provider tak tertukar: event midtrans pada txn DOKU=%s alert (harus 0); event doku pada txn Midtrans tetap hanya 1 alert dari event Midtrans=%s', case when n = 0 and n2 = 1 then 'PASS' else 'FAIL' end, n, n2);
  select count(*) into n from public.prompter_payment_alerts a join public.prompter_payment_transactions t on t.id = a.transaction_id
   where a.transaction_id in (t1,t2,t3,t4) and a.tenant_id = t.tenant_id and a.source = 'WEBHOOK_EVENT';
  select severity into s2 from public.prompter_payment_alerts where transaction_id = t3 and kind = 'CHARGEBACK';
  rep := rep || format(E'\\n%s S4 tenant dari baris transaksi (n=%s dari 4), chargeback=%s', case when n = 4 and s2 = 'CRITICAL' then 'PASS' else 'FAIL' end, n, s2);
  select * into r from public.fn_sync_payment_alerts(); select count(*) into n from public.prompter_payment_alerts where transaction_id in (t1,t2,t3,t4);
  rep := rep || format(E'\\n%s S5 sync #2 idempoten: alarm_created=%s alert_total=%s', case when r.alarm_created = 0 and n = 4 then 'PASS' else 'FAIL' end, r.alarm_created, n);
  select string_agg(tenant_id::text || status || plan, ',' order by tenant_id) into sub_after from public.prompter_subscriptions where tenant_id in (te1, te2);
  rep := rep || format(E'\\n%s S6 langganan tidak berubah oleh sync', case when sub_before = sub_after then 'PASS' else 'FAIL' end);
  rep := rep || format(E'\\n%s S7 ACL: anon/authenticated tak bisa execute sync, service_role bisa', case when
      not has_function_privilege('anon','public.fn_sync_payment_alerts(interval)','execute')
      and not has_function_privilege('authenticated','public.fn_sync_payment_alerts(interval)','execute')
      and has_function_privilege('service_role','public.fn_sync_payment_alerts(interval)','execute') then 'PASS' else 'FAIL' end);
  ok_all := position('FAIL' in rep) = 0;
  raise exception E'SMOKE_REPORT (rollback disengaja, tidak ada data tersimpan)%\\nSMOKE_OVERALL=%', rep, case when ok_all then 'PASS' else 'FAIL' end;
end $smoke$;
""")

OUT = {"40_p03_doku_alert_coverage.sql": apply_sql, "41_verify_p03_readonly.sql": verify_sql,
       "42_smoke_doku_alert_rollback.sql": smoke_sql, "98_rollback_p03_sandbox.sql": rollback_sql}
if "--check" in sys.argv:
    bad = [k for k, v in OUT.items() if not os.path.exists(os.path.join(doku, k)) or rd(os.path.join(doku, k)) != v]
    print("SAMA" if not bad else "BEDA: " + ",".join(bad)); sys.exit(1 if bad else 0)
for k, v in OUT.items(): open(os.path.join(doku, k), "w", encoding="utf-8").write(v)
print("ok", MIG_SHA, "old=" + OLD_SYNC, "new=" + NEW_SYNC, "note=" + NOTE)
