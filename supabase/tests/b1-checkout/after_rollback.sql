-- LOCAL-ONLY: state after the CONFIRMED B1 rollback = the previous behaviour (client insert path back), nothing worse.
\ir support/helpers.sql
select pg_temp.chk('ROLLED BACK: Owner insert path is back (legacy app code works again)',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000000a2',
   $$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','legacy','STARTER',99000,'IDR')$$) = 'ok:1');
select pg_temp.chk('ROLLED BACK: non-owner is still blocked by RLS',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000000a3',
   $$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','legacy','STARTER',99000,'IDR')$$) like '42501:%');
select pg_temp.chk('ROLLED BACK: UPDATE / DELETE / TRUNCATE remain closed',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000000a2', $$update public.prompter_payment_transactions set amount = 1$$) like '42501:%'
  and pg_temp.dml_as('00000000-0000-0000-0000-0000000000a2', $$delete from public.prompter_payment_transactions$$) like '42501:%'
  and pg_temp.dml_as('00000000-0000-0000-0000-0000000000a2', $$truncate public.prompter_payment_transactions$$) like '42501:%');
select pg_temp.chk('ROLLED BACK: #74 untouched (Owner still cannot UPDATE subscriptions)',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000000a2', $$update public.prompter_subscriptions set plan='BUSINESS'$$) like '42501:%');
delete from public.prompter_payment_transactions where provider = 'legacy';
