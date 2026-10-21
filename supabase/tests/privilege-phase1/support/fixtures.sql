-- Synthetic fixtures (superuser). Nothing here resembles real customer data.
create function public.t_try(q text) returns text language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'OK:' || n;
exception when others then return sqlstate || ':' || sqlerrm; end $$;

insert into tenants(id, nama_usaha) values
 ('a0000000-0000-4000-8000-00000000000a','Tenant A (sintetis)'),
 ('b0000000-0000-4000-8000-00000000000b','Tenant B (sintetis)'),
 ('c0000000-0000-4000-8000-00000000000c','Tenant C (sintetis)');
insert into auth.users(id,email) values
 ('a1000000-0000-4000-8000-0000000000a1','owner-a@example.invalid'),('a2000000-0000-4000-8000-0000000000a2','member-a@example.invalid'),
 ('a3000000-0000-4000-8000-0000000000a3','marketing-a@example.invalid'),
 ('b1000000-0000-4000-8000-0000000000b1','owner-b@example.invalid'),('c1000000-0000-4000-8000-0000000000c1','owner-c@example.invalid');
insert into user_profiles(id, tenant_id, nama, role) values
 ('a1000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-00000000000a','Owner A','owner'),
 ('a2000000-0000-4000-8000-0000000000a2','a0000000-0000-4000-8000-00000000000a','Member A','member'),
 ('a3000000-0000-4000-8000-0000000000a3','a0000000-0000-4000-8000-00000000000a','Marketing A','marketing'),
 ('b1000000-0000-4000-8000-0000000000b1','b0000000-0000-4000-8000-00000000000b','Owner B','owner'),
 ('c1000000-0000-4000-8000-0000000000c1','c0000000-0000-4000-8000-00000000000c','Owner C','owner');
insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end) values
 ('a0000000-0000-4000-8000-00000000000a','ACTIVE','STARTER',now()-interval '5 days',now()+interval '25 days'),
 ('b0000000-0000-4000-8000-00000000000b','TRIALING','FREE',now()-interval '4 days',now()+interval '10 days'),
 ('c0000000-0000-4000-8000-00000000000c','TRIALING','FREE',now()-interval '1 day',now()+interval '13 days');
insert into prompter_payment_transactions(id,tenant_id,provider,plan,amount) values
 ('a9000000-0000-4000-8000-0000000000a9','a0000000-0000-4000-8000-00000000000a','xendit','STARTER',99000),
 ('b9000000-0000-4000-8000-0000000000b9','b0000000-0000-4000-8000-00000000000b','xendit','STARTER',99000);
insert into prompter_invoices(tenant_id,provider,external_invoice_id,status,amount,currency) values
 ('a0000000-0000-4000-8000-00000000000a','xendit','inv-fixture-a','PAID',99000,'IDR');
insert into prompter_webhook_events(tenant_id,source_system,external_event_id,event_type,status) values
 ('a0000000-0000-4000-8000-00000000000a','xendit','evt-fixture-a','payment','PROCESSED');
insert into prompter_audit_logs(tenant_id,actor_user_id,action,resource_type) values
 ('a0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-0000000000a1','fixture.event','fixture');
insert into prompter_ai_jobs(id,tenant_id,actor_user_id,job_type,status) values
 ('a8000000-0000-4000-8000-0000000000a8','a0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-0000000000a1','CONTENT_GENERATION','PROCESSING'),
 ('a8000000-0000-4000-8000-0000000000a9','a0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-0000000000a1','CONTENT_GENERATION','PROCESSING');
insert into prompter_jobs(id,tenant_id,job_type) values ('a7000000-0000-4000-8000-0000000000a7','a0000000-0000-4000-8000-00000000000a','AI_GENERATION');
insert into prompter_connected_accounts(id,tenant_id,platform,external_account_id) values
 ('a6000000-0000-4000-8000-0000000000a6','a0000000-0000-4000-8000-00000000000a','META','acct-fixture-a');
insert into prompter_oauth_credentials(tenant_id,connected_account_id,encrypted_access_token) values
 ('a0000000-0000-4000-8000-00000000000a','a6000000-0000-4000-8000-0000000000a6','FIXTURE-NOT-A-REAL-TOKEN');

-- privilege matrix helper: anon / authenticated / service_role x every table privilege that exists on this server
-- (MAINTAIN only from PostgreSQL 17), for every prompter_* table, plus the column-level UPDATE(plan) sentinel.
create function public.t_matrix() returns table(tbl text, role text, priv text, granted boolean) language sql stable as $$
  select c.relname::text, r.r, p.p, has_table_privilege(r.r, c.oid, p.p)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join (values ('anon'),('authenticated'),('service_role')) r(r)
    cross join (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                              || case when current_setting('server_version_num')::int >= 170000 then array['MAINTAIN'] else array[]::text[] end)) p(p)
   where c.relkind = 'r' and c.relname like 'prompter\_%'
  union all
  select 'prompter_subscriptions', 'authenticated', 'COLUMN_UPDATE_PLAN',
         has_column_privilege('authenticated', 'public.prompter_subscriptions', 'plan', 'UPDATE')
$$;

-- every column-level grant of every prompter_* table, one text entry each (grantee-qualified)
create function public.t_colacl() returns table(entry text) language sql stable as $$
  select c.relname || '.' || a.attname || ':' || case x.grantee when 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end || ':' || x.privilege_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid and c.relkind = 'r' and c.relname like 'prompter\_%'
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral aclexplode(a.attacl) x
   where a.attacl is not null and not a.attisdropped
$$;

-- scratch objects for the REFERENCES / TRIGGER probes (a client role may create tables here, never in public)
create schema t_scratch;
grant usage, create on schema t_scratch to authenticated;
create function public.t_noop() returns trigger language plpgsql as $$ begin return new; end $$;
grant execute on function public.t_noop() to public;

create table public.t_probe(name text primary key, role text, result text);
grant all on public.t_probe to public;
create function public.t_run(p_role text, p_sub text, p_name text, p_q text) returns void language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_sub is null then '{}' else json_build_object('sub', p_sub, 'role', p_role)::text end, false);
  if p_role <> 'cron' then execute format('set local role %I', p_role); end if;   -- 'cron' = run as the session (owner) user, like pg_cron does
  r := public.t_try(p_q);
  reset role;
  insert into public.t_probe values (p_name, p_role, r);
end $$;
