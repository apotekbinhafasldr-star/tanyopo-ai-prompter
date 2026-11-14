-- ============================================================================
-- QA-2 SHIM OBJEK BERSAMA -- HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec
-- ============================================================================
-- PERINGATAN FIDELITAS: ini BUKAN salinan produksi dan TIDAK setara dengan UMKMpro AI.
-- Objek milik UMKMpro (public.tenants, public.user_profiles, fn_current_tenant_id(), fn_current_role(), handle_new_user())
-- tidak ada di repo ini (docs/DATABASE.md). Isi di bawah adalah SALINAN TERLABEL dari dua berkas yang sudah diuji CI QA-1:
--   * supabase/sandbox/doku/01_shim_shared_objects.sql  (tenants, user_profiles, fn_current_*, policy)
--   * qa/supabase-local/sql/01_handle_new_user_simulation.sql (handle_new_user + trigger signup)
-- Kesamaan isi dijaga tes (tests/unit/qa/qa2-schema-manifest.test.ts). Header DOKU sengaja TIDAK disalin agar tidak menyesatkan.
-- Masih TIDAK diketahui/berbeda dari produksi: ~30 kolom tenants lain, nilai default & CHECK role, policy admin platform,
-- trigger tambahan pada tenants, grant/ACL fungsi, badan asli handle_new_user.
-- Berkas ini TIDAK memuat BEGIN/COMMIT: pembungkus transaksi dipasang oleh scripts/qa/build-schema-bundle.mjs.
-- ============================================================================

-- GUARD fail-closed: hanya jalan di proyek BARU YANG KOSONG. Proyek bersama (umkmpro-ai) punya puluhan tabel public dan
-- pengguna, sehingga guard ini menghentikan seluruh bundel sebelum ada perubahan apa pun.
do $guard$
begin
  if (select count(*) from auth.users) <> 0 then
    raise exception 'ABORT: auth.users tidak kosong. Ini BUKAN proyek QA baru (mungkin proyek bersama/produksi). Berhenti.';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') then
    raise exception 'ABORT: schema public tidak kosong. Ini BUKAN proyek QA baru. Berhenti; jangan lanjutkan.';
  end if;
end $guard$;

-- penanda proyek QA + pelacak versi migrasi yang diterapkan bundel
create table public._linoe_sandbox_marker (
  id int primary key check (id = 1),
  purpose text not null,
  created_at timestamptz not null default now()
);
insert into public._linoe_sandbox_marker (id, purpose) values (1, 'QA2_SANDBOX_ONLY - bukan production, bukan setara UMKMpro');
alter table public._linoe_sandbox_marker enable row level security;

create table public._linoe_sandbox_applied (
  version text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
alter table public._linoe_sandbox_applied enable row level security;

-- SHIM tenants / user_profiles (kolom dari types/database.ts)
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  nama_usaha text not null,
  jenis_usaha text not null default 'lainnya',
  email text,
  logo_url text,
  created_at timestamptz not null default now()
);
create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  nama text not null,
  role text not null check (role in ('owner','apoteker','kasir','admin_gudang','hr','marketing')),
  created_at timestamptz not null default now()
);
alter table public.tenants enable row level security;
alter table public.user_profiles enable row level security;

create function public.fn_current_tenant_id() returns uuid
  language sql stable security definer set search_path = public as
  $$ select tenant_id from public.user_profiles where id = auth.uid() $$;
create function public.fn_current_role() returns text
  language sql stable security definer set search_path = public as
  $$ select role from public.user_profiles where id = auth.uid() $$;

create policy "Lihat tenant sendiri" on public.tenants for select to public
  using (id = public.fn_current_tenant_id());
create policy "Owner bisa edit data usaha sendiri" on public.tenants for update to authenticated
  using (id = public.fn_current_tenant_id() and public.fn_current_role() = 'owner')
  with check (id = public.fn_current_tenant_id());
create policy "sandbox: lihat profil satu tenant" on public.user_profiles for select to public
  using (tenant_id = public.fn_current_tenant_id());

-- SIMULASI trigger signup UMKMpro `handle_new_user`: tiap pengguna baru mendapat satu baris tenants + user_profiles (owner).
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  insert into public.tenants (nama_usaha, jenis_usaha, email)
  values (coalesce(nullif(new.raw_user_meta_data ->> 'nama_usaha', ''), 'QA Bisnis'),
          coalesce(nullif(new.raw_user_meta_data ->> 'jenis_usaha', ''), 'lainnya'), new.email)
  returning id into v_tenant;
  insert into public.user_profiles (id, tenant_id, nama, role)
  values (new.id, v_tenant, coalesce(nullif(new.raw_user_meta_data ->> 'nama', ''), 'QA'), 'owner');
  return new;
end $$;

drop trigger if exists qa_on_auth_user_created on auth.users;
create trigger qa_on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- TAMBAHAN KHUSUS QA-2: GRANT (TIDAK ada di shim CI QA-1) -- terbukti dari kode, bukan dari produksi
-- ============================================================================
-- Kode membaca user_profiles/tenants dengan sesi pengguna (role authenticated: services/session.ts, app/(app)/approvals)
-- dan memanggil rpc fn_current_tenant_id (features/onboarding/actions.ts). Proyek Supabase baru bisa tidak memberi grant
-- otomatis pada tabel baru (pengaturan "auto-expose" Data API); tanpa grant ini sesi QA gagal "permission denied" (FALSE FAIL)
-- yang tidak terjadi di produksi. Admin client QA (service_role) membaca tenants/user_profiles (services/umkmpro.ts, orkestrator
-- scripts/qa/real-e2e.mjs mencari tenant pengguna untuk membaca trial). Grant minimal: hanya SELECT/EXECUTE, tanpa anon, tanpa tulis.
-- RLS tetap berlaku untuk authenticated. Grant/ACL ASLI produksi tidak diketahui (UNKNOWN); ini bukan salinannya.
grant select on public.tenants, public.user_profiles to authenticated;
grant select on public.tenants, public.user_profiles to service_role;
grant execute on function public.fn_current_tenant_id() to authenticated;
grant execute on function public.fn_current_role() to authenticated;

-- ============================================================================
-- TAMBAHAN KHUSUS QA-2: RESET -- perilaku KHUSUS QA, TIDAK ada di produksi (di sana UNKNOWN)
-- ============================================================================
-- Masalah terbukti dari migrasi + kode: prompter_audit_logs.actor_user_id (dan approvals.requested_by/decided_by,
-- connected_accounts.connected_by, automation_settings.emergency_stop_activated_by) merujuk auth.users TANPA "on delete".
-- Onboarding menulis audit log dengan actor_user_id = user. Akibatnya Admin API deleteUser pada identitas QA yang sudah
-- onboarding GAGAL (FK), sehingga reset orkestrator (langkah 1 dan 11, scripts/qa/real-e2e.mjs) macet pada run kedua (FALSE FAIL).
-- Trigger ini menghapus tenant pengguna (cascade ke profil dan seluruh baris prompter_*) tepat sebelum user Auth dihapus,
-- hanya bila tenant itu tidak punya anggota lain. Tanpa trigger ini reset harus menghapus tenant lebih dulu (docs bagian 6).
create or replace function public.qa2_cleanup_on_auth_user_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  delete from public.tenants t
  where t.id in (select up.tenant_id from public.user_profiles up where up.id = old.id)
    and not exists (select 1 from public.user_profiles o where o.tenant_id = t.id and o.id <> old.id);
  return old;
end $$;
revoke all on function public.qa2_cleanup_on_auth_user_delete() from public, anon, authenticated;

drop trigger if exists qa2_before_auth_user_delete on auth.users;
create trigger qa2_before_auth_user_delete before delete on auth.users
  for each row execute function public.qa2_cleanup_on_auth_user_delete();
