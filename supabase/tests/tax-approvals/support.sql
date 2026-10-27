-- SYNTHETIC minimal stand-ins so the finance migrations can be applied to a throw-away database. Nothing real.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to service_role;

-- Production simulation (Supabase). In the real project the role that runs migrations has DEFAULT PRIVILEGES in schema public that
-- hand every new table, sequence and function to anon, authenticated and service_role (verified on umkmpro-ai: pg_default_acl).
-- A bare CREATE TABLE therefore starts wide open, and a migration must REVOKE explicitly. Without this, a throw-away database
-- starts closed and hides exactly that class of mistake. Applies to objects created by the current role from here on.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
