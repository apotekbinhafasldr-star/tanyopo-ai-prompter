-- LOCAL-ONLY helpers (psql session scoped, pg_temp). Never run against Supabase.
\set ON_ERROR_STOP on
create or replace function pg_temp.chk(name text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;
-- run a DML/DDL statement as <role> (default authenticated) user <uid>; returns 'ok:<rows>' or '<sqlstate>:<message>'
create or replace function pg_temp.dml_as(uid text, stmt text, r_ text default 'authenticated') returns text language plpgsql as $$
declare r text; n int;
begin
  perform set_config('request.jwt.claims', case when uid is null then '{}' else json_build_object('sub',uid,'role',r_)::text end, true);
  execute format('set local role %I', r_);
  begin execute stmt; get diagnostics n = row_count; r := 'ok:' || n;
  exception when others then r := sqlstate || ':' || sqlerrm; end;
  reset role;
  return r;
end $$;
-- scalar query as <role> user <uid>
create or replace function pg_temp.q_as(uid text, stmt text, r_ text default 'authenticated') returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '{}' else json_build_object('sub',uid,'role',r_)::text end, true);
  execute format('set local role %I', r_);
  begin execute stmt into r; exception when others then r := sqlstate || ':' || sqlerrm; end;
  reset role;
  return r;
end $$;
create or replace function pg_temp.as_service(stmt text) returns text language plpgsql as $$
declare r text;
begin
  set local role service_role;
  begin execute stmt into r; exception when others then r := sqlstate || ':' || sqlerrm; end;
  reset role;
  return r;
end $$;
-- begin checkout as service_role; returns 'OUTCOME:amount'
create or replace function pg_temp.begin_co(t text, u text, p text, prov text default 'midtrans') returns text language plpgsql as $$
begin
  return pg_temp.as_service(format($q$select out_outcome || ':' || coalesce(out_amount::text,'-') from public.fn_begin_checkout(%L::uuid, %L::uuid, %L, %L)$q$, t, u, p, prov));
end $$;
