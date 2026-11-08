do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth; create schema if not exists cron; create schema if not exists extensions;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb) $$;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function cron.schedule(name text, sched text, cmd text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(name text) returns boolean language sql as $$ select true $$;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- shared tables owned by sibling products (not in this repo); minimal stand-ins
create table public.tenants (id uuid primary key default gen_random_uuid(), nama_usaha text);
create table public.user_profiles (id uuid primary key, tenant_id uuid references public.tenants(id), nama text, role text);
create function public.fn_current_tenant_id() returns uuid language sql stable security definer set search_path=public as $$ select tenant_id from public.user_profiles where id = auth.uid() $$;
create function public.fn_current_role() returns text language sql stable security definer set search_path=public as $$ select role from public.user_profiles where id = auth.uid() $$;
-- stand-ins for shared tables of sibling products that PR #31's hardening migration references
-- (empty, synthetic; they exist only so that migration can be exercised)
create table public.ai_assistant_usage_log (id uuid primary key default gen_random_uuid(), tenant_id uuid, created_at timestamptz default now());
create table public.fitur_ai_usage_log (id uuid primary key default gen_random_uuid(), tenant_id uuid, created_at timestamptz default now());
