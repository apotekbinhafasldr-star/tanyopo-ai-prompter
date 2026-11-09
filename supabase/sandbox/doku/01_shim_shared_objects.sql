-- ============================================================================
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- 01 SHIM OBJEK BERSAMA -- HANYA UNTUK SANDBOX PENGUJIAN PEMBAYARAN DOKU
-- ============================================================================
-- PERINGATAN KEJUJURAN: ini BUKAN salinan production dan TIDAK setara dengan
-- UMKMpro. Definisi asli public.tenants, public.user_profiles,
-- fn_current_tenant_id(), fn_current_role() dan handle_new_user() TIDAK ada di
-- repo ini (docs/DATABASE.md: dimiliki UMKMpro). Isi di bawah disusun HANYA dari:
--   (a) kolom di types/database.ts  (tenants, user_profiles),
--   (b) daftar role di docs/DATABASE.md (owner, apoteker, kasir, admin_gudang, hr, marketing),
--   (c) 2 policy tenants + isi fungsi yang tercatat di
--       supabase/tests/s1-trial-quota/support/prod_snapshot.sql (dibaca dari katalog
--       production 2026-10-10/19 oleh sesi sebelumnya; tidak bisa diverifikasi ulang di sini).
-- Dibandingkan dengan metadata production tersaring (2026-11-09; berkasnya TIDAK disimpan di repo):
-- FK user_profiles.id -> auth.users ON DELETE CASCADE, FK tenant_id ON DELETE CASCADE, policy UPDATE tenants
-- untuk role authenticated, dan policy SELECT user_profiles per tenant sudah disesuaikan.
-- Masih TIDAK sama/tidak diketahui: ~30 kolom tenants lain (tidak dipakai SQL repo), nilai default kolom
-- (mis. role), isi CHECK role, policy khusus admin platform dan fungsi pendukungnya, trigger tambahan pada tenants, badan
-- fungsi (sengaja dihilangkan dari metadata), grant dan ACL fungsi, badan handle_new_user.
-- Tujuan sempit: cukup agar jalur pembayaran (checkout -> invoice -> webhook ->
-- aktivasi) bisa diuji di DB terpisah. Jangan dipakai sebagai bukti kesetaraan.
-- ============================================================================
begin;

do $guard$
begin
  if (select count(*) from auth.users) <> 0 then
    raise exception 'ABORT: auth.users tidak kosong. Ini bukan project sandbox baru (mungkin linoe-otp-test). Berhenti.';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') then
    raise exception 'ABORT: schema public tidak kosong. Berhenti; jalankan 00_preflight_readonly.sql dan periksa.';
  end if;
end $guard$;

-- penanda sandbox + pelacak urutan migrasi (dipakai guard tiap bundel)
create table public._linoe_sandbox_marker (
  id int primary key check (id = 1),
  purpose text not null,
  created_at timestamptz not null default now()
);
insert into public._linoe_sandbox_marker (id, purpose) values (1, 'DOKU_SANDBOX_ONLY - bukan production, bukan setara UMKMpro');
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

-- 2 policy tenants sesuai catatan katalog production (prod_snapshot.sql)
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
-- user_profiles: baca profil dalam satu tenant (struktur dicocokkan dengan perbandingan metadata 2026-11-09).
-- Nama policy di sini milik sandbox; nama/isi produksi tidak disalin.
create policy "sandbox: lihat profil satu tenant" on public.user_profiles for select to public
  using (tenant_id = public.fn_current_tenant_id());

commit;
