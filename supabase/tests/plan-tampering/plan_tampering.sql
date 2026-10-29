-- LOCAL-ONLY regression test for 20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql.
-- psql variables: phase_after (true|false), rows_md5_before, others_md5_before. See run-local.sh.
-- Every check raises on failure (ON_ERROR_STOP); PASS lines are NOTICEs.
\set ON_ERROR_STOP on

create or replace function pg_temp.chk(name text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- run a DML statement as `authenticated` user <uid>; returns 'ok:<rows>' or '<sqlstate>:<message>'
create or replace function pg_temp.dml_as(uid text, stmt text) returns text language plpgsql as $$
declare r text; n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  set local role authenticated;
  begin execute stmt; get diagnostics n = row_count; r := 'ok:' || n;
  exception when others then r := sqlstate || ':' || sqlerrm; end;
  reset role;
  return r;
end $$;
-- run a scalar query as `authenticated` user <uid> (uid null = signed in without a user)
create or replace function pg_temp.q_as(uid text, stmt text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '{}' else json_build_object('sub',uid,'role','authenticated')::text end, true);
  set local role authenticated;
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
create or replace function pg_temp.cancel_flag(t text) returns boolean language sql as
  $$ select cancel_at_period_end from public.prompter_subscriptions where tenant_id = t::uuid $$;
create or replace function pg_temp.sub(t text) returns text language sql as
  $$ select plan || '/' || status from public.prompter_subscriptions where tenant_id = t::uuid $$;

-- ids
\set tA 00000000-0000-0000-0000-0000000000a1
\set tB 00000000-0000-0000-0000-0000000000b1
\set tP 00000000-0000-0000-0000-0000000000c1
\set tC 00000000-0000-0000-0000-0000000000d1
\set oA 00000000-0000-0000-0000-0000000000a2
\set mA 00000000-0000-0000-0000-0000000000a3
\set oB 00000000-0000-0000-0000-0000000000b2
\set oP 00000000-0000-0000-0000-0000000000c2
\set oC 00000000-0000-0000-0000-0000000000d2

-- existing rows and everything outside prompter_subscriptions
select pg_temp.chk('existing subscription rows (seeded BEFORE the migration) are identical afterwards: the migration is DDL only',
  (select md5(coalesce(string_agg(t::text, '|' order by tenant_id), '')) from (select tenant_id,plan,status,billing_provider,current_period_end from prompter_subscriptions) t) = :'rows_md5_before');
select pg_temp.chk('policies and grants of every OTHER table are unchanged (PUBLOE / UMKMpro / other tenants tables untouched)',
  (select md5(coalesce(string_agg(x, '|' order by x), '')) from (
     select 'pol:' || tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'') x from pg_policies where tablename <> 'prompter_subscriptions'
     union all
     select 'grant:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema='public' and table_name <> 'prompter_subscriptions'
  ) z) = :'others_md5_before');

-- ===== the attack: Owner changes the plan directly (REST PATCH == UPDATE as authenticated) =====
\if :phase_after
select pg_temp.chk('ACTIVE Owner: direct UPDATE of plan is denied', pg_temp.dml_as(:'oA', format('update prompter_subscriptions set plan=%L where tenant_id=%L','BUSINESS',:'tA'::text)) like '42501:%');
select pg_temp.chk('ACTIVE Owner: plan unchanged after the attempt', pg_temp.sub(:'tA') = 'STARTER/ACTIVE');
select pg_temp.chk('PAST_DUE Owner: direct UPDATE of plan is denied and plan unchanged',
  pg_temp.dml_as(:'oP', format('update prompter_subscriptions set plan=%L where tenant_id=%L','BUSINESS',:'tP'::text)) like '42501:%' and pg_temp.sub(:'tP') = 'PRO/PAST_DUE');
select pg_temp.chk('CANCELED Owner: direct UPDATE of plan is denied and plan unchanged',
  pg_temp.dml_as(:'oC', format('update prompter_subscriptions set plan=%L where tenant_id=%L','BUSINESS',:'tC'::text)) like '42501:%' and pg_temp.sub(:'tC') = 'PRO/CANCELED');
select pg_temp.chk('TRIALING Owner: direct UPDATE of plan is denied and plan unchanged',
  pg_temp.dml_as(:'oB', format('update prompter_subscriptions set plan=%L where tenant_id=%L','PRO',:'tB'::text)) like '42501:%' and pg_temp.sub(:'tB') = 'FREE/TRIALING');
select pg_temp.chk('TRIALING Owner cannot self-activate or extend the trial by direct UPDATE (status / period / provider columns)',
  pg_temp.dml_as(:'oB', format('update prompter_subscriptions set status=%L where tenant_id=%L','ACTIVE',:'tB'::text)) like '42501:%'
  and pg_temp.dml_as(:'oB', format('update prompter_subscriptions set current_period_end=now()+interval %L where tenant_id=%L','10 years',:'tB'::text)) like '42501:%'
  and pg_temp.dml_as(:'oB', format('update prompter_subscriptions set billing_provider=%L where tenant_id=%L','XENDIT',:'tB'::text)) like '42501:%'
  and pg_temp.sub(:'tB') = 'FREE/TRIALING');
select pg_temp.chk('non-Owner (marketing) cannot update either', pg_temp.dml_as(:'mA', format('update prompter_subscriptions set plan=%L where tenant_id=%L','BUSINESS',:'tA'::text)) like '42501:%');
select pg_temp.chk('Owner of tenant A cannot touch tenant B by direct UPDATE (denied, B unchanged)',
  pg_temp.dml_as(:'oA', format('update prompter_subscriptions set plan=%L where tenant_id=%L','BUSINESS',:'tB'::text)) like '42501:%' and pg_temp.sub(:'tB') = 'FREE/TRIALING');
select pg_temp.chk('anon has no UPDATE privilege on any column', not has_any_column_privilege('anon','public.prompter_subscriptions','UPDATE') and not has_any_column_privilege('authenticated','public.prompter_subscriptions','UPDATE'));
select pg_temp.chk('no client can DELETE or TRUNCATE subscriptions (TRUNCATE ignores RLS; it would wipe every tenant)',
  not has_table_privilege('authenticated','public.prompter_subscriptions','DELETE') and not has_table_privilege('authenticated','public.prompter_subscriptions','TRUNCATE')
  and not has_table_privilege('anon','public.prompter_subscriptions','DELETE') and not has_table_privilege('anon','public.prompter_subscriptions','TRUNCATE')
  and pg_temp.dml_as(:'oA','truncate prompter_subscriptions') like '42501:%'
  and (select count(*) from prompter_subscriptions) = 4);
select pg_temp.chk('SELECT still works: Owner sees only its own tenant row',
  pg_temp.q_as(:'oA', 'select count(*)::text from prompter_subscriptions') = '1');
\else
select pg_temp.chk('BEFORE (hole reproduced): ACTIVE Owner CAN set plan=BUSINESS through a direct UPDATE',
  pg_temp.dml_as(:'oA', format('update prompter_subscriptions set plan=%L where tenant_id=%L','BUSINESS',:'tA'::text)) = 'ok:1' and pg_temp.sub(:'tA') = 'BUSINESS/ACTIVE');
update prompter_subscriptions set plan='STARTER' where tenant_id=:'tA';
\endif

-- ===== the legitimate trial preference path =====
\if :phase_after
select pg_temp.chk('TRIALING Owner: RPC records the plan preference', pg_temp.q_as(:'oB', $$select out_ok::text||':'||coalesce(out_reason,'') from fn_set_trial_plan_preference('PRO')$$) = 'true:' and pg_temp.sub(:'tB') = 'PRO/TRIALING');
select pg_temp.chk('...and status stays TRIALING: the preference never activates anything', (select status from prompter_subscriptions where tenant_id=:'tB') = 'TRIALING' and (select billing_provider from prompter_subscriptions where tenant_id=:'tB') is null);
select pg_temp.chk('...and a TRIALING tenant with plan=PRO still gets only the FREE numbers (allowance 30, not 500) - no paid entitlement without verified payment',
  pg_temp.q_as(:'oB', $$select allowance::text from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb)$$) = '30');
select pg_temp.chk('...and an Owner can switch the trial preference back', pg_temp.q_as(:'oB', $$select out_ok::text from fn_set_trial_plan_preference('STARTER')$$) = 'true' and pg_temp.sub(:'tB') = 'STARTER/TRIALING');
select pg_temp.chk('ACTIVE Owner: RPC refused (NOT_TRIALING), plan unchanged', pg_temp.q_as(:'oA', $$select out_ok::text||':'||out_reason from fn_set_trial_plan_preference('BUSINESS')$$) = 'false:NOT_TRIALING' and pg_temp.sub(:'tA') = 'STARTER/ACTIVE');
select pg_temp.chk('PAST_DUE Owner: RPC refused (NOT_TRIALING), plan unchanged', pg_temp.q_as(:'oP', $$select out_reason from fn_set_trial_plan_preference('BUSINESS')$$) = 'NOT_TRIALING' and pg_temp.sub(:'tP') = 'PRO/PAST_DUE');
select pg_temp.chk('CANCELED Owner: RPC refused (NOT_TRIALING), plan unchanged', pg_temp.q_as(:'oC', $$select out_reason from fn_set_trial_plan_preference('BUSINESS')$$) = 'NOT_TRIALING' and pg_temp.sub(:'tC') = 'PRO/CANCELED');
select pg_temp.chk('non-Owner (marketing) of a tenant: RPC refused (NOT_OWNER)', pg_temp.q_as(:'mA', $$select out_reason from fn_set_trial_plan_preference('PRO')$$) = 'NOT_OWNER');
select pg_temp.chk('signed in without a user / no tenant: RPC refused', pg_temp.q_as(null, $$select out_reason from fn_set_trial_plan_preference('PRO')$$) = 'NOT_AUTHENTICATED'
  and pg_temp.q_as('00000000-0000-0000-0000-00000000ffff', $$select out_reason from fn_set_trial_plan_preference('PRO')$$) = 'NO_TENANT');
select pg_temp.chk('the RPC has no tenant parameter: tenant A Owner can only ever address tenant A (tenant B row untouched by it)',
  (select pronargs from pg_proc where proname='fn_set_trial_plan_preference') = 1 and pg_temp.sub(:'tB') = 'STARTER/TRIALING');
select pg_temp.chk('unknown, NULL and COMING_SOON plans are refused',
  pg_temp.q_as(:'oB', $$select out_reason from fn_set_trial_plan_preference('ENTERPRISE')$$) = 'PLAN_UNKNOWN'
  and pg_temp.q_as(:'oB', $$select coalesce(out_reason,'null') from fn_set_trial_plan_preference(null)$$) = 'PLAN_UNKNOWN'
  and pg_temp.q_as(:'oB', $$select out_reason from fn_set_trial_plan_preference('AGENCY')$$) = 'PLAN_NOT_AVAILABLE'
  and pg_temp.sub(:'tB') = 'STARTER/TRIALING');
select pg_temp.chk('RPC privileges: authenticated may execute, anon and public may not',
  has_function_privilege('authenticated','public.fn_set_trial_plan_preference(text)','EXECUTE')
  and not has_function_privilege('anon','public.fn_set_trial_plan_preference(text)','EXECUTE'));
select pg_temp.chk('RPC is SECURITY DEFINER with a pinned search_path',
  (select prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%') from pg_proc where proname='fn_set_trial_plan_preference'));
select pg_temp.chk('the client-update guard is SECURITY INVOKER (so definer payment paths are not affected)',
  (select not prosecdef from pg_proc where proname='fn_block_client_subscription_update'));
\endif

-- ===== the verified payment path still works (service_role -> SECURITY DEFINER) =====
select pg_temp.chk('webhook payment: TRIALING tenant becomes ACTIVE on the PAID plan',
  pg_temp.as_service($$select allowed::text from fn_apply_verified_payment('00000000-0000-0000-0000-0000000e0001','pay-1','evt-1',299000,'IDR')$$) = 'true' and pg_temp.sub(:'tB') = 'PRO/ACTIVE');
select pg_temp.chk('webhook payment: ACTIVE tenant upgrades to the PAID plan', pg_temp.as_service($$select allowed::text from fn_apply_verified_payment('00000000-0000-0000-0000-0000000e0002','pay-2','evt-2',799000,'IDR')$$) = 'true' and pg_temp.sub(:'tA') = 'BUSINESS/ACTIVE');
select pg_temp.chk('webhook payment: PAST_DUE tenant is re-activated by a verified payment', pg_temp.as_service($$select allowed::text from fn_apply_verified_payment('00000000-0000-0000-0000-0000000e0003','pay-3','evt-3',299000,'IDR')$$) = 'true' and pg_temp.sub(:'tP') = 'PRO/ACTIVE');
select pg_temp.chk('webhook redelivery is idempotent; a wrong amount is rejected and changes nothing',
  pg_temp.as_service($$select reason from fn_apply_verified_payment('00000000-0000-0000-0000-0000000e0001','pay-1','evt-1',299000,'IDR')$$) = 'ALREADY_PROCESSED'
  and pg_temp.sub(:'tB') = 'PRO/ACTIVE');
select pg_temp.chk('an authenticated user cannot call fn_apply_verified_payment', pg_temp.q_as(:'oA', $$select allowed::text from fn_apply_verified_payment('00000000-0000-0000-0000-0000000e0002','x','y',1,'IDR')$$) like '42501:%');
select pg_temp.chk('after a verified payment the paid plan numbers apply (tenant B: PRO allowance 500)',
  pg_temp.q_as(:'oB', $$select allowance::text from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb)$$) = '500');
select pg_temp.chk('PAST_DUE/CANCELED tenants never get paid numbers regardless of plan (unchanged B10 gate)',
  pg_temp.q_as(:'oC', $$select reason from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb)$$) = 'SUBSCRIPTION_CANCELED');

-- ===== other legitimate server paths keep working =====
select pg_temp.chk('Owner cancel-at-period-end (SECURITY DEFINER) still works', pg_temp.q_as(:'oA', $$select allowed::text from fn_schedule_cancellation(true)$$) = 'true'
  and pg_temp.cancel_flag(:'tA'));
update prompter_subscriptions set current_period_end = now() - interval '1 day' where tenant_id=:'tA';
select pg_temp.chk('scheduled-cancellation sweep (SECURITY DEFINER) still works', pg_temp.as_service('select public.fn_apply_scheduled_cancellations()::text') = '1' and pg_temp.sub(:'tA') = 'BUSINESS/CANCELED');
select pg_temp.chk('service_role may still maintain subscriptions directly (admin client)',
  pg_temp.as_service($$with u as (update prompter_subscriptions set tax_metadata='{}'::jsonb where tenant_id='00000000-0000-0000-0000-0000000000b1' returning 1) select count(*)::text from u$$) = '1');

-- ===== defense in depth: even if a policy/grant is re-added by mistake the trigger still blocks clients =====
\if :phase_after
begin;
create policy "mistaken re-add" on prompter_subscriptions for update using (true) with check (true);
grant update on prompter_subscriptions to authenticated;
select pg_temp.chk('DEFENSE IN DEPTH: with policy and UPDATE grant re-added, the trigger still rejects an Owner UPDATE',
  pg_temp.dml_as(:'oB', format('update prompter_subscriptions set plan=%L where tenant_id=%L','BUSINESS',:'tB'::text)) like '42501:%prompter_subscriptions cannot be updated directly%');
rollback;
\endif

select 'ALL PASS' as summary;
