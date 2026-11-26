-- LOCAL-ONLY stub potongan Supabase yang disentuh Paket 3 (role, auth.uid, tenants, fn_current_tenant_id). Jangan pernah dijalankan ke Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create table public.tenants (id uuid primary key default gen_random_uuid(), nama_usaha text);
create table public.user_profiles (id uuid primary key, tenant_id uuid references public.tenants(id));
create function public.fn_current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('app.tenant', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
