-- AFTER the migration: behavioural proof of F1-F4 with synthetic data on a throw-away PostgreSQL.
\set ON_ERROR_STOP on
create function t_tenant(trial_days int default 14) returns uuid language plpgsql as $$
declare t uuid := gen_random_uuid();
begin
  insert into tenants(id) values (t);
  insert into prompter_subscriptions(tenant_id, status, plan, current_period_start, current_period_end)
  values (t, 'TRIALING', 'FREE', now(), now() + make_interval(days => trial_days));
  return t;
end $$;
create function t_txn(t uuid, p text, a numeric, age interval default '0') returns uuid language plpgsql as $$
declare x uuid := gen_random_uuid();
begin
  insert into prompter_payment_transactions(id, tenant_id, provider, plan, amount, created_at) values (x, t, 'xendit', p, a, now() - age);
  return x;
end $$;
create function t_apply(x uuid, pay text, ev text, st text, a numeric, cur text default 'IDR', src text default 'WEBHOOK')
returns text language plpgsql as $$
declare r record;
begin
  select * into r from fn_apply_payment_event('xendit', x, pay, ev, st, a, cur, src);
  return r.result_outcome || ':' || coalesce(r.result_reason, '-');
end $$;
create function t_state(t uuid) returns text language sql as $$
  select status || '/' || coalesce(plan, '-') from prompter_subscriptions where tenant_id = t $$;

-- ---- F3: checkout intent ---------------------------------------------------------------
do $$
declare t uuid := t_tenant(); u uuid := t_tenant(); a record; b record; c record; d record; n int;
begin
  select * into a from fn_begin_checkout(t, null, 'STARTER', 99000, 'IDR', 'xendit', 'intent-aaaaaaaa');
  perform t_ok(a.out_outcome = 'CREATED', 'F3 first checkout is CREATED');
  select * into b from fn_begin_checkout(t, null, 'STARTER', 99000, 'IDR', 'xendit', 'intent-aaaaaaaa');
  perform t_ok(b.out_outcome = 'IN_PROGRESS' and b.out_transaction_id = a.out_transaction_id, 'F3 same intent while invoice not linked yet is IN_PROGRESS on the same transaction');
  perform t_ok(fn_record_checkout_session(a.out_transaction_id, 'inv-int-1', 'https://pay.example/inv-int-1', now() + interval '30 minutes') = 'OK', 'F3 gateway invoice linked to the transaction');
  select * into b from fn_begin_checkout(t, null, 'STARTER', 99000, 'IDR', 'xendit', 'intent-aaaaaaaa');
  perform t_ok(b.out_outcome = 'REUSED' and b.out_checkout_url = 'https://pay.example/inv-int-1', 'F3 same intent reuses the valid invoice');
  select * into c from fn_begin_checkout(t, null, 'STARTER', 99000, 'IDR', 'xendit', 'intent-bbbbbbbb');
  perform t_ok(c.out_outcome = 'REUSED' and c.out_transaction_id = a.out_transaction_id, 'F3 different intent, same open purchase reuses the open invoice');
  select * into d from fn_begin_checkout(t, null, 'GROWTH', 199000, 'IDR', 'xendit', 'intent-cccccccc');
  perform t_ok(d.out_outcome = 'CREATED' and d.out_transaction_id <> a.out_transaction_id, 'F3 a different plan is a different purchase');
  select count(*) into n from prompter_payment_transactions where tenant_id = t and plan = 'STARTER' and status = 'PENDING';
  perform t_ok(n = 1, 'F3 exactly one PENDING STARTER checkout');
  select * into d from fn_begin_checkout(u, null, 'STARTER', 99000, 'IDR', 'xendit', 'intent-aaaaaaaa');
  perform t_ok(d.out_outcome = 'CREATED' and d.out_transaction_id <> a.out_transaction_id and d.out_checkout_url is null, 'F3 another tenant never sees or reuses this tenant''s checkout (same intent string is tenant-scoped)');
  perform t_ok((select out_outcome from fn_begin_checkout(t, null, 'STARTER', 0, 'IDR', 'xendit', null)) = 'INVALID', 'F3 non-positive amount rejected');
  perform t_ok((select out_outcome from fn_begin_checkout(t, null, 'FREE', 99000, 'IDR', 'xendit', null)) = 'INVALID', 'F3 FREE plan rejected');
  perform t_ok((select out_outcome from fn_begin_checkout(t, null, 'STARTER', 99000, 'IDR', 'xendit', 'bad key!')) = 'INVALID', 'F3 malformed intent rejected');
  perform t_ok((select out_outcome from fn_begin_checkout(gen_random_uuid(), null, 'STARTER', 99000, 'IDR', 'xendit', null)) = 'NO_TENANT', 'F3 unknown tenant rejected');
  -- expired reuse window -> new purchase may start
  update prompter_payment_transactions set checkout_expires_at = now() - interval '1 minute' where id = a.out_transaction_id;
  select * into d from fn_begin_checkout(t, null, 'STARTER', 99000, 'IDR', 'xendit', 'intent-dddddddd');
  perform t_ok(d.out_outcome = 'CREATED' and d.out_transaction_id <> a.out_transaction_id, 'F3 after the reuse window a fresh checkout is created');
  select * into d from fn_begin_checkout(t, null, 'STARTER', 99000, 'IDR', 'xendit', 'intent-aaaaaaaa');
  perform t_ok(d.out_outcome = 'INTENT_CLOSED', 'F3 an intent whose invoice window ended is closed (client must take a new key)');
end $$;

-- ---- baseline apply, replay, out-of-order, audit -----------------------------------------
do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000); n int; end1 timestamptz;
begin
  perform t_ok(t_apply(x, 'inv-1', 'inv-1', 'PAID', 99000) = 'APPLIED:-', 'apply: verified PAID activates');
  perform t_ok(t_state(t) = 'ACTIVE/STARTER', 'apply: subscription ACTIVE/STARTER');
  select current_period_end into end1 from prompter_subscriptions where tenant_id = t;
  perform t_ok(t_apply(x, 'inv-1', 'inv-1', 'PAID', 99000) = 'ALREADY_APPLIED:-', 'replay: identical webhook is ALREADY_APPLIED');
  perform t_ok(t_apply(x, 'inv-1', 'inv-1b', 'PAID', 99000) = 'ALREADY_APPLIED:-', 'replay: SETTLED duplicate with a new event id is ALREADY_APPLIED');
  perform t_ok((select current_period_end from prompter_subscriptions where tenant_id = t) = end1, 'replay: period not extended again');
  select count(*) into n from prompter_audit_logs where resource_id = x and action = 'payment.succeeded';
  perform t_ok(n = 1, 'replay: exactly one audit row');
  perform t_ok(t_apply(x, 'inv-1', 'inv-1c', 'EXPIRED', 99000) = 'RECORDED:OBSERVED_EXPIRED', 'out-of-order: EXPIRED after PAID is only recorded');
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'PAID', 'out-of-order: transaction stays PAID');
  select count(*) into n from prompter_payment_ledger where transaction_id = x;
  perform t_ok(n >= 4, 'ledger: every observation is a row (' || n || ')');
end $$;

do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000);
begin
  perform t_ok(t_apply(x, 'inv-2', 'inv-2e', 'EXPIRED', 99000) = 'RECORDED:OBSERVED_EXPIRED', 'out-of-order: EXPIRED before PAID is only recorded');
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'PENDING', 'out-of-order: transaction still PENDING');
  perform t_ok(t_apply(x, 'inv-2', 'inv-2p', 'PAID', 99000) = 'APPLIED:-', 'out-of-order: PAID afterwards still activates');
end $$;

-- ---- F1: PAID after EXPIRED / FAILED / sweep -----------------------------------------------
do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000, interval '25 hours');
begin
  perform fn_expire_stale_payment_transactions();
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'EXPIRED', 'F1 setup: unlinked stale PENDING is expired by the sweep');
  perform t_ok(t_apply(x, 'inv-f1', 'inv-f1', 'PAID', 99000) = 'APPLIED:LATE_PAYMENT_APPLIED', 'F1 PAID after EXPIRED is applied (late), not rejected');
  perform t_ok(t_state(t) = 'ACTIVE/STARTER', 'F1 subscription activated after late payment');
  perform t_ok((select count(*) from prompter_payment_ledger where transaction_id = x and reason = 'LATE_PAYMENT_APPLIED') = 1, 'F1 late payment is visible in the ledger');
end $$;

do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'GROWTH', 199000);
begin
  update prompter_payment_transactions set status = 'FAILED', failure_reason = 'LEGACY' where id = x;
  perform t_ok(t_apply(x, 'inv-f1b', 'inv-f1b', 'PAID', 199000) = 'APPLIED:LATE_PAYMENT_APPLIED', 'F1 PAID after FAILED is applied');
  perform t_ok((select failure_reason from prompter_payment_transactions where id = x) is null, 'F1 failure reason cleared once paid');
end $$;

-- ---- F1: sweep must ask the gateway first ----------------------------------------------------
do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000, interval '25 hours'); r record; n int;
begin
  update prompter_payment_transactions set provider_payment_id = 'inv-rec1' where id = x;
  perform fn_expire_stale_payment_transactions();
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'PENDING', 'F1 sweep does NOT expire a linked invoice that was never reconciled');
  select count(*) into n from fn_claim_reconciliation_batch(10, interval '1 minute') c where c.out_transaction_id = x;
  perform t_ok(n = 1, 'F1 reconciliation claims the linked PENDING transaction');
  perform t_ok((select reconcile_attempts from prompter_payment_transactions where id = x) = 1, 'F1 attempt counted');
  select count(*) into n from fn_claim_reconciliation_batch(10, interval '1 minute') c where c.out_transaction_id = x;
  perform t_ok(n = 0, 'F1 backoff: not claimed again immediately');
  perform fn_record_reconciliation_attempt(x, 'ERROR', 'TIMEOUT', '{}'::jsonb);
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'PENDING' and (select last_reconciled_at from prompter_payment_transactions where id = x) is null,
    'F1 a gateway timeout is not a failure and does not count as reconciled');
  perform fn_expire_stale_payment_transactions();
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'PENDING', 'F1 still PENDING after an unreachable gateway');
  -- webhook lost: reconciliation finds PAID
  perform t_ok(t_apply(x, 'inv-rec1', null, 'PAID', 99000, 'IDR', 'RECONCILIATION') = 'APPLIED:-', 'F1 webhook lost: reconciliation applies the verified PAID');
  perform t_ok(t_apply(x, 'inv-rec1', 'late-webhook', 'PAID', 99000) = 'ALREADY_APPLIED:-', 'F1 the webhook arriving afterwards does not apply twice');
  perform t_ok((select count(*) from prompter_audit_logs where resource_id = x and action = 'payment.succeeded') = 1, 'F1 exactly one activation');
end $$;

do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000, interval '25 hours'); n int; i int;
begin
  update prompter_payment_transactions set provider_payment_id = 'inv-rec2' where id = x;
  perform fn_record_reconciliation_attempt(x, 'NOT_PAID', 'PENDING', '{}'::jsonb);
  update prompter_payment_transactions set last_reconciled_at = created_at + interval '25 hours' where id = x;
  perform fn_expire_stale_payment_transactions();
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'EXPIRED', 'F1 after the gateway confirmed not paid, the sweep may expire it');
  -- exhausted attempts -> alert/manual review, not silent
  x := t_txn(t, 'PRO', 399000);
  update prompter_payment_transactions set provider_payment_id = 'inv-rec3', reconcile_attempts = 12 where id = x;
  perform fn_record_reconciliation_attempt(x, 'ERROR', 'TIMEOUT', '{}'::jsonb);
  perform t_ok(exists (select 1 from fn_open_payment_exceptions() where out_code = 'RECONCILIATION_EXHAUSTED'), 'F1 exhausted reconciliation lands in the exception queue');
end $$;

-- ---- F2: bad payloads --------------------------------------------------------------------------
do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000); n int;
begin
  perform t_ok(t_apply(x, 'inv-f2', 'inv-f2', 'PAID', 0) = 'EXCEPTION:INVALID_PAYLOAD', 'F2 amount 0 is an exception');
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'PENDING', 'F2 transaction is NOT flipped to FAILED');
  perform t_ok(t_state(t) = 'TRIALING/FREE', 'F2 nothing activated by the bad payload');
  perform t_ok(t_apply(x, 'inv-f2', 'inv-f2', 'PAID', 99000) = 'APPLIED:-', 'F2 the valid event afterwards activates');
  x := t_txn(t, 'STARTER', 99000);
  perform t_ok(t_apply(x, 'inv-f2b', 'inv-f2b', 'PAID', 1000) = 'EXCEPTION:AMOUNT_OR_CURRENCY_MISMATCH', 'F2 wrong amount is an exception');
  perform t_ok(t_apply(x, 'inv-f2b', 'inv-f2b', 'PAID', 1000) = 'EXCEPTION:AMOUNT_OR_CURRENCY_MISMATCH', 'F2 redelivery of the same bad event');
  select count(*) into n from prompter_payment_exceptions where transaction_id = x and status = 'OPEN';
  perform t_ok(n = 1, 'F2 redelivery does not duplicate the OPEN exception');
  perform t_ok((select amount from prompter_payment_ledger where transaction_id = x and reason = 'AMOUNT_OR_CURRENCY_MISMATCH' order by seq limit 1) = 1000, 'F2 the received amount is preserved in the ledger');
  perform t_ok(t_apply(x, 'inv-f2b', 'inv-f2b', 'PAID', 99000, 'USD') = 'EXCEPTION:AMOUNT_OR_CURRENCY_MISMATCH', 'F2 wrong currency is an exception');
  perform t_ok(t_apply(x, null, 'ev', 'PAID', 99000) = 'EXCEPTION:INVALID_PAYLOAD', 'F2 missing gateway reference is an exception');
  perform t_ok(t_apply(x, 'inv-f2b', 'inv-f2b', 'PAID', 99000) = 'APPLIED:-', 'F2 the correct amount afterwards activates');
end $$;

-- ---- F4: renewal, duplicate payment, plan change -----------------------------------------------
do $$
declare t uuid := t_tenant(); x uuid; y uuid; e0 timestamptz; e1 timestamptz;
begin
  update prompter_subscriptions set status = 'ACTIVE', plan = 'STARTER', current_period_start = now() - interval '5 days', current_period_end = now() + interval '25 days' where tenant_id = t;
  select current_period_end into e0 from prompter_subscriptions where tenant_id = t;
  x := t_txn(t, 'STARTER', 99000);
  perform t_ok(t_apply(x, 'inv-ren', 'inv-ren', 'PAID', 99000) = 'APPLIED:-', 'F4 renewal with 25 days left is applied');
  select current_period_end into e1 from prompter_subscriptions where tenant_id = t;
  perform t_ok(e1 >= e0 + interval '28 days', 'F4 renewal extends from the current end (no paid days lost): ' || (e1 - e0));
  perform t_ok(e1 > now() + interval '53 days', 'F4 remaining time is about 25 days + 1 month');
  -- second real payment started before the first was applied (double checkout)
  t := t_tenant();
  x := t_txn(t, 'STARTER', 99000, interval '2 minutes'); y := t_txn(t, 'STARTER', 99000, interval '2 minutes');
  perform t_ok(t_apply(x, 'inv-d1', 'inv-d1', 'PAID', 99000) = 'APPLIED:-', 'F4 first of two real payments is applied');
  e0 := (select current_period_end from prompter_subscriptions where tenant_id = t);
  perform t_ok(t_apply(y, 'inv-d2', 'inv-d2', 'PAID', 99000) = 'EXCEPTION:DUPLICATE_PAYMENT', 'F4 second real payment is recorded as DUPLICATE_PAYMENT');
  perform t_ok((select current_period_end from prompter_subscriptions where tenant_id = t) = e0, 'F4 duplicate does not extend a second time');
  perform t_ok((select activation_state from prompter_payment_transactions where id = y) = 'NEEDS_REVIEW' and (select status from prompter_payment_transactions where id = y) = 'PAID', 'F4 duplicate is kept as PAID + NEEDS_REVIEW (money not discarded)');
  perform t_ok(exists (select 1 from prompter_payment_ledger where transaction_id = y and outcome = 'EXCEPTION' and amount = 99000), 'F4 duplicate money is in the ledger');
  perform t_ok(t_apply(y, 'inv-d2', 'inv-d2', 'PAID', 99000) = 'ALREADY_APPLIED:NEEDS_REVIEW', 'F4 replay of the duplicate stays NEEDS_REVIEW');
  -- replay vs real second payment on the SAME transaction
  perform t_ok(t_apply(x, 'inv-OTHER', 'inv-other', 'PAID', 99000) = 'EXCEPTION:DUPLICATE_PAYMENT_REFERENCE', 'F4 a different gateway reference on a PAID transaction is a second payment, not a replay');
  -- later genuine renewal (created after the first was applied) extends
  x := t_txn(t, 'STARTER', 99000);
  perform t_ok(t_apply(x, 'inv-d3', 'inv-d3', 'PAID', 99000) = 'APPLIED:-', 'F4 a later genuine renewal is applied');
  perform t_ok((select current_period_end from prompter_subscriptions where tenant_id = t) >= e0 + interval '28 days', 'F4 and extends from the previous end');
  -- plan change while active
  t := t_tenant();
  update prompter_subscriptions set status = 'ACTIVE', plan = 'STARTER', current_period_start = now(), current_period_end = now() + interval '20 days' where tenant_id = t;
  e0 := (select current_period_end from prompter_subscriptions where tenant_id = t);
  x := t_txn(t, 'GROWTH', 199000);
  perform t_ok(t_apply(x, 'inv-up', 'inv-up', 'PAID', 199000) = 'EXCEPTION:PLAN_CHANGE_WHILE_ACTIVE', 'F4 plan change with paid time left needs review (no auto proration)');
  perform t_ok((select plan from prompter_subscriptions where tenant_id = t) = 'STARTER' and (select current_period_end from prompter_subscriptions where tenant_id = t) = e0, 'F4 subscription untouched by the plan-change payment');
  -- past due starts a fresh month
  t := t_tenant();
  update prompter_subscriptions set status = 'PAST_DUE', plan = 'STARTER', current_period_end = now() - interval '3 days' where tenant_id = t;
  x := t_txn(t, 'STARTER', 99000);
  perform t_ok(t_apply(x, 'inv-pd', 'inv-pd', 'PAID', 99000) = 'APPLIED:-' and t_state(t) = 'ACTIVE/STARTER', 'F4 PAST_DUE pays and becomes ACTIVE');
  perform t_ok((select current_period_end from prompter_subscriptions where tenant_id = t) between now() + interval '27 days' and now() + interval '32 days', 'F4 PAST_DUE period starts now');
end $$;

-- ---- subscription not found, cross-tenant, trial consistency -------------------------------------
do $$
declare t uuid := gen_random_uuid(); x uuid; a uuid := t_tenant(); b uuid := t_tenant(); xa uuid; xb uuid; pe timestamptz;
begin
  insert into tenants(id) values (t);
  x := t_txn(t, 'STARTER', 99000);
  perform t_ok(t_apply(x, 'inv-nosub', 'inv-nosub', 'PAID', 99000) = 'EXCEPTION:SUBSCRIPTION_NOT_FOUND', 'subscription missing: exception, not a silent PAID');
  perform t_ok((select count(*) from prompter_subscriptions where tenant_id = t) = 0, 'subscription missing: no row invented');
  perform t_ok((select activation_state from prompter_payment_transactions where id = x) = 'NEEDS_REVIEW', 'subscription missing: money kept as NEEDS_REVIEW');
  -- cross tenant gateway reference
  xa := t_txn(a, 'STARTER', 99000); xb := t_txn(b, 'STARTER', 99000);
  perform t_ok(t_apply(xa, 'inv-A', 'inv-A', 'PAID', 99000) = 'APPLIED:-', 'cross-tenant: tenant A paid');
  select current_period_end into pe from prompter_subscriptions where tenant_id = b;
  perform t_ok(t_apply(xb, 'inv-A', 'inv-A', 'PAID', 99000) = 'EXCEPTION:DUPLICATE_GATEWAY_REFERENCE', 'cross-tenant: tenant A''s gateway reference cannot activate tenant B');
  perform t_ok(t_state(b) = 'TRIALING/FREE' and (select current_period_end from prompter_subscriptions where tenant_id = b) = pe, 'cross-tenant: tenant B untouched (trial period unchanged)');
  perform t_ok(t_apply(xa, 'inv-B', 'inv-B', 'PAID', 99000) = 'EXCEPTION:DUPLICATE_PAYMENT_REFERENCE', 'cross-tenant: tenant B''s reference on A''s paid transaction is a recorded exception');
  perform t_ok(t_apply(gen_random_uuid(), 'inv-X', 'inv-X', 'PAID', 99000) = 'EXCEPTION:TRANSACTION_NOT_FOUND', 'unknown transaction id is queued, not lost');
  perform t_ok(exists (select 1 from prompter_payment_ledger where provider_payment_id = 'inv-X' and amount = 99000), 'unknown transaction: payload amount kept in the ledger');
  -- trial 14 days stays consistent
  perform t_ok((select current_period_end - current_period_start from prompter_subscriptions where tenant_id = b) between interval '13 days 23 hours' and interval '14 days 1 hour', 'trial: 14-day window untouched by other tenants'' payments and exceptions');
  perform t_ok(t_apply(t_txn(b, 'STARTER', 99000), 'inv-B2', 'inv-B2', 'PAID', 99000) = 'APPLIED:-' and t_state(b) = 'ACTIVE/STARTER', 'trial: a verified payment moves TRIALING to ACTIVE');
end $$;

-- ---- provider mismatch & non-paid reference mismatch -----------------------------------------------
do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000); r record;
begin
  select * into r from fn_apply_payment_event('midtrans', x, 'inv-pm', 'ev', 'PAID', 99000, 'IDR', 'WEBHOOK');
  perform t_ok(r.result_reason = 'PROVIDER_MISMATCH', 'provider mismatch is an exception');
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'PENDING', 'provider mismatch changes nothing');
end $$;

-- ---- server crash before / after commit ---------------------------------------------------------------
create table t_ctx (k text primary key, v uuid);
do $$ declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000); begin
  insert into t_ctx values ('crash_t', t), ('crash_x', x);
end $$;
begin;
  select t_apply((select v from t_ctx where k = 'crash_x'), 'inv-crash', 'inv-crash', 'PAID', 99000);
rollback;
do $$
declare t uuid := (select v from t_ctx where k = 'crash_t'); x uuid := (select v from t_ctx where k = 'crash_x');
begin
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'PENDING' and t_state(t) = 'TRIALING/FREE', 'crash before commit: nothing applied');
  perform t_ok((select count(*) from prompter_payment_ledger where transaction_id = x) = 0, 'crash before commit: no ledger residue');
  perform t_ok(t_apply(x, 'inv-crash', 'inv-crash', 'PAID', 99000) = 'APPLIED:-', 'crash before commit: the gateway retry applies it');
  perform t_ok(t_apply(x, 'inv-crash', 'inv-crash', 'PAID', 99000) = 'ALREADY_APPLIED:-', 'crash after commit: the retry is a no-op');
  perform t_ok((select count(*) from prompter_audit_logs where resource_id = x and action = 'payment.succeeded') = 1, 'crash: exactly one activation overall');
end $$;

-- ---- resolution is explicit and ledgered -----------------------------------------------------------------
do $$
declare ex uuid; before_n bigint; after_n bigint;
begin
  select id into ex from prompter_payment_exceptions where status = 'OPEN' limit 1;
  select count(*) into before_n from prompter_payment_ledger;
  perform t_ok(fn_resolve_payment_exception(ex, 'RESOLVED', 'refunded manually outside the system (synthetic test)'), 'review: exception resolved with a note');
  select count(*) into after_n from prompter_payment_ledger;
  perform t_ok(after_n = before_n + 1, 'review: resolution is a new ledger row');
  perform t_ok(fn_resolve_payment_exception(ex, 'RESOLVED', 'again') = false, 'review: resolving twice is a no-op');
end $$;

-- ---- ledger is append-only; privileges; tenant isolation ----------------------------------------------------
do $$
declare ok boolean;
begin
  begin update prompter_payment_ledger set reason = 'x'; ok := false; exception when others then ok := true; end;
  perform t_ok(ok, 'ledger: UPDATE blocked even for the owner role');
  begin delete from prompter_payment_ledger; ok := false; exception when others then ok := true; end;
  perform t_ok(ok, 'ledger: DELETE blocked');
  begin truncate prompter_payment_ledger; ok := false; exception when others then ok := true; end;
  perform t_ok(ok, 'ledger: TRUNCATE blocked');
end $$;

create table t_tenants_for_rls as select tenant_id as a from prompter_payment_ledger where tenant_id is not null group by tenant_id limit 2;
grant select on t_tenants_for_rls to authenticated;
grant select on t_ctx to authenticated;
set role authenticated;
select set_config('app.tenant_id', (select a::text from t_tenants_for_rls limit 1), false);
do $$
declare mine bigint; others bigint; ok boolean;
begin
  select count(*) into mine from prompter_payment_ledger;
  select count(*) into others from prompter_payment_ledger where tenant_id <> nullif(current_setting('app.tenant_id'), '')::uuid;
  perform t_ok(mine > 0 and others = 0, 'RLS: a tenant reads only its own ledger rows (' || mine || ')');
  begin perform fn_apply_payment_event('xendit', gen_random_uuid(), 'x', 'x', 'PAID', 1, 'IDR', 'WEBHOOK'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform t_ok(ok, 'privileges: authenticated cannot call fn_apply_payment_event');
  begin perform fn_begin_checkout(current_setting('app.tenant_id')::uuid, null, 'STARTER', 1, 'IDR', 'xendit', null); ok := false; exception when insufficient_privilege then ok := true; end;
  perform t_ok(ok, 'privileges: authenticated cannot call fn_begin_checkout (no client-supplied amount or tenant)');
  begin perform * from fn_claim_reconciliation_batch(1); ok := false; exception when insufficient_privilege then ok := true; end;
  perform t_ok(ok, 'privileges: authenticated cannot claim reconciliation work');
  begin perform count(*) from prompter_payment_exceptions; ok := false; exception when insufficient_privilege then ok := true; end;
  perform t_ok(ok, 'privileges: the exception queue is not readable by tenants');
  begin insert into prompter_payment_ledger(provider, event_kind, outcome) values ('x', 'WEBHOOK', 'RECORDED'); ok := false; exception when others then ok := true; end;
  perform t_ok(ok, 'privileges: authenticated cannot write the ledger');
end $$;
reset role;
set role anon;
do $$
declare ok boolean;
begin
  begin perform count(*) from prompter_payment_ledger; ok := false; exception when insufficient_privilege then ok := true; end;
  perform t_ok(ok, 'privileges: anon cannot read the ledger');
end $$;
reset role;

-- ---- compatibility with the existing v1 path and RLS insert policy --------------------------------------------
do $$
declare t uuid := t_tenant(); x uuid := t_txn(t, 'STARTER', 99000); r record; ok boolean;
begin
  select * into r from fn_apply_verified_payment(x, 'inv-v1', 'inv-v1', 99000, 'IDR');
  perform t_ok(r.allowed = true and t_state(t) = 'ACTIVE/STARTER', 'compat: the existing v1 function still works unchanged');
  perform t_ok((select activation_state from prompter_payment_transactions where id = x) = 'NONE', 'compat: v1-applied rows keep activation_state NONE (no mass rewrite)');
end $$;
set role authenticated;
select set_config('app.tenant_id', (select a::text from t_tenants_for_rls limit 1), false);
select set_config('app.role', 'owner', false);
do $$
declare ok boolean;
begin
  begin
    insert into prompter_payment_transactions(tenant_id, provider, plan, amount)
    values (current_setting('app.tenant_id')::uuid, 'xendit', 'STARTER', 99000);
    ok := true;
  exception when others then ok := false; end;
  perform t_ok(ok, 'compat: the existing owner INSERT policy path still works with the new columns');
end $$;
reset role;
