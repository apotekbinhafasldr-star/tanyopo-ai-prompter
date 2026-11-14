-- ============================================================================
-- HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec
-- ============================================================================
-- UJI RLS LINTAS TENANT QA-2 -- BELUM DIJALANKAN oleh siapa pun. Dijalankan Founder NANTI di SQL Editor proyek QA,
-- hanya SETELAH bundel skema diterapkan dan butuh persetujuan terpisah. JANGAN di umkmpro-ai atau proyek lain.
--
-- Cara kerja: satu blok DO membuat dua pengguna uji (a/b @example.test) -> trigger signup QA membuat tenant A dan B ->
-- menanam satu baris per tabel inti untuk masing-masing -> beralih ke role `authenticated` sebagai pengguna A (klaim JWT) ->
-- memeriksa bahwa A TIDAK bisa membaca/menulis data B, dengan KONTROL POSITIF (A bisa membaca miliknya sendiri; mencegah
-- "lulus palsu" karena grant/klaim rusak). Di akhir blok SENGAJA melempar galat QA2_RLS_RESULT: transaksi dibatalkan, jadi semua
-- data uji (termasuk user Auth) tidak tersimpan. Hasil ada di pesan galat: "QA2_RLS_RESULT ALL_PASS | fails=0 | ..."
-- Tidak ada COMMIT, tidak ada DDL. Guard: butuh penanda QA2_SANDBOX_ONLY.
-- UNKNOWN: insert minimal ke auth.users (id, email) diterima proyek QA; belum dibuktikan (tidak dijalankan).
-- ============================================================================
do $qa2_rls$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  ta uuid;
  tb uuid;
  n int;
  ok boolean;
  fails int := 0;
  res text[] := '{}';
begin
  if to_regclass('public._linoe_sandbox_marker') is null
     or not exists (select 1 from public._linoe_sandbox_marker where purpose like 'QA2_SANDBOX_ONLY%') then
    raise exception 'ABORT: bukan proyek QA-2 (penanda QA2_SANDBOX_ONLY tidak ada). Berhenti.';
  end if;

  -- Seed sebagai pemilik (postgres). Trigger signup QA membuat tenants + user_profiles untuk tiap pengguna.
  insert into auth.users (id, email) values (ua, 'qa2-rls-a@example.test'), (ub, 'qa2-rls-b@example.test');
  select tenant_id into ta from public.user_profiles where id = ua;
  select tenant_id into tb from public.user_profiles where id = ub;
  if ta is null or tb is null or ta = tb then
    raise exception 'ABORT: seed gagal (trigger signup QA tidak membuat dua tenant berbeda).';
  end if;
  insert into public.prompter_brand_profiles (tenant_id, brand_name) values (ta, 'QA2 A'), (tb, 'QA2 B');
  insert into public.prompter_subscriptions (tenant_id, plan, status) values (ta, 'FREE', 'TRIALING'), (tb, 'FREE', 'TRIALING');
  insert into public.prompter_audit_logs (tenant_id, action, resource_type) values (ta, 'qa2.seed', 'test'), (tb, 'qa2.seed', 'test');

  -- Beralih menjadi pengguna A.
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ua::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- KONTROL POSITIF: A membaca miliknya sendiri.
  select count(*) into n from public.tenants where id = ta;                         ok := (n = 1); res := res || format('A_baca_tenant_sendiri=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  select count(*) into n from public.user_profiles where id = ua;                   ok := (n = 1); res := res || format('A_baca_profil_sendiri=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  select count(*) into n from public.prompter_brand_profiles where tenant_id = ta;  ok := (n = 1); res := res || format('A_baca_brand_sendiri=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;

  -- BACA lintas tenant: harus 0 baris.
  select count(*) into n from public.tenants where id = tb;                         ok := (n = 0); res := res || format('A_baca_tenant_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  select count(*) into n from public.user_profiles where tenant_id = tb;            ok := (n = 0); res := res || format('A_baca_profil_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  select count(*) into n from public.prompter_brand_profiles where tenant_id = tb;  ok := (n = 0); res := res || format('A_baca_brand_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  select count(*) into n from public.prompter_subscriptions where tenant_id = tb;   ok := (n = 0); res := res || format('A_baca_langganan_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  select count(*) into n from public.prompter_audit_logs where tenant_id = tb;      ok := (n = 0); res := res || format('A_baca_audit_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  select count(*) into n from public.prompter_invoices where tenant_id = tb;        ok := (n = 0); res := res || format('A_baca_invoice_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  select count(*) into n from public.prompter_analytics_insights where tenant_id = tb; ok := (n = 0); res := res || format('A_baca_insight_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;

  -- TULIS lintas tenant: harus ditolak RLS (SQLSTATE 42501). Hasil lain (berhasil / galat lain) = FAIL.
  begin
    insert into public.prompter_brand_profiles (tenant_id, brand_name) values (tb, 'HACK');
    ok := false;
  exception when sqlstate '42501' then ok := true; when others then ok := false;
  end;
  res := res || format('A_tulis_brand_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;

  begin
    insert into public.prompter_subscriptions (tenant_id, plan, status) values (tb, 'FREE', 'TRIALING');
    ok := false;
  exception when sqlstate '42501' then ok := true; when others then ok := false;
  end;
  res := res || format('A_tulis_langganan_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;

  begin
    insert into public.prompter_audit_logs (tenant_id, action, resource_type) values (tb, 'qa2.hack', 'test');
    ok := false;
  exception when sqlstate '42501' then ok := true; when others then ok := false;
  end;
  res := res || format('A_tulis_audit_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;

  -- UBAH tenant B: 0 baris terpengaruh (atau ditolak 42501).
  begin
    update public.tenants set nama_usaha = 'HACK' where id = tb;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when sqlstate '42501' then ok := true; when others then ok := false;
  end;
  res := res || format('A_ubah_tenant_B=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;

  -- ANON tanpa klaim: tidak boleh melihat tenant mana pun (0 baris atau ditolak 42501).
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    select count(*) into n from public.tenants;
    ok := (n = 0);
  exception when sqlstate '42501' then ok := true; when others then ok := false;
  end;
  res := res || format('anon_baca_tenants=%s', case when ok then 'PASS' else 'FAIL' end); if not ok then fails := fails + 1; end if;
  reset role;

  -- SENGAJA galat: membatalkan seluruh transaksi (data uji tidak tersimpan) sekaligus menampilkan hasil.
  raise exception 'QA2_RLS_RESULT % | fails=% | %', case when fails = 0 then 'ALL_PASS' else 'FAIL' end, fails, array_to_string(res, '; ')
    using errcode = 'P0001';
end
$qa2_rls$;
