-- Rollback for 20261101100000_prompter_b4_2_alert_notifications.sql
-- Removes only the B4.2 notification outbox. Fail-closed: refuses while any notification / batch / attempt row exists
-- (they are the audit trail of what was sent about customer payments; export them first). Roll this back BEFORE the B4.1 rollback
-- (the notifications reference prompter_payment_alerts). Does not touch any B4.1 object, transaction, subscription, webhook event or audit log.
set local lock_timeout = '3s';

do $$ begin
  if exists (select 1 from public.prompter_payment_alert_notifications)
     or exists (select 1 from public.prompter_payment_alert_notification_batches)
     or exists (select 1 from public.prompter_payment_alert_notification_attempts) then
    raise exception 'rollback refused: notification rows exist (audit trail). Export them first.';
  end if;
end $$;

drop function if exists public.fn_preview_payment_notifications();
drop function if exists public.fn_fail_payment_notification_batch(uuid, integer, text, integer, boolean, boolean);
drop function if exists public.fn_complete_payment_notification_batch(uuid, text);
drop function if exists public.fn_claim_payment_notification_batch(integer, integer, integer, interval, text);
drop function if exists public.fn_payment_notification_recipient_emails(uuid[]);
drop function if exists public.fn_payment_notification_recipient_ids();
drop table if exists public.prompter_payment_alert_notification_attempts;
drop table if exists public.prompter_payment_alert_notifications;
drop table if exists public.prompter_payment_alert_notification_batches;
drop table if exists public.prompter_payment_alert_notify_state;
drop function if exists public.fn_prompter_payment_notification_batch_frozen();
drop function if exists public.fn_prompter_payment_notification_immutable();
