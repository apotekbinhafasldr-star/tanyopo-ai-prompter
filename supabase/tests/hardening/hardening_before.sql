\set ON_ERROR_STOP on
-- BEFORE the migration (main as-is): the holes exist. Each assertion proves a vulnerability.
set role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}',false);
do $$ begin
  perform t_ok(t_try($q$update prompter_subscriptions set plan='BUSINESS' where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$) = 'OK:1', 'HOLE-1 Owner upgraded ACTIVE STARTER->BUSINESS with no payment');
  perform t_ok(t_try($q$insert into prompter_payment_transactions(tenant_id,provider,plan,amount) values ('a0000000-0000-4000-8000-00000000000a','xendit','BUSINESS',1)$q$) = 'OK:1', 'HOLE-2 Owner inserted a forged amount=1 transaction');
  perform t_ok(t_try('truncate prompter_payment_transactions') = 'OK:0', 'HOLE-3 authenticated can TRUNCATE the transaction ledger (ignores RLS)');
  perform t_ok(t_try('truncate prompter_invoices') = 'OK:0' and t_try('truncate prompter_webhook_events') = 'OK:0' and t_try('truncate prompter_audit_logs') = 'OK:0', 'HOLE-3b ... and invoices, webhook events, audit logs');
end $$;
reset role;
set role anon;
do $$ begin
  perform t_ok(t_try('truncate prompter_payment_transactions') = 'OK:0', 'HOLE-4 even ANON (no login) can TRUNCATE the transaction table');
end $$;
reset role;
