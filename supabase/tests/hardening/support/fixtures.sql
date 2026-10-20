-- Synthetic fixtures (superuser). Nothing here resembles real customer data.
create function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ASSERTION FAILED: %', msg; end if; raise notice 'PASS: %', msg; end $$;
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
 ('b1000000-0000-4000-8000-0000000000b1','owner-b@example.invalid'),('c1000000-0000-4000-8000-0000000000c1','owner-c@example.invalid');
insert into user_profiles(id, tenant_id, nama, role) values
 ('a1000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-00000000000a','Owner A','owner'),
 ('a2000000-0000-4000-8000-0000000000a2','a0000000-0000-4000-8000-00000000000a','Member A','member'),
 ('b1000000-0000-4000-8000-0000000000b1','b0000000-0000-4000-8000-00000000000b','Owner B','owner'),
 ('c1000000-0000-4000-8000-0000000000c1','c0000000-0000-4000-8000-00000000000c','Owner C','owner');
insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end) values
 ('a0000000-0000-4000-8000-00000000000a','ACTIVE','STARTER',now()-interval '5 days',now()+interval '25 days'),
 ('b0000000-0000-4000-8000-00000000000b','TRIALING','FREE',now()-interval '4 days',now()+interval '10 days'),
 ('c0000000-0000-4000-8000-00000000000c','TRIALING','FREE',now()-interval '1 day',now()+interval '13 days');
insert into prompter_payment_transactions(id,tenant_id,provider,plan,amount) values
 ('a9000000-0000-4000-8000-0000000000a9','a0000000-0000-4000-8000-00000000000a','xendit','STARTER',99000);
insert into prompter_invoices(tenant_id,provider,external_invoice_id,status,amount,currency) values
 ('a0000000-0000-4000-8000-00000000000a','xendit','inv-fixture-a','PAID',99000,'IDR');
insert into prompter_webhook_events(tenant_id,source_system,external_event_id,event_type,status) values
 ('a0000000-0000-4000-8000-00000000000a','xendit','evt-fixture-a','payment','PROCESSED');
insert into prompter_audit_logs(tenant_id,actor_user_id,action,resource_type) values
 ('a0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-0000000000a1','fixture.event','fixture');

\ir snapshot.sql
