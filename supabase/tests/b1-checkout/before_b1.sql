-- LOCAL-ONLY: reproduces the hole on the production-shaped state BEFORE B1 (after #74).
\ir support/helpers.sql
select pg_temp.chk('BEFORE: an Owner can INSERT a PENDING transaction with amount 1 / any plan / any provider (the hole)',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000000a2',
   $$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','evil','BUSINESS',1,'IDR')$$) = 'ok:1');
select pg_temp.chk('BEFORE: a non-owner member is already blocked by RLS (so only Owners could exploit it)',
  pg_temp.dml_as('00000000-0000-0000-0000-0000000000a3',
   $$insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','evil','BUSINESS',1,'IDR')$$) like '42501:%');
select pg_temp.chk('BEFORE: authenticated holds the TRUNCATE privilege on the evidence table',
  has_table_privilege('authenticated','public.prompter_payment_transactions','TRUNCATE'));
delete from public.prompter_payment_transactions where provider = 'evil';
