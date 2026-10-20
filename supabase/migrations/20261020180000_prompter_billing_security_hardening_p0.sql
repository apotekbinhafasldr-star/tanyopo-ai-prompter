-- Billing Security Hardening P0 (Draft; NOT applied anywhere).
--
-- Evidence (catalog rebuilt locally from this repo's migrations with Supabase default
-- privileges; see docs/BILLING_SECURITY_HARDENING_P0.md):
--   1. `authenticated` holds column-level UPDATE(plan) on prompter_subscriptions and the
--      policy "Owner kelola subscription" lets an Owner use it on ANY status. The app-level
--      guard in services/billing.ts#changePlan is bypassable over PostgREST, so a paying
--      STARTER Owner can set plan='BUSINESS' and receive BUSINESS entitlements unpaid.
--   2. The policy "Buat payment transaction tenant sendiri" lets an Owner INSERT PENDING
--      transaction rows directly (client-controlled amount/plan/checkout columns).
--   3. anon + authenticated hold table-level INSERT/UPDATE/DELETE/TRUNCATE on the billing
--      evidence tables. TRUNCATE ignores RLS, so financial history can be wiped.
--
-- Scope: prompter_subscriptions, prompter_payment_transactions, prompter_invoices,
-- prompter_webhook_events, prompter_audit_logs ONLY. Nothing of PUBLOE/UMKMpro AI/Apotek or any
-- non-prompter_ object is referenced. No data is modified (no UPDATE/DELETE/INSERT on rows).
--
-- Deploy order: PR #44 (fn_begin_checkout) must be applied first; this file refuses to run
-- otherwise, because closing the direct INSERT would cut the legacy checkout path that has no
-- trusted replacement. Override (tests only): set app.allow_close_txn_insert_without_v2 = 'yes'.
-- Rollback: supabase/rollback/20261020180000_prompter_billing_security_hardening_p0.down.sql

do $$
begin
  if to_regprocedure('public.fn_begin_checkout(uuid, uuid, text, numeric, text, text, text)') is null
     and coalesce(current_setting('app.allow_close_txn_insert_without_v2', true), '') <> 'yes' then
    raise exception 'refused: apply the PR #44 billing financial-safety migration first (fn_begin_checkout missing)';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- 1. Plan can no longer be written by the client. Trial plan *preference* goes through an
--    authorised RPC; paid plan changes only ever happen via a verified payment.
-- ---------------------------------------------------------------------------------------
drop policy if exists "Owner kelola subscription" on public.prompter_subscriptions;
revoke update on public.prompter_subscriptions from authenticated, anon;

create or replace function public.fn_set_trial_plan_preference(p_plan text)
returns table(out_ok boolean, out_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_status text;
  v_availability text;
begin
  v_tenant := public.fn_current_tenant_id();
  if v_tenant is null then
    return query select false, 'NO_TENANT'::text; return;
  end if;
  if public.fn_current_role() is distinct from 'owner' then
    return query select false, 'NOT_OWNER'::text; return;
  end if;

  select availability into v_availability from public.prompter_plan_entitlements where plan = p_plan;
  if v_availability is null then
    return query select false, 'PLAN_UNKNOWN'::text; return;
  end if;
  if v_availability <> 'ACTIVE' then
    return query select false, 'PLAN_NOT_AVAILABLE'::text; return;
  end if;

  select status into v_status from public.prompter_subscriptions where tenant_id = v_tenant for update;
  if not found then
    return query select false, 'NO_SUBSCRIPTION'::text; return;
  end if;
  if v_status <> 'TRIALING' then
    return query select false, 'NOT_TRIALING'::text; return;
  end if;

  update public.prompter_subscriptions set plan = p_plan where tenant_id = v_tenant;
  return query select true, null::text;
end;
$$;

comment on function public.fn_set_trial_plan_preference(text) is
  'Billing hardening P0: the only client-reachable way to touch prompter_subscriptions.plan. Tenant and role come from the JWT (never from arguments); Owner only; TRIALING only; plan must exist and be ACTIVE. Never touches status or any period field.';

revoke all on function public.fn_set_trial_plan_preference(text) from public, anon;
grant execute on function public.fn_set_trial_plan_preference(text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_set_trial_plan_preference(text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- 2. Transactions are created only by the trusted server path (service_role).
-- ---------------------------------------------------------------------------------------
drop policy if exists "Buat payment transaction tenant sendiri" on public.prompter_payment_transactions;
revoke insert, update, delete, truncate on public.prompter_payment_transactions from authenticated, anon;

-- ---------------------------------------------------------------------------------------
-- 3. Billing evidence tables: no client write of any kind, no TRUNCATE.
--    (All app writers use the service-role client; verified by grep in the audit doc.)
-- ---------------------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.prompter_invoices from authenticated, anon;
revoke insert, update, delete, truncate on public.prompter_webhook_events from authenticated, anon;
-- audit log: tenants still INSERT their own rows (RLS-pinned); no UPDATE/DELETE/TRUNCATE, no anon.
revoke update, delete, truncate on public.prompter_audit_logs from authenticated, anon;
revoke insert on public.prompter_audit_logs from anon;

-- ---------------------------------------------------------------------------------------
-- 4. Trial remainder is carried over on the first paid activation.
--    Fires only on the TRIALING -> ACTIVE transition when the writer also moved the period
--    end (the payment functions do), and adds the unused trial time (capped at 14 days).
--    Works for fn_apply_verified_payment (v1) and fn_apply_payment_event (PR #44) alike.
-- ---------------------------------------------------------------------------------------
create or replace function public.fn_subscription_trial_carryover()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_remaining interval;
begin
  if old.status = 'TRIALING' and new.status = 'ACTIVE'
     and old.current_period_end is not null and old.current_period_end > now()
     and new.current_period_end is not null
     and new.current_period_end is distinct from old.current_period_end then
    v_remaining := least(old.current_period_end - now(), interval '14 days');
    new.current_period_end := new.current_period_end + v_remaining;
  end if;
  return new;
end;
$$;

comment on function public.fn_subscription_trial_carryover() is
  'Billing hardening P0: unused trial time is added to the first paid period (TRIALING->ACTIVE with a period change), capped at 14 days. Never runs for other transitions, so replays and renewals are unaffected.';

drop trigger if exists trg_prompter_subscriptions_trial_carryover on public.prompter_subscriptions;
create trigger trg_prompter_subscriptions_trial_carryover
  before update of status, current_period_end on public.prompter_subscriptions
  for each row execute function public.fn_subscription_trial_carryover();
