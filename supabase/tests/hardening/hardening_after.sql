\set ON_ERROR_STOP on
-- Executed after fixtures + migration(s). Roles are switched with SET ROLE and a JWT-claims GUC,
-- exactly how PostgREST presents a caller to the database.
\set A 'a0000000-0000-4000-8000-00000000000a'
\set B 'b0000000-0000-4000-8000-00000000000b'
\set C 'c0000000-0000-4000-8000-00000000000c'

-- ===== data untouched by the migration (no mass change of tenants/entitlements) =====
do $$ begin
  perform t_ok((select v from t_pre where k='subs') = (select md5(string_agg(t::text, '' order by tenant_id)) from prompter_subscriptions t),
    'existing subscription rows are byte-identical after the migration');
  perform t_ok((select v from t_pre where k='acl_other') = (select md5(string_agg(c.relname || coalesce(c.relacl::text,''), '|' order by c.relname))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r' and c.relname !~ '^t_'
      and c.relname not in ('prompter_subscriptions','prompter_payment_transactions','prompter_invoices','prompter_webhook_events','prompter_audit_logs')),
    'ACLs of every other table (tenants, user_profiles, all other prompter_*, i.e. no PUBLOE/UMKMpro/Apotek object) are unchanged');
end $$;

-- ===== NEGATIVE: Owner A (ACTIVE STARTER) =====
set role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}',false);
do $$ declare r text; begin
  r := t_try($q$update prompter_subscriptions set plan='BUSINESS' where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$);
  perform t_ok(r like '42501%', 'N1 Owner cannot UPGRADE STARTER->BUSINESS by direct UPDATE: ' || left(r,40));
  r := t_try($q$update prompter_subscriptions set status='ACTIVE', current_period_end = now() + interval '3000 days' where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$);
  perform t_ok(r like '42501%', 'N2 Owner cannot touch status/period by UPDATE');
  r := t_try($q$insert into prompter_payment_transactions(tenant_id,provider,plan,amount) values ('a0000000-0000-4000-8000-00000000000a','xendit','BUSINESS',1)$q$);
  perform t_ok(r like '42501%', 'N3 Owner cannot INSERT a forged payment transaction: ' || left(r,40));
  r := t_try($q$insert into prompter_payment_transactions(tenant_id,provider,plan,amount,activation_state,checkout_url) values ('a0000000-0000-4000-8000-00000000000a','xendit','STARTER',99000,'APPLIED','https://evil.example')$q$);
  perform t_ok(r like '42501%' or r like '42703%', 'N3b forged checkout columns (PR #44) also refused');
  perform t_ok(t_try('update prompter_payment_transactions set status=''PAID''') like '42501%', 'N3c Owner cannot UPDATE transactions');
  perform t_ok(t_try('delete from prompter_payment_transactions') like '42501%', 'N4a no DELETE on transactions');
  perform t_ok(t_try('truncate prompter_payment_transactions') like '42501%', 'N4b no TRUNCATE on transactions');
  perform t_ok(t_try('truncate prompter_invoices') like '42501%' and t_try('insert into prompter_invoices(tenant_id,provider,external_invoice_id,status,currency) values (''a0000000-0000-4000-8000-00000000000a'',''x'',''forged'',''PAID'',''IDR'')') like '42501%', 'N4c invoices: no TRUNCATE, no forged INSERT');
  perform t_ok(t_try('truncate prompter_webhook_events') like '42501%' and t_try('update prompter_webhook_events set status=''FAILED''') like '42501%', 'N4d webhook events: no TRUNCATE/UPDATE');
  perform t_ok(t_try('truncate prompter_audit_logs') like '42501%' and t_try('update prompter_audit_logs set action=''x''') like '42501%' and t_try('delete from prompter_audit_logs') like '42501%', 'N4e audit log: no TRUNCATE/UPDATE/DELETE');
end $$;
-- RPC abuse
do $$ declare r record; begin
  select * into r from fn_set_trial_plan_preference('BUSINESS');
  perform t_ok(r.out_ok = false and r.out_reason = 'NOT_TRIALING', 'N5 RPC refuses an ACTIVE paying tenant (' || r.out_reason || ')');
  perform t_ok((select plan from prompter_subscriptions where tenant_id = 'a0000000-0000-4000-8000-00000000000a') = 'STARTER', 'N5b plan still STARTER');
end $$;
-- cross tenant: Owner A sees/changes nothing of B
do $$ declare r text; begin
  r := t_try($q$update prompter_subscriptions set plan='PRO' where tenant_id='b0000000-0000-4000-8000-00000000000b'$q$);
  perform t_ok(r like '42501%', 'N6 Tenant A cannot UPDATE tenant B subscription (privilege)');
  perform t_ok((select count(*) from prompter_subscriptions where tenant_id <> 'a0000000-0000-4000-8000-00000000000a') = 0, 'N6b RLS: tenant A cannot even read B/C subscriptions');
  perform t_ok((select count(*) from prompter_payment_transactions where tenant_id <> 'a0000000-0000-4000-8000-00000000000a') = 0, 'N6c RLS: no foreign transactions visible');
  r := t_try($q$insert into prompter_audit_logs(tenant_id,actor_user_id,action,resource_type) values ('b0000000-0000-4000-8000-00000000000b',null,'forged.cross','x')$q$);
  perform t_ok(r like '42501%', 'N6d audit log cannot be written for another tenant: ' || left(r,30));
end $$;
-- POSITIVE for Owner A (existing flows keep working)
do $$ declare r text; begin
  perform t_ok((select count(*) from prompter_subscriptions) = 1, 'P6 Owner still reads own subscription');
  perform t_ok((select count(*) from prompter_payment_transactions) = 1 and (select count(*) from prompter_invoices) = 1 and (select count(*) from prompter_webhook_events) = 1, 'P6b Owner still reads own transactions/invoices/webhook events');
  r := t_try($q$insert into prompter_audit_logs(tenant_id,actor_user_id,action,resource_type) values ('a0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-0000000000a1','settings.updated','settings')$q$);
  perform t_ok(r = 'OK:1', 'P7 Owner can still write own-tenant audit log: ' || r);
end $$;
do $$ declare r record; begin
  select * into r from fn_schedule_cancellation(true);
  perform t_ok(r::text like '(t,%', 'P8 fn_schedule_cancellation still callable by Owner (' || r::text || ')');
end $$;
reset role;

-- ===== Member A (not owner) on A =====
set role authenticated;
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-0000000000a2","role":"authenticated"}',false);
do $$ declare r record; begin
  select * into r from fn_set_trial_plan_preference('PRO');
  perform t_ok(r.out_ok = false and r.out_reason in ('NOT_OWNER','NOT_TRIALING'), 'N7 non-owner refused by RPC (' || r.out_reason || ')');
end $$;
reset role;

-- ===== Owner B (TRIALING, 10 days left) =====
set role authenticated;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-0000000000b1","role":"authenticated"}',false);
do $$ declare r record; pe timestamptz; ps timestamptz; begin
  select current_period_end, current_period_start into pe, ps from prompter_subscriptions;
  select * into r from fn_set_trial_plan_preference('AGENCY');
  perform t_ok(r.out_ok = false and r.out_reason = 'PLAN_NOT_AVAILABLE', 'N9 COMING_SOON plan refused');
  select * into r from fn_set_trial_plan_preference('GOLD');
  perform t_ok(r.out_ok = false and r.out_reason = 'PLAN_UNKNOWN', 'N9b unknown plan refused');
  select * into r from fn_set_trial_plan_preference('PRO');
  perform t_ok(r.out_ok = true, 'P10 trialing Owner may still record a plan PREFERENCE through the RPC');
  perform t_ok((select plan from prompter_subscriptions) = 'PRO' and (select status from prompter_subscriptions) = 'TRIALING'
    and (select current_period_end from prompter_subscriptions) = pe and (select current_period_start from prompter_subscriptions) = ps,
    'P10b status stays TRIALING and the 14-day window is untouched');
  perform t_ok((select plan from prompter_subscriptions where tenant_id = 'a0000000-0000-4000-8000-00000000000a') is null, 'N6e (B cannot see A)');
end $$;
-- existing trial still valid: AI entitlement function (real one) still grants for a trialing tenant
do $$ declare r record; begin
  select * into r from fn_create_ai_job_if_entitled('CONTENT_GENERATION', '{}'::jsonb);
  perform t_ok(r.allowed = true, 'P5 existing trial tenant is still entitled (trial valid): ' || coalesce(r.reason,'ok'));
exception when others then
  perform t_ok(false, 'P5 AI entitlement call failed: ' || sqlerrm);
end $$;
reset role;
do $$ begin
  perform t_ok((select plan from prompter_subscriptions where tenant_id = 'a0000000-0000-4000-8000-00000000000a') = 'STARTER', 'N6f after all of B''s calls tenant A is still STARTER');
  perform t_ok((select plan from prompter_subscriptions where tenant_id = 'c0000000-0000-4000-8000-00000000000c') = 'FREE', 'N6g tenant C untouched');
end $$;

-- ===== anon =====
set role anon;
do $$ begin
  perform t_ok(t_try($q$update prompter_subscriptions set plan='BUSINESS'$q$) like '42501%', 'N8a anon cannot UPDATE subscriptions');
  perform t_ok(t_try($q$insert into prompter_payment_transactions(tenant_id,provider,plan,amount) values ('a0000000-0000-4000-8000-00000000000a','xendit','PRO',1)$q$) like '42501%', 'N8b anon cannot INSERT transactions');
  perform t_ok(t_try('truncate prompter_payment_transactions') like '42501%' and t_try('truncate prompter_invoices') like '42501%' and t_try('truncate prompter_webhook_events') like '42501%' and t_try('truncate prompter_audit_logs') like '42501%', 'N8c anon cannot TRUNCATE any billing table');
  perform t_ok(t_try($q$select * from fn_set_trial_plan_preference('PRO')$q$) like '42501%', 'N8d anon cannot execute the plan RPC');
end $$;
reset role;

-- ===== service-role: trusted paths keep working =====
set role service_role;
do $$ declare t uuid := gen_random_uuid(); x uuid; r record; e0 timestamptz; e1 timestamptz; begin
  perform t_ok(t_try($q$insert into prompter_payment_transactions(tenant_id,provider,plan,amount) values ('b0000000-0000-4000-8000-00000000000b','xendit','STARTER',99000)$q$) = 'OK:1', 'P1 service_role may create a transaction (trusted server path)');
  if to_regprocedure('public.fn_begin_checkout(uuid,uuid,text,numeric,text,text,text)') is not null then
    select * into r from fn_begin_checkout('c0000000-0000-4000-8000-00000000000c', null, 'STARTER', 99000, 'IDR', 'xendit', 'intent-hardening-1');
    perform t_ok(r.out_outcome = 'CREATED', 'P1b PR #44 fn_begin_checkout works for service_role');
  end if;
end $$;
reset role;

-- ===== verified payment still activates (v1 and, when present, PR #44 v2) and carries trial over =====
do $$ declare x uuid := gen_random_uuid(); r record; e timestamptz; d interval; begin
  -- tenant B: TRIALING with ~10 days left
  update prompter_subscriptions set plan='FREE' where tenant_id='b0000000-0000-4000-8000-00000000000b';
  insert into prompter_payment_transactions(id,tenant_id,provider,plan,amount) values (x,'b0000000-0000-4000-8000-00000000000b','xendit','STARTER',99000);
  select * into r from fn_apply_verified_payment(x, 'inv-h-b', 'ev-h-b', 99000, 'IDR');
  perform t_ok(r.allowed = true, 'P2 v1 webhook function activates after the hardening');
  select current_period_end into e from prompter_subscriptions where tenant_id='b0000000-0000-4000-8000-00000000000b';
  d := e - now();
  perform t_ok((select status||'/'||plan from prompter_subscriptions where tenant_id='b0000000-0000-4000-8000-00000000000b') = 'ACTIVE/STARTER', 'P2b subscription ACTIVE/STARTER');
  perform t_ok(d > interval '39 days' and d < interval '42 days', 'P3 unused trial (10 days) is added to the first paid month: ' || d);
  select * into r from fn_apply_verified_payment(x, 'inv-h-b', 'ev-h-b', 99000, 'IDR');
  perform t_ok((select current_period_end from prompter_subscriptions where tenant_id='b0000000-0000-4000-8000-00000000000b') = e, 'P3b replay does not add trial time again');
end $$;
do $$ declare x uuid := gen_random_uuid(); r record; e timestamptz; d interval; begin
  if to_regprocedure('public.fn_apply_payment_event(text,uuid,text,text,text,numeric,text,text)') is null then raise notice 'SKIP: PR #44 not present'; return; end if;
  insert into prompter_payment_transactions(id,tenant_id,provider,plan,amount) values (x,'c0000000-0000-4000-8000-00000000000c','xendit','STARTER',99000);
  select * into r from fn_apply_payment_event('xendit', x, 'inv-h-c', 'ev-h-c', 'PAID', 99000, 'IDR', 'WEBHOOK');
  perform t_ok(r.result_outcome = 'APPLIED', 'P2c PR #44 v2 webhook function activates after the hardening');
  select current_period_end into e from prompter_subscriptions where tenant_id='c0000000-0000-4000-8000-00000000000c'; d := e - now();
  perform t_ok(d > interval '43 days' and d < interval '45 days', 'P3c v2 path also carries the 13 unused trial days: ' || d);
  select * into r from fn_apply_payment_event('xendit', x, 'inv-h-c', 'ev-h-c2', 'PAID', 99000, 'IDR', 'WEBHOOK');
  perform t_ok(r.result_outcome = 'ALREADY_APPLIED' and (select current_period_end from prompter_subscriptions where tenant_id='c0000000-0000-4000-8000-00000000000c') = e, 'P3d v2 replay: no second carryover');
end $$;
do $$ declare x uuid := gen_random_uuid(); r record; e0 timestamptz; e1 timestamptz; begin
  -- renewal of the ACTIVE STARTER tenant A with 25 days left is not affected by the trigger
  select current_period_end into e0 from prompter_subscriptions where tenant_id='a0000000-0000-4000-8000-00000000000a';
  insert into prompter_payment_transactions(id,tenant_id,provider,plan,amount) values (x,'a0000000-0000-4000-8000-00000000000a','xendit','STARTER',99000);
  select * into r from fn_apply_verified_payment(x, 'inv-h-a', 'ev-h-a', 99000, 'IDR');
  select current_period_end into e1 from prompter_subscriptions where tenant_id='a0000000-0000-4000-8000-00000000000a';
  perform t_ok(r.allowed and e1 > e0, 'P4 renewal of an ACTIVE tenant still works (no trial carryover applied: ' || (e1 - e0) || ')');
end $$;
-- cap: trial longer than 14 days (only possible via a trusted writer) carries at most 14
do $$ declare t uuid := gen_random_uuid(); x uuid := gen_random_uuid(); e timestamptz; begin
  insert into tenants(id) values (t);
  insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end) values (t,'TRIALING','FREE',now(),now()+interval '60 days');
  insert into prompter_payment_transactions(id,tenant_id,provider,plan,amount) values (x,t,'xendit','STARTER',99000);
  perform * from fn_apply_verified_payment(x,'inv-cap','ev-cap',99000,'IDR');
  select current_period_end into e from prompter_subscriptions where tenant_id=t;
  perform t_ok(e - now() < interval '46 days', 'P3e carryover capped at 14 days: ' || (e - now()));
end $$;
-- expired trial: nothing carried
do $$ declare t uuid := gen_random_uuid(); x uuid := gen_random_uuid(); e timestamptz; begin
  insert into tenants(id) values (t);
  insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end) values (t,'TRIALING','FREE',now()-interval '20 days',now()-interval '6 days');
  insert into prompter_payment_transactions(id,tenant_id,provider,plan,amount) values (x,t,'xendit','STARTER',99000);
  perform * from fn_apply_verified_payment(x,'inv-exp','ev-exp',99000,'IDR');
  select current_period_end into e from prompter_subscriptions where tenant_id=t;
  perform t_ok(e - now() between interval '30 days' and interval '32 days', 'P3f expired trial carries nothing: ' || (e - now()));
end $$;

-- ===== new tenant bootstrap (getOrCreateSubscription) still works for an authenticated user =====
insert into tenants(id) values ('d0000000-0000-4000-8000-00000000000d');
insert into auth.users(id,email) values ('d1000000-0000-4000-8000-0000000000d1','owner-d@example.invalid');
insert into user_profiles(id,tenant_id,nama,role) values ('d1000000-0000-4000-8000-0000000000d1','d0000000-0000-4000-8000-00000000000d','Owner D','owner');
set role authenticated;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-0000000000d1","role":"authenticated"}',false);
do $$ declare r text; begin
  r := t_try($q$insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end) values ('d0000000-0000-4000-8000-00000000000d','TRIALING','FREE',now(),now()+interval '14 days')$q$);
  perform t_ok(r = 'OK:1', 'P9 new-tenant trial INSERT by the app (authenticated) still works: ' || r);
end $$;
reset role;

-- ===== SECURITY DEFINER hygiene of the new objects =====
do $$ begin
  perform t_ok((select prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%') from pg_proc where proname='fn_set_trial_plan_preference'), 'AUD new definer function pins search_path');
  perform t_ok(not has_function_privilege('anon','public.fn_set_trial_plan_preference(text)','EXECUTE') and has_function_privilege('authenticated','public.fn_set_trial_plan_preference(text)','EXECUTE'), 'AUD EXECUTE: authenticated only (plus service_role), never anon/public');
  perform t_ok(not has_column_privilege('authenticated','public.prompter_subscriptions','plan','UPDATE'), 'AUD authenticated has no UPDATE on any subscription column');
  perform t_ok(not exists (select 1 from pg_policies where tablename='prompter_payment_transactions' and cmd in ('INSERT','UPDATE','DELETE','ALL')), 'AUD no write policy left on payment transactions');
end $$;
