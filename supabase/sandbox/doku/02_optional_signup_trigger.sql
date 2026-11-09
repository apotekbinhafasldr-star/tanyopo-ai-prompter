-- ============================================================================
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- 02 OPSIONAL (JANGAN dijalankan tanpa persetujuan Founder terpisah)
-- Hanya diperlukan bila E2E melewati UI aplikasi (login + sesi). Policy baca profil kini ada di 01. Jalur webhook /
-- checkout lewat server dapat diuji tanpa file ini memakai data dari 20_seed_dummy.sql.
-- ============================================================================
-- ASUMSI, BUKAN SALINAN PRODUCTION: handle_new_user asli (UMKMpro) tidak ada di repo.
-- Yang terdokumentasi (docs/DATABASE.md): trigger membuat satu baris tenants +
-- satu user_profiles untuk setiap auth.users baru, jenis_usaha 'lainnya' untuk
-- pendaftar langsung Promoter. Versi di bawah meniru perilaku terdokumentasi itu saja.
-- Ia memasang trigger pada auth.users di project SANDBOX (bukan production).
-- ============================================================================
begin;
do $guard$
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: marker sandbox tidak ada. Bukan project sandbox / shim belum dipasang.';
  end if;
end $guard$;

create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_tenant uuid;
begin
  insert into public.tenants (nama_usaha, jenis_usaha, email)
  values (coalesce(nullif(new.raw_user_meta_data ->> 'nama_usaha', ''), 'Sandbox ' || left(new.id::text, 8)), 'lainnya', new.email)
  returning id into v_tenant;
  insert into public.user_profiles (id, tenant_id, nama, role)
  values (new.id, v_tenant, coalesce(nullif(new.raw_user_meta_data ->> 'nama', ''), split_part(coalesce(new.email, 'user'), '@', 1)), 'owner');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
