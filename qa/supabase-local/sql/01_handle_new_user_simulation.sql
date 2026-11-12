-- QA-1: SIMULASI trigger signup UMKMpro `handle_new_user` -- HANYA untuk Supabase lokal CI.
-- BUKAN salinan produksi. Definisi aslinya dimiliki UMKMpro AI dan tidak ada di repo ini (docs/DATABASE.md).
-- Perilaku yang disimulasikan (dari docs/DATABASE.md): tiap pengguna baru mendapat satu baris tenants + user_profiles (owner).
do $guard$
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: shim objek bersama belum terpasang; ini bukan basis data lokal QA';
  end if;
end $guard$;

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
