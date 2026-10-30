-- Rollback for 20261031100000_prompter_b4_payment_alerts.sql
-- Removes only the B4.1 alert objects. Fail-closed: refuses while ANY alert row exists (alerts and their history are
-- evidence about customer payments; export or keep them). Does not touch transactions, subscriptions, webhook events or audit logs.
set local lock_timeout = '3s';

do $$ begin
  if exists (select 1 from public.prompter_payment_alerts) or exists (select 1 from public.prompter_payment_alert_actions) or exists (select 1 from public.prompter_payment_alert_evidence) then
    raise exception 'rollback refused: prompter_payment_alerts / _actions / _evidence contain evidence rows. Export them first.';
  end if;
end $$;

drop function if exists public.fn_ack_payment_alert(uuid, uuid, text);
drop function if exists public.fn_resolve_payment_alert(uuid, uuid, text);
drop function if exists public.fn_sync_payment_alerts(interval);
drop function if exists public.fn_record_payment_alarm(uuid, text, jsonb, text);
drop function if exists public.fn_note_payment_alert_sync_failure(text);
drop function if exists public.fn_is_payment_operator(uuid);
drop table if exists public.prompter_payment_alert_evidence;
drop table if exists public.prompter_payment_alert_actions;
drop table if exists public.prompter_payment_alerts;
drop table if exists public.prompter_payment_alert_sync_state;
drop table if exists public.prompter_payment_operators;
drop function if exists public.fn_prompter_payment_alert_protect();
drop function if exists public.fn_prompter_payment_alert_actions_immutable();
