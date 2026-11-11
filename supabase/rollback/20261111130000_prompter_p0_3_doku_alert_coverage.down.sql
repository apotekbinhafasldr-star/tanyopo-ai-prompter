-- Rollback for 20261111130000_prompter_p0_3_doku_alert_coverage.sql
-- Restores fn_sync_payment_alerts to the B4.1 body (Midtrans-only step (b)). Removes no data: alerts that were already created
-- for DOKU stay (they are evidence); only future syncs stop deriving DOKU webhook alarms. Direct fn_record_payment_alarm is unaffected.
set local lock_timeout = '3s';

create or replace function public.fn_sync_payment_alerts(p_lookback interval default interval '45 days')
returns table(skipped boolean, review_created integer, alarm_created integer, auto_resolved integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_review integer := 0;
  v_alarm integer := 0;
  v_auto integer := 0;
begin
  if p_lookback is null or p_lookback < interval '1 day' or p_lookback > interval '400 days' then
    raise exception 'p_lookback must be between 1 and 400 days';
  end if;

  -- Parallel runs: the loser returns immediately. Even without this lock the inserts below are conflict-safe.
  if not pg_try_advisory_xact_lock(hashtextextended('prompter_payment_alert_sync', 0)) then
    return query select true, 0, 0, 0;
    return;
  end if;

  -- (a) every transaction in REVIEW (trusted: only service_role functions write that status)
  with ins as (
    insert into public.prompter_payment_alerts (kind, severity, transaction_id, tenant_id, source, reason, evidence, first_seen_at)
    select 'REVIEW', 'HIGH', t.id, t.tenant_id, 'TXN_REVIEW', t.failure_reason,
           jsonb_build_object('amount', t.amount, 'currency', t.currency, 'plan', t.plan, 'provider', t.provider,
                              'provider_payment_id', t.provider_payment_id),
           coalesce(t.updated_at, now())
    from public.prompter_payment_transactions t
    where t.status = 'REVIEW'
    on conflict (transaction_id, kind) do nothing
    returning 1
  )
  select count(*) into v_review from ins;

  -- (b) server-written webhook events that the verified path marked ALARM_*. prompter_webhook_events has no tenant
  --     write policy and no tenant select match (tenant_id is null), so tenants cannot forge or even see these rows.
  --     The transaction is resolved from OUR OWN rows (payload.orderId, or the recorded provider payment id), never from
  --     a tenant-supplied value, and tenant_id comes from the transaction.
  with ev as (
    select distinct on (t.id, k.kind)
           t.id as txn_id, t.tenant_id, k.kind, e.external_event_id, e.received_at, e.error,
           -- the identity written by the verified webhook path (derived from the gateway's own answer); 'evt:' only for rows without it
           left(coalesce(nullif(e.payload ->> 'evidenceRef', ''), 'evt:' || e.external_event_id), 200) as ref
    from public.prompter_webhook_events e
    cross join lateral (
      select case e.error when 'ALARM_REFUND' then 'REFUND' when 'ALARM_CHARGEBACK' then 'CHARGEBACK'
                          when 'ALARM_REVERSAL' then 'REVERSAL' end as kind
    ) k
    join public.prompter_payment_transactions t
      on t.provider = e.source_system
     and (
          t.id = case when e.payload ->> 'orderId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then (e.payload ->> 'orderId')::uuid end
       or (t.provider_payment_id is not null and t.provider_payment_id = e.payload ->> 'externalPaymentId')
     )
    where e.source_system = 'midtrans'
      and e.error in ('ALARM_REFUND', 'ALARM_CHARGEBACK', 'ALARM_REVERSAL')
      and e.received_at >= now() - p_lookback
    order by t.id, k.kind, e.received_at
  ), ins as (
    insert into public.prompter_payment_alerts (kind, severity, transaction_id, tenant_id, source, reason, evidence, first_seen_at)
    select ev.kind, case when ev.kind = 'CHARGEBACK' then 'CRITICAL' else 'HIGH' end, ev.txn_id, ev.tenant_id,
           'WEBHOOK_EVENT', 'GATEWAY_' || ev.kind,
           jsonb_build_object('webhook_event_id', ev.external_event_id, 'webhook_error', ev.error), ev.received_at
    from ev
    on conflict (transaction_id, kind) do nothing
    returning id, transaction_id, kind
  ), reg as (
    -- a sync-created alert registers its event identity; an EXISTING alert is never touched (sync never reopens)
    insert into public.prompter_payment_alert_evidence (alert_id, evidence_ref, source, evidence)
    select ins.id, ev.ref, 'WEBHOOK_EVENT', jsonb_build_object('webhook_event_id', ev.external_event_id)
    from ins join ev on ev.txn_id = ins.transaction_id and ev.kind = ins.kind
    on conflict (alert_id, evidence_ref) do nothing
    returning 1
  )
  select count(*) into v_alarm from ins;

  -- (c) auto-resolve REVIEW alerts whose transaction is no longer in REVIEW (settled by the gateway-verified resolver)
  with res as (
    update public.prompter_payment_alerts a
       set state = 'RESOLVED', resolution = 'AUTO', resolved_at = now(), updated_at = now(),
           resolution_note = 'Transaksi tidak lagi REVIEW (status: ' || t.status || ').'
      from public.prompter_payment_transactions t
     where a.transaction_id = t.id and a.kind = 'REVIEW' and a.state <> 'RESOLVED' and t.status <> 'REVIEW'
    returning a.id, a.resolution_note
  ), hist as (
    insert into public.prompter_payment_alert_actions (alert_id, action, note)
    select res.id, 'AUTO_RESOLVE', res.resolution_note from res
    returning 1
  )
  select count(*) into v_auto from hist;

  update public.prompter_payment_alert_sync_state
     set last_attempt_at = now(), last_success_at = now(), last_error = null, consecutive_failures = 0,
         last_counts = jsonb_build_object('review_created', v_review, 'alarm_created', v_alarm, 'auto_resolved', v_auto)
   where id = 1;

  return query select false, v_review, v_alarm, v_auto;
end $$;

create or replace function public.fn_note_payment_alert_sync_failure(p_error text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.prompter_payment_alert_sync_state
     set last_attempt_at = now(), last_error = left(coalesce(p_error, 'UNKNOWN'), 500),
         consecutive_failures = consecutive_failures + 1
   where id = 1;
$$;

revoke all on function public.fn_sync_payment_alerts(interval) from public, anon, authenticated;
grant execute on function public.fn_sync_payment_alerts(interval) to service_role;
