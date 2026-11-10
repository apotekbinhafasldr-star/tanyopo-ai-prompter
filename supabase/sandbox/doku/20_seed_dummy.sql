-- ============================================================================
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- 20 SEED DUMMY -- hanya data sintetis, hanya sandbox. Idempoten (aman diulang).
-- Dua tenant (A dan B) untuk uji isolasi tenant; masing-masing 1 owner + langganan trial FREE.
-- Membuat 2 auth.users dummy karena user_profiles merujuk auth.users (belum diverifikasi pada auth schema Supabase asli).
-- Jika 02_optional (trigger signup) terpasang, insert auth.users membuat tenant+profil otomatis; profil seed lalu di-upsert.
-- ============================================================================
begin;
do $guard$
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: marker sandbox tidak ada. Bukan project sandbox.';
  end if;
  if (select count(*) from public._linoe_sandbox_applied) <> 49 then
    raise exception 'ABORT: 49 migrasi belum lengkap tercatat.';
  end if;
end $guard$;

-- user_profiles.id merujuk auth.users: buat 2 pengguna dummy (email .invalid, tidak bisa login). Dihapus oleh 99_rollback.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000d0c0a11', 'authenticated', 'authenticated', 'seed-a@sandbox.invalid'),
  ('00000000-0000-4000-8000-00000d0c0b11', 'authenticated', 'authenticated', 'seed-b@sandbox.invalid')
on conflict (id) do nothing;
insert into public.tenants (id, nama_usaha) values
  ('00000000-0000-4000-8000-00000d0c0a01', 'SANDBOX Tenant A (dummy)'),
  ('00000000-0000-4000-8000-00000d0c0b01', 'SANDBOX Tenant B (dummy)')
on conflict (id) do nothing;
insert into public.user_profiles (id, tenant_id, nama, role) values
  ('00000000-0000-4000-8000-00000d0c0a11', '00000000-0000-4000-8000-00000d0c0a01', 'Owner A (dummy)', 'owner'),
  ('00000000-0000-4000-8000-00000d0c0b11', '00000000-0000-4000-8000-00000d0c0b01', 'Owner B (dummy)', 'owner')
on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'owner';
insert into public.prompter_subscriptions (tenant_id, plan, status, current_period_start, current_period_end, billing_provider) values
  ('00000000-0000-4000-8000-00000d0c0a01', 'FREE', 'TRIALING', now() - interval '1 day', now() + interval '13 days', null),
  ('00000000-0000-4000-8000-00000d0c0b01', 'FREE', 'TRIALING', now() - interval '1 day', now() + interval '13 days', null)
on conflict (tenant_id) do nothing;
commit;
