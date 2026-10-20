\set ON_ERROR_STOP on
-- after migrate + down: v1 objects intact, v2 objects gone, v1 flow works
do $$
begin
  perform t_ok(to_regclass('public.prompter_payment_ledger') is null, 'rollback: ledger dropped');
  perform t_ok(to_regclass('public.prompter_payment_exceptions') is null, 'rollback: exceptions dropped');
  perform t_ok(to_regprocedure('public.fn_apply_payment_event(text,uuid,text,text,text,numeric,text,text)') is null, 'rollback: v2 apply dropped');
  perform t_ok(not exists (select 1 from information_schema.columns where table_name='prompter_payment_transactions' and column_name in ('intent_key','activation_state')), 'rollback: new columns dropped');
  perform t_ok(exists (select 1 from pg_proc where proname='fn_apply_verified_payment'), 'rollback: v1 apply still present');
end $$;
