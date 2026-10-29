-- P0 remediation: a tenant Owner must not be able to change prompter_subscriptions.plan through the
-- Supabase REST API (PostgREST) without a verified payment.
--
-- Finding (read-only audit of the production catalog, 2026-10-29): the policy "Owner kelola subscription"
-- (FOR UPDATE, tenant + role = owner) together with the column grant UPDATE(plan) for `authenticated`
-- lets an Owner PATCH /rest/v1/prompter_subscriptions?tenant_id=eq.<own> {"plan":"BUSINESS"} at ANY
-- status. For an ACTIVE subscription the entitlement functions (fn_create_ai_job_if_entitled,
-- fn_activate_product, fn_reserve_active_campaign_slot) read `plan` directly, so the Owner receives the
-- higher plan's numbers without paying. The only guard was services/billing.ts#changePlan, an app-level
-- check that a direct REST call simply skips. A role check is not a fix: the caller IS the Owner.
--
-- Fix (three layers, all inside the database):
--  1. No client write path to the table remains: the UPDATE policy is dropped and every UPDATE privilege
--     (table-level AND column-level) is revoked from anon/authenticated/public. RLS and grants both deny.
--  2. Defense in depth: a BEFORE UPDATE trigger rejects any UPDATE issued while current_user is anon or
--     authenticated, even if a policy or grant is re-added later by mistake.
--  3. The one legitimate client action, "choose a plan while still on the free trial", becomes
--     fn_set_trial_plan_preference(p_plan): SECURITY DEFINER, tenant derived from auth.uid() (never a
--     parameter), Owner only, TRIALING only, plan must be a known ACTIVE plan. It only stores a PREFERENCE:
--     entitlement for TRIALING is always the FREE numbers (fn_create_ai_job_if_entitled /
--     fn_activate_product), so the preference grants no paid access. Paid plan changes still happen only in
--     fn_apply_verified_payment (service_role, verified webhook) and the downgrade sweeps (SECURITY DEFINER).
--
-- Unchanged on purpose: fn_apply_verified_payment, fn_schedule_cancellation, the cron sweeps,
-- fn_guard_subscription_plan_availability, the INSERT trigger/policy, SELECT policy, service_role, all data.
-- This migration modifies no row. Other products on the shared database (PUBLOE, UMKMpro) do not write
-- to this table through the authenticated role.
--
-- DEPLOY ORDER: ship the app (changePlan -> RPC) and apply this migration together. If the migration is
-- applied first, the OLD app's plan-preference save fails with "Gagal mengubah paket." (nothing else
-- changes); if the app is deployed first, the NEW app's call fails the same way until the migration is
-- applied. Neither order opens a hole or breaks payments, AI, campaigns or sign-in.
-- Rollback: supabase/rollback/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.down.sql
--
-- LOCK SAFETY: fail fast instead of queueing writers behind a DDL lock (see the S1 migrations).
set local lock_timeout = '3s';

-- 1) Remove every client UPDATE path.
drop policy if exists "Owner kelola subscription" on public.prompter_subscriptions;
revoke update on public.prompter_subscriptions from public, anon, authenticated;
revoke update (plan) on public.prompter_subscriptions from public, anon, authenticated;
-- Same table, same class of hole (found in review): `authenticated`/`anon` also hold DELETE and TRUNCATE in
-- production while the S1 migration that revokes them (20261019100100) is not applied there yet. TRUNCATE
-- ignores RLS, so any signed-in user could wipe every tenant's subscription row and re-insert a free trial.
-- The app never deletes (it only SELECTs and INSERTs the first trial row). Idempotent with S1: revoking twice is a no-op.
revoke delete, truncate on public.prompter_subscriptions from public, anon, authenticated;

-- 2) Defense in depth: clients can never UPDATE this table, whatever policies/grants exist.
create or replace function public.fn_block_client_subscription_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'prompter_subscriptions cannot be updated directly; plan changes require a verified payment'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.fn_block_client_subscription_update() is
  'P0 plan tampering: rejects any UPDATE on prompter_subscriptions issued as anon/authenticated. SECURITY INVOKER on purpose: inside SECURITY DEFINER functions (payment webhook, cancellation, sweeps, fn_set_trial_plan_preference) and for service_role, current_user is not anon/authenticated, so those paths are unaffected.';

drop trigger if exists trg_prompter_subscriptions_block_client_update on public.prompter_subscriptions;
create trigger trg_prompter_subscriptions_block_client_update
  before update on public.prompter_subscriptions
  for each row execute function public.fn_block_client_subscription_update();

-- 3) The only client-facing way to record a trial plan preference.
create or replace function public.fn_set_trial_plan_preference(p_plan text)
returns table(out_ok boolean, out_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_availability text;
  v_status text;
begin
  if auth.uid() is null then
    return query select false, 'NOT_AUTHENTICATED'::text;
    return;
  end if;

  v_tenant_id := public.fn_current_tenant_id();
  if v_tenant_id is null then
    return query select false, 'NO_TENANT'::text;
    return;
  end if;

  if public.fn_current_role() is distinct from 'owner' then
    return query select false, 'NOT_OWNER'::text;
    return;
  end if;

  select availability into v_availability from public.prompter_plan_entitlements where plan = p_plan;
  if v_availability is null then
    return query select false, 'PLAN_UNKNOWN'::text;
    return;
  end if;
  if v_availability <> 'ACTIVE' then
    return query select false, 'PLAN_NOT_AVAILABLE'::text;
    return;
  end if;

  select status into v_status from public.prompter_subscriptions where tenant_id = v_tenant_id for update;
  if not found then
    return query select false, 'NO_SUBSCRIPTION'::text;
    return;
  end if;
  if v_status <> 'TRIALING' then
    return query select false, 'NOT_TRIALING'::text;
    return;
  end if;

  update public.prompter_subscriptions set plan = p_plan where tenant_id = v_tenant_id;
  return query select true, null::text;
end;
$$;

comment on function public.fn_set_trial_plan_preference(text) is
  'P0 plan tampering: Owner-only, TRIALING-only plan PREFERENCE. Tenant comes from auth.uid(), never a parameter. Grants no paid access: entitlement for TRIALING is always the FREE numbers. Paid plan changes only via fn_apply_verified_payment.';

revoke all on function public.fn_set_trial_plan_preference(text) from public, anon;
grant execute on function public.fn_set_trial_plan_preference(text) to authenticated;
