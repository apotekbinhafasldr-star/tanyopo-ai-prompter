-- ============================================================================
-- HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec  --  QA-2 BAGIAN KE-4: GRANT MINIMAL
-- ============================================================================
-- Mengapa ada: proyek Supabase QA baru TIDAK memberi default privileges (grant otomatis) pada tabel yang dibuat migrasi.
-- Produksi/CI QA-1 memilikinya (CI: qa/ci/supabase-standin.sql memasang `alter default privileges ... grant all`), sehingga
-- verifikasi lolos di CI tetapi gagal di proyek QA nyata: service_role_access=f dan app_table_grants=f (run #4, 15 Nov 2026).
-- Berkas ini MENGGANTIKAN grant yang hilang itu SECARA MINIMAL (least privilege), bukan salinan ACL produksi (UNKNOWN).
--
-- ATURAN (dijaga tes tests/unit/qa/qa2-grants.test.ts dan CI qa2-schema-bundle-test.yml):
--   * Tanpa GRANT ALL, tanpa default privileges, tanpa ke anon/public, tanpa WITH GRANT OPTION.
--   * Tanpa ALTER POLICY / DISABLE RLS / FORCE RLS / ALTER TABLE: RLS tidak disentuh.
--   * authenticated TIDAK mendapat UPDATE/DELETE pada prompter_subscriptions (kunci migrasi P0 tetap berlaku).
--   * Tiap privilege authenticated punya policy RLS yang membolehkan perintah itu (CI memeriksa terhadap pg_policies).
--   * Idempotent: GRANT diulang tidak mengubah apa pun; tidak ada pelacak versi baru (15 migrasi tetap 15).
--   * Tidak mengulang migrasi. Satu transaksi; guard menolak bila bukan proyek sandbox QA-2.
-- Penerapan butuh persetujuan Founder: APPROVE QA-2-SCHEMA-GRANTS (mode `grants` di workflow qa-schema-apply).
-- Di luar daftar ini UNKNOWN: tabel/aksi lain yang mungkin dipakai aplikasi di luar alur signup, onboarding, dashboard, status trial.
-- ============================================================================
begin;

do $guard$
declare
  t text;
begin
  if to_regclass('public._linoe_sandbox_marker') is null
     or not exists (select 1 from public._linoe_sandbox_marker where id = 1 and purpose like 'QA2_SANDBOX_ONLY%') then
    raise exception 'ABORT: penanda sandbox QA-2 tidak ada. Ini BUKAN proyek QA-2. Berhenti.';
  end if;
  if (select count(*) from public._linoe_sandbox_applied) <> 15 then
    raise exception 'ABORT: bagian 1-3 (15 migrasi) belum lengkap. Jalankan bundel skema dulu.';
  end if;
  foreach t in array array[
    'tenants', 'user_profiles', 'prompter_subscriptions', 'prompter_brand_profiles', 'prompter_audit_logs',
    'prompter_analytics_insights', 'prompter_invoices', 'prompter_ai_jobs', 'prompter_attributions',
    'prompter_plan_entitlements', 'prompter_platform_capabilities'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'ABORT: tabel public.% tidak ada.', t;
    end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'ABORT: role authenticated/service_role tidak ada.';
  end if;
end $guard$;

grant usage on schema public to authenticated, service_role;

-- ---- authenticated: alur signup -> onboarding -> dashboard -> status trial. RLS tetap berlaku di setiap tabel. ----
grant select, insert, update on public.prompter_brand_profiles to authenticated;
grant select, insert on public.prompter_audit_logs to authenticated;
-- JANGAN tambah update/delete di sini: migrasi P0 (20261019100100, 20261029220000) sengaja mencabutnya.
grant select, insert on public.prompter_subscriptions to authenticated;
grant select on public.prompter_analytics_insights to authenticated;
grant select on public.prompter_invoices to authenticated;
grant select on public.prompter_ai_jobs to authenticated;
grant select on public.prompter_attributions to authenticated;
grant select on public.prompter_plan_entitlements to authenticated;
grant select on public.prompter_platform_capabilities to authenticated;

-- ---- service_role (klien admin QA, scripts/qa/qa-admin-client.mjs): baca trial dan reset identitas QA terkunci ----
grant select, delete on public.prompter_subscriptions to service_role;
grant delete on public.tenants to service_role;

notify pgrst, 'reload schema';

commit;
