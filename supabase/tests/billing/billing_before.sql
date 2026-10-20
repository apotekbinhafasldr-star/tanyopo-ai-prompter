-- BEFORE the migration: proves the F1-F4 holes exist on the real v1 functions (synthetic data).
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

do $$
declare t uuid; x uuid; r record; n int;
begin
  -- F1: PAID arriving after the sweep expired the transaction is rejected, money not applied
  t := t_tenant(); x := t_txn(t, 'STARTER', 99000, interval '25 hours');
  perform fn_expire_stale_payment_transactions();
  select * into r from fn_apply_verified_payment(x, 'inv-f1', 'inv-f1', 99000, 'IDR');
  perform t_ok(r.allowed = false and r.reason = 'TRANSACTION_EXPIRED', 'F1 hole: late PAID rejected as TRANSACTION_EXPIRED');
  perform t_ok((select status from prompter_subscriptions where tenant_id = t) = 'TRIALING', 'F1 hole: subscription not activated although customer paid');

  -- F1b: sweep expires without asking the gateway (provider id known)
  t := t_tenant(); x := t_txn(t, 'STARTER', 99000, interval '25 hours');
  update prompter_payment_transactions set provider_payment_id = 'inv-f1b' where id = x;
  perform fn_expire_stale_payment_transactions();
  perform t_ok((select status from prompter_payment_transactions where id = x) = 'EXPIRED', 'F1 hole: sweep expires a linked invoice without any gateway check');

  -- F2: amount 0 permanently fails the transaction; the correct event is then refused
  t := t_tenant(); x := t_txn(t, 'STARTER', 99000);
  perform fn_apply_verified_payment(x, 'inv-f2', 'inv-f2', 0, 'IDR');
  select * into r from fn_apply_verified_payment(x, 'inv-f2', 'inv-f2', 99000, 'IDR');
  perform t_ok(r.allowed = false and r.reason = 'TRANSACTION_FAILED', 'F2 hole: valid event refused after one bad payload');

  -- F3: nothing prevents two PENDING checkouts for one tenant and plan
  t := t_tenant(); perform t_txn(t, 'STARTER', 99000); perform t_txn(t, 'STARTER', 99000);
  select count(*) into n from prompter_payment_transactions where tenant_id = t and status = 'PENDING';
  perform t_ok(n = 2, 'F3 hole: two PENDING checkouts coexist');

  -- F4: renewal with 25 days left only gains ~6 days; second payment gains nothing
  t := t_tenant();
  update prompter_subscriptions set status = 'ACTIVE', plan = 'STARTER', current_period_start = now() - interval '5 days', current_period_end = now() + interval '25 days' where tenant_id = t;
  x := t_txn(t, 'STARTER', 99000);
  perform fn_apply_verified_payment(x, 'inv-f4', 'inv-f4', 99000, 'IDR');
  perform t_ok((select current_period_end from prompter_subscriptions where tenant_id = t) < now() + interval '32 days', 'F4 hole: renewal resets to now()+1 month, paid days are lost');
end $$;
