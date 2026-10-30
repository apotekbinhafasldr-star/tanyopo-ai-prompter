-- LOCAL-ONLY regression test for 20261030100100_prompter_b1_trial_remainder_carryover.sql (applied after B1 part 1).
\ir support/helpers.sql
insert into tenants(id,nama_usaha) values
  ('00000000-0000-0000-0000-000000000a11','T1 13d left'),('00000000-0000-0000-0000-000000000a12','T2 expired trial'),('00000000-0000-0000-0000-000000000a13','T3 30d left'),('00000000-0000-0000-0000-000000000a14','T4 active renewal');
insert into user_profiles values
  ('00000000-0000-0000-0000-000000000a21','00000000-0000-0000-0000-000000000a11','o1','owner'),('00000000-0000-0000-0000-000000000a22','00000000-0000-0000-0000-000000000a12','o2','owner'),
  ('00000000-0000-0000-0000-000000000a23','00000000-0000-0000-0000-000000000a13','o3','owner'),('00000000-0000-0000-0000-000000000a24','00000000-0000-0000-0000-000000000a14','o4','owner');
insert into prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end,billing_provider) values
  ('00000000-0000-0000-0000-000000000a11','FREE','TRIALING',now()-interval '1 day',now()+interval '13 days',null),
  ('00000000-0000-0000-0000-000000000a12','FREE','TRIALING',now()-interval '20 days',now()-interval '6 days',null),
  ('00000000-0000-0000-0000-000000000a13','FREE','TRIALING',now(),now()+interval '30 days',null),
  ('00000000-0000-0000-0000-000000000a14','STARTER','ACTIVE',now()-interval '5 days',now()+interval '25 days','midtrans');

create or replace function pg_temp.pay(t text, u text, plan text, amt numeric, tag text) returns text language plpgsql as $$
declare v_id uuid; r text;
begin
  select out_transaction_id into v_id from public.fn_begin_checkout(t::uuid, u::uuid, plan, 'midtrans');
  r := pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment(%L::uuid,%L,%L,%s,'IDR')$q$, v_id, 'inv_'||tag, 'evt_'||tag, amt));
  return r || '|' || v_id;
end $$;
create or replace function pg_temp.end_(t text) returns timestamptz language sql as $$ select current_period_end from public.prompter_subscriptions where tenant_id = t::uuid $$;

create temp table t_pay as
  select 't1' tag, pg_temp.pay('00000000-0000-0000-0000-000000000a11','00000000-0000-0000-0000-000000000a21','STARTER',99000,'t1') r
  union all select 't2', pg_temp.pay('00000000-0000-0000-0000-000000000a12','00000000-0000-0000-0000-000000000a22','STARTER',99000,'t2')
  union all select 't3', pg_temp.pay('00000000-0000-0000-0000-000000000a13','00000000-0000-0000-0000-000000000a23','PRO',399000,'t3')
  union all select 't4', pg_temp.pay('00000000-0000-0000-0000-000000000a14','00000000-0000-0000-0000-000000000a24','STARTER',99000,'t4');
select pg_temp.chk('all four payments were accepted', (select count(*) from t_pay where r like 'true:|%') = 4);
select pg_temp.chk('trial with 13 days left: first payment is ACTIVE and ends ~1 month + 13 days from now (remainder kept)',
  pg_temp.end_('00000000-0000-0000-0000-000000000a11') between now() + interval '1 month' + interval '12 days 23 hours' and now() + interval '1 month' + interval '13 days 1 hour'
  and (select status from public.prompter_subscriptions where tenant_id = '00000000-0000-0000-0000-000000000a11') = 'ACTIVE');
select pg_temp.chk('an already-expired trial gets no carryover (exactly one paid month)',
  pg_temp.end_('00000000-0000-0000-0000-000000000a12') between now() + interval '1 month' - interval '1 hour' and now() + interval '1 month' + interval '1 hour');
select pg_temp.chk('carryover is capped at the 14-day trial length even if a trial row holds more',
  pg_temp.end_('00000000-0000-0000-0000-000000000a13') between now() + interval '1 month' + interval '13 days 23 hours' and now() + interval '1 month' + interval '14 days 1 hour');
select pg_temp.chk('an ACTIVE renewal is NOT extended by the trigger (no carryover outside TRIALING -> ACTIVE)',
  pg_temp.end_('00000000-0000-0000-0000-000000000a14') between now() + interval '1 month' - interval '1 hour' and now() + interval '1 month' + interval '1 hour');
create temp table t_replay as select pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment(%L::uuid,'inv_t1','evt_t1',99000,'IDR')$q$,
  (select id from public.prompter_payment_transactions where provider_payment_id = 'inv_t1'))) r;
select pg_temp.chk('a replayed webhook does not add the remainder a second time',
  (select r from t_replay) = 'true:ALREADY_PROCESSED'
  and pg_temp.end_('00000000-0000-0000-0000-000000000a11') < now() + interval '1 month' + interval '13 days 1 hour');
select pg_temp.chk('#74 intact after part 2: Owner still cannot UPDATE prompter_subscriptions',
  pg_temp.dml_as('00000000-0000-0000-0000-000000000a21', $$update public.prompter_subscriptions set current_period_end = now() + interval '10 years'$$) like '42501:%');
