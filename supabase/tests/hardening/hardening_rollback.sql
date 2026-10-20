\set ON_ERROR_STOP on
-- After migrate + down: the previous behaviour is restored exactly (proves the rollback is real).
set role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}',false);
do $$ begin
  perform t_ok(t_try($q$update prompter_subscriptions set plan='BUSINESS' where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$) = 'OK:1', 'RB owner UPDATE plan is back (pre-hardening state restored)');
  perform t_ok(t_try($q$insert into prompter_payment_transactions(tenant_id,provider,plan,amount) values ('a0000000-0000-4000-8000-00000000000a','xendit','STARTER',99000)$q$) = 'OK:1', 'RB owner INSERT policy is back');
end $$;
reset role;
do $$ begin
  perform t_ok(to_regproc('public.fn_set_trial_plan_preference') is null and not exists (select 1 from pg_trigger where tgname='trg_prompter_subscriptions_trial_carryover'), 'RB new function and trigger removed');
end $$;
