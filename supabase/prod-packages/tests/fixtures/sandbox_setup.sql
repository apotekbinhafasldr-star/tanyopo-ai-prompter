-- SANDBOX ONLY (PostgreSQL sementara di CI/lokal; BUKAN Supabase): peran + stub storage + tabel fiktif untuk fixture fx-n.
-- Pemilik meniru Supabase secara kasar: storage.* milik supabase_storage_admin, objek public milik sb_owner. Nama "CANARY_*" = objek
-- "pihak lain" yang TIDAK boleh muncul di log publik runner.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'sb_owner') then create role sb_owner nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'linoe_migrator') then create role linoe_migrator login nosuperuser password 'rh_migrator_pw_4c7'; end if;
  if not exists (select 1 from pg_roles where rolname = 'linoe_member') then create role linoe_member login nosuperuser password 'rh_member_pw_5d8' in role supabase_storage_admin, sb_owner; end if;
end $$;

create schema storage authorization supabase_storage_admin;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter function storage.foldername(text) owner to supabase_storage_admin;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
  ('fx-reserved-1', 'fx-reserved-1', true, 1048576, array['image/png']), ('fx-reserved-2', 'fx-reserved-2', true, 2097152, array['image/jpeg']),
  ('fx-live', 'fx-live', true, 5242880, array['image/png']), ('canary-other-bucket-zq81', 'canary-other-bucket-zq81', true, 10, null);
grant usage on schema storage to anon, authenticated, service_role, sb_owner;
grant select, insert, update, delete, truncate on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create function public.fn_fx_current_tenant() returns uuid language sql stable as $$ select nullif(current_setting('app.tenant', true), '')::uuid $$;
alter function public.fn_fx_current_tenant() owner to sb_owner;
create table public.fx_audit_logs (id bigserial primary key, tenant_id uuid, action text, created_at timestamptz default now());
create table public.fx_evidence (id serial primary key, created_at timestamptz default now());
insert into public.fx_audit_logs(action) values ('a'), ('b');
insert into public.fx_evidence(created_at) values (now() - interval '2 days'), (now());
alter table public.fx_audit_logs owner to sb_owner;
alter table public.fx_evidence owner to sb_owner;
grant all on public.fx_audit_logs to service_role;
grant select on public.fx_audit_logs to authenticated;
grant usage on schema public to anon, authenticated, service_role, sb_owner, linoe_migrator;
grant create on schema public to sb_owner;
create table public.canary_other_tbl_zq81 (id int);
create function public.fn_canary_other_zq81() returns int language sql as $$ select 1 $$;

create policy "FX tenant all" on storage.objects for all
  using (bucket_id in ('fx-live', 'fx-reserved-1', 'fx-reserved-2') and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text)
  with check (bucket_id in ('fx-live', 'fx-reserved-1', 'fx-reserved-2') and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text);
create policy "CANARY_OTHER_POLICY_zq81" on storage.objects for select to authenticated using (bucket_id = 'canary-other-bucket-zq81');

create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[], created_by text);
insert into supabase_migrations.schema_migrations(version, name) values ('20261103170000', 'p0_2');
grant usage on schema supabase_migrations to sb_owner;
grant select, insert on supabase_migrations.schema_migrations to sb_owner;
