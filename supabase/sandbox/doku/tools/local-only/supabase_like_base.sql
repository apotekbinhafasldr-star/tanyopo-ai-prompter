-- LOCAL-ONLY STUB. Meniru KERANGKA Supabase (role, schema auth/storage/cron) di PostgreSQL lokal sekali pakai.
-- BUKAN Supabase asli; kolom auth.users/storage.* disusun dari pengetahuan umum GoTrue/Storage, bukan dari project.
-- Dipakai hanya oleh tools/local_replay.sh. Tidak pernah dijalankan ke Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; create schema storage; create schema cron; create schema extensions;
create table auth.users (
  id uuid primary key default gen_random_uuid(), aud text, role text, email text, email_confirmed_at timestamptz,
  banned_until timestamptz, deleted_at timestamptz, raw_user_meta_data jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb) $$;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (n, s, c)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as
  $$ with d as (delete from cron.job where jobname = n returning 1) select exists (select 1 from d) $$;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
