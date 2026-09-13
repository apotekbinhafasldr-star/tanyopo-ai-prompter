-- Batch B10 Phase 2 — Payment & Billing Core (vendor-neutral, no real
-- processor wired in). Additive only: no table dropped, no column
-- dropped, no existing row touched, no rename of any existing enum
-- value. Idempotent (CREATE OR REPLACE / DROP-then-CREATE-same-name /
-- IF NOT EXISTS throughout).
--
-- Implements the founder's B10 Phase 2 canonical rules:
--   A.1-A.3: client/UI can never activate a paid plan; only a verified
--            payment (via the atomic function at the bottom of this
--            file) can set prompter_subscriptions.status = 'ACTIVE'.
--   A.4-A.5: B9 stays the canonical enforcement layer; this migration
--            closes two gaps in B9's own entitlement functions that
--            this audit surfaced while designing B10 (see section 3
--            below) so B10 cannot create a new bypass path.
--
-- ---------------------------------------------------------------------------
-- SPELLING NOTE (read before touching subscription status anywhere):
-- prompter_subscriptions.status already existed before B10 with the
-- CHECK-constrained values 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED'
-- (American spelling, one L) -- this migration does NOT rename or widen
-- that enum, per "jangan rewrite schema besar-besaran." The brand new
-- prompter_payment_transactions.status below uses 'CANCELLED' (British
-- spelling, two Ls) because the founder's B10 brief specified that exact
-- spelling for payment-transaction status and there is no pre-existing
-- column to stay consistent with. The two enums are intentionally
-- spelled differently -- do not "fix" one to match the other without
-- realizing this is a deliberate, documented choice, not a typo.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. P0-1 remediation (from the B10 Phase 1 audit) -- RLS on
--    prompter_subscriptions only ever checked ROW ownership (tenant_id +
--    owner role), never which COLUMNS an update/insert could touch. That
--    meant an authenticated Owner could call the Supabase REST API
--    directly (bypassing changePlan() entirely) and self-activate a paid
--    subscription with zero payment: `PATCH prompter_subscriptions
--    {"status":"ACTIVE","plan":"GROWTH"}`, or even race
--    getOrCreateSubscription()'s own first-ever INSERT for a brand new
--    tenant with `{"status":"ACTIVE","plan":"GROWTH"}` directly.
--
--    Fix, in two parts:
--    (a) INSERT: the existing "Buat subscription tenant sendiri" policy's
--        WITH CHECK now pins a client-initiated insert to exactly the
--        canonical fresh-trial shape (status TRIALING, plan FREE, no
--        billing fields) -- the only insert getOrCreateSubscription()
--        itself ever performs. A verified-payment insert (should a new
--        tenant's first-ever action somehow be a purchase) goes through
--        fn_apply_verified_payment() below, which runs as the function
--        owner and is therefore unaffected by this policy.
--    (b) UPDATE: column-level privilege, not just a row-level policy --
--        `authenticated` can only ever UPDATE the `plan` column now.
--        `status`, `billing_provider`, `current_period_start/end`,
--        `payment_provider_customer_reference`, the two new columns
--        added below, and `cancel_at_period_end` are only writable by
--        `service_role` (i.e. only from inside the payment webhook route
--        via fn_apply_verified_payment()/fn_schedule_cancellation()).
--        This does not change changePlan()'s own behavior at all --
--        it already only ever wrote `plan`.
-- ---------------------------------------------------------------------------
drop policy if exists "Buat subscription tenant sendiri" on public.prompter_subscriptions;
create policy "Buat subscription tenant sendiri"
  on public.prompter_subscriptions for insert
  with check (
    tenant_id = public.fn_current_tenant_id()
    and status = 'TRIALING'
    and plan = 'FREE'
    and billing_provider is null
    and payment_provider_customer_reference is null
  );

revoke update on public.prompter_subscriptions from authenticated, anon;
grant update (plan) on public.prompter_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Subscription lifecycle columns needed for B10's state machine
--    (Bagian B/D of the brief): cancel-at-period-end and a place to
--    record a real processor's own subscription object id (distinct
--    from payment_provider_customer_reference, which already existed
--    and is reused as-is for the "customer" side, per "jangan rewrite
--    schema besar-besaran").
-- ---------------------------------------------------------------------------
alter table public.prompter_subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists provider_subscription_id text;

comment on column public.prompter_subscriptions.cancel_at_period_end is
  'Batch B10 -- true once the owner requests cancellation; access remains ACTIVE until current_period_end, at which point a real processor''s webhook (or a scheduled check) moves status to CANCELED. Never set by the client directly -- see the column-privilege grant above.';
comment on column public.prompter_subscriptions.provider_subscription_id is
  'Batch B10 -- the payment processor''s own subscription/recurring-plan object id, when one exists (distinct from payment_provider_customer_reference, which identifies the customer, not the subscription). Null until a real processor is integrated.';

-- ---------------------------------------------------------------------------
-- 3. Two gaps in B9's own entitlement functions, surfaced while
--    designing B10 -- fixed here as CREATE OR REPLACE (same signatures,
--    no caller changes anywhere), not because B10 requires new
--    behavior, but because leaving them open would make B10's own new
--    reachable states (a real `plan` change without payment, and the
--    newly-reachable PAST_DUE/CANCELED statuses) into live bypasses of
--    B9 -- which rule A.5 explicitly forbids. B9's own canonical numeric
--    limits (Section C of the B10 brief: "Jangan mengubah entitlement B9
--    yang sudah PASS") are NOT changed by this -- only which row of
--    prompter_plan_entitlements each function is allowed to look up.
--
--    Gap 1 (pre-dates B10, only just found): a TRIALING tenant can
--    already call changePlanAction()/changePlan() today to set
--    `plan = 'GROWTH'` (an ACTIVE-availability, real plan -- changePlan
--    correctly refuses only COMING_SOON plans) with zero payment,
--    because changePlan() never touches `status`. Every B9 entitlement
--    function then looked up allowance by `v_sub.plan` regardless of
--    `v_sub.status` -- so that tenant's trial silently gets Growth's
--    500 AI usages / 50 products / 20 campaigns instead of the
--    canonical trial numbers (30 / 3 / 2). Fix: while `status =
--    'TRIALING'`, entitlement is now always looked up as 'FREE',
--    regardless of what `plan` says -- the trial is the trial.
--
--    Gap 2 (newly relevant because of B10): PAST_DUE and CANCELED were
--    always valid values in the status CHECK constraint but were never
--    actually reachable by any code before B10 (services/billing.ts was
--    the only writer, and it only ever wrote TRIALING or left an
--    existing status alone) -- so B9 never needed an explicit rule for
--    them and none of its functions checked for them. Now that
--    fn_apply_verified_payment()/a future renewal-failure path can
--    reach PAST_DUE, and a cancellation can reach CANCELED, B9 must
--    explicitly deny paid entitlement in both states (same treatment as
--    an expired trial) rather than silently falling through to "not
--    TRIALING, so treat as a paid plan in good standing."
-- ---------------------------------------------------------------------------
create or replace function public.fn_create_ai_job_if_entitled(
  p_job_type text,
  p_input_reference jsonb default '{}'::jsonb
)
returns table(job_id uuid, allowed boolean, reason text, used_count integer, allowance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_actor_user_id uuid;
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_entitlement_plan text;
  v_period_start timestamptz;
  v_used integer;
  v_new_job_id uuid;
begin
  v_tenant_id := public.fn_current_tenant_id();
  v_actor_user_id := auth.uid();

  if v_tenant_id is null then
    return query select null::uuid, false, 'NO_TENANT'::text, 0, 0;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('prompter_ai_usage:' || v_tenant_id::text));

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant_id for update;

  if not found then
    return query select null::uuid, false, 'NO_SUBSCRIPTION'::text, 0, 0;
    return;
  end if;

  if v_sub.status = 'TRIALING' and v_sub.current_period_end is not null and now() > v_sub.current_period_end then
    return query select null::uuid, false, 'TRIAL_EXPIRED'::text, 0, 0;
    return;
  end if;

  -- Batch B10 Gap 2: a subscription that has fallen behind on payment or
  -- been cancelled never gets paid-plan entitlement, regardless of what
  -- `plan` still says.
  if v_sub.status in ('PAST_DUE', 'CANCELED') then
    return query select null::uuid, false, 'SUBSCRIPTION_' || v_sub.status, 0, 0;
    return;
  end if;

  -- Batch B10 Gap 1: the trial is always the trial -- a `plan` value set
  -- via changePlan() (governance preference only, no payment) never
  -- grants paid-tier numbers while status is still TRIALING.
  v_entitlement_plan := case when v_sub.status = 'TRIALING' then 'FREE' else coalesce(v_sub.plan, 'FREE') end;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_entitlement_plan;
  if not found then
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  if v_sub.status = 'TRIALING' then
    v_period_start := coalesce(v_sub.current_period_start, v_sub.created_at);
  else
    v_period_start := date_trunc('month', now());
  end if;

  select count(*) into v_used
  from public.prompter_ai_jobs
  where tenant_id = v_tenant_id and created_at >= v_period_start;

  if v_used >= v_entitlement.ai_usage_allowance then
    return query select null::uuid, false, 'AI_USAGE_LIMIT_REACHED'::text, v_used, v_entitlement.ai_usage_allowance;
    return;
  end if;

  insert into public.prompter_ai_jobs (tenant_id, actor_user_id, job_type, status, input_reference)
  values (v_tenant_id, v_actor_user_id, p_job_type, 'PROCESSING', p_input_reference)
  returning id into v_new_job_id;

  return query select v_new_job_id, true, null::text, v_used + 1, v_entitlement.ai_usage_allowance;
end;
$$;

comment on function public.fn_create_ai_job_if_entitled(text, jsonb) is
  'Batch B9 P0-1/P1-2/P2-1, extended by Batch B10 to deny PAST_DUE/CANCELED subscriptions and to always use FREE-tier numbers while TRIALING regardless of the plan column (see this migration''s header for why).';

create or replace function public.fn_activate_product(p_product_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_product public.prompter_products%rowtype;
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement_plan text;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_active_count integer;
begin
  v_tenant_id := public.fn_current_tenant_id();
  if v_tenant_id is null then
    return query select false, 'NO_TENANT'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('prompter_active_products:' || v_tenant_id::text));

  select * into v_product from public.prompter_products where id = p_product_id and tenant_id = v_tenant_id for update;
  if not found then
    return query select false, 'NOT_FOUND'::text;
    return;
  end if;

  if v_product.status = 'ACTIVE' then
    return query select true, null::text;
    return;
  end if;

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant_id;

  if found and v_sub.status in ('PAST_DUE', 'CANCELED') then
    return query select false, ('SUBSCRIPTION_' || v_sub.status)::text;
    return;
  end if;

  v_entitlement_plan := case
    when not found then 'FREE'
    when v_sub.status = 'TRIALING' then 'FREE'
    else coalesce(v_sub.plan, 'FREE')
  end;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_entitlement_plan;
  if not found then
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  if v_entitlement.max_active_products is not null then
    select count(*) into v_active_count
    from public.prompter_products
    where tenant_id = v_tenant_id and status = 'ACTIVE';

    if v_active_count >= v_entitlement.max_active_products then
      return query select false, 'PRODUCT_LIMIT_REACHED'::text;
      return;
    end if;
  end if;

  update public.prompter_products set status = 'ACTIVE', updated_at = now() where id = p_product_id;
  return query select true, null::text;
end;
$$;

comment on function public.fn_activate_product(uuid) is
  'Batch B9 P0-1/P2-3, extended by Batch B10 to deny PAST_DUE/CANCELED subscriptions and to always use FREE-tier numbers while TRIALING regardless of the plan column.';

create or replace function public.fn_reserve_active_campaign_slot(p_campaign_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_campaign public.prompter_master_campaigns%rowtype;
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement_plan text;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_consuming_count integer;
begin
  v_tenant_id := public.fn_current_tenant_id();
  if v_tenant_id is null then
    return query select false, 'NO_TENANT'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('prompter_active_campaigns:' || v_tenant_id::text));

  select * into v_campaign from public.prompter_master_campaigns where id = p_campaign_id and tenant_id = v_tenant_id for update;
  if not found then
    return query select false, 'NOT_FOUND'::text;
    return;
  end if;

  if v_campaign.status <> 'DRAFT' then
    return query select false, 'INVALID_STATE'::text;
    return;
  end if;

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant_id;

  if found and v_sub.status in ('PAST_DUE', 'CANCELED') then
    return query select false, ('SUBSCRIPTION_' || v_sub.status)::text;
    return;
  end if;

  v_entitlement_plan := case
    when not found then 'FREE'
    when v_sub.status = 'TRIALING' then 'FREE'
    else coalesce(v_sub.plan, 'FREE')
  end;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_entitlement_plan;
  if not found then
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  if v_entitlement.max_active_campaigns is not null then
    select count(*) into v_consuming_count
    from public.prompter_master_campaigns
    where tenant_id = v_tenant_id
      and status in ('ACTIVE', 'SCHEDULED', 'AWAITING_APPROVAL', 'PAUSED')
      and id <> p_campaign_id;

    if v_consuming_count >= v_entitlement.max_active_campaigns then
      return query select false, 'CAMPAIGN_LIMIT_REACHED'::text;
      return;
    end if;
  end if;

  update public.prompter_master_campaigns set status = 'AWAITING_APPROVAL', updated_at = now() where id = p_campaign_id;
  return query select true, null::text;
end;
$$;

comment on function public.fn_reserve_active_campaign_slot(uuid) is
  'Batch B9 P0-1/P2-2, extended by Batch B10 to deny PAST_DUE/CANCELED subscriptions and to always use FREE-tier numbers while TRIALING regardless of the plan column.';

-- ---------------------------------------------------------------------------
-- 4. prompter_payment_transactions -- one row per checkout attempt.
--    Created by an authenticated Owner (via the checkout server action)
--    as PENDING with a server-computed amount; only ever transitioned to
--    PAID/FAILED/EXPIRED/CANCELLED by fn_apply_verified_payment() (or a
--    future expiry sweep), never by the client. This is the "did we ask
--    for money, and did the processor confirm it" record -- separate
--    from prompter_invoices (the "what was billed" record a real
--    processor's invoice webhook fills in) and separate from
--    prompter_webhook_events (idempotent raw-delivery log, reused as-is
--    for payment webhooks with source_system = the provider's name).
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete set null,
  provider text not null,
  provider_payment_id text,
  provider_event_id text,
  plan text not null check (
    plan in ('FREE', 'STARTER', 'PRO', 'BUSINESS', 'GROWTH', 'AGENCY', 'UMKMPRO_BUNDLE')
  ),
  -- Server-computed at checkout time from lib/billing/plans.ts's
  -- PLAN_TIERS -- never a client-supplied number (Bagian G.3 of the
  -- brief). Nullable only for a hypothetical zero-cost transition; every
  -- real checkout writes a real amount.
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'IDR',
  status text not null default 'PENDING' check (
    status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED')
  ),
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint prompter_payment_transactions_provider_payment_unique unique (provider, provider_payment_id)
);

comment on table public.prompter_payment_transactions is
  'Batch B10 -- one row per checkout attempt. Created PENDING by an authenticated Owner with a server-computed amount; only fn_apply_verified_payment() (service_role) may move it to PAID/FAILED/EXPIRED/CANCELLED. `metadata` never stores secrets (see the webhook core''s own logging rules) -- only non-sensitive provider response fields useful for support/debugging.';

drop trigger if exists trg_prompter_payment_transactions_updated_at on public.prompter_payment_transactions;
create trigger trg_prompter_payment_transactions_updated_at
  before update on public.prompter_payment_transactions
  for each row execute function public.prompter_set_updated_at();

create index if not exists idx_prompter_payment_transactions_tenant
  on public.prompter_payment_transactions (tenant_id, created_at desc);

alter table public.prompter_payment_transactions enable row level security;

drop policy if exists "Lihat payment transaction tenant sendiri" on public.prompter_payment_transactions;
create policy "Lihat payment transaction tenant sendiri"
  on public.prompter_payment_transactions for select
  using (tenant_id = public.fn_current_tenant_id());

-- Owner may INITIATE a checkout (insert a PENDING transaction with a
-- server-computed amount) but the WITH CHECK below pins status to
-- PENDING and forbids ever inserting a pre-filled provider_payment_id/
-- paid_at -- an authenticated client can never insert a row that looks
-- already-paid. No UPDATE/DELETE policy exists for anon/authenticated
-- at all -- only service_role (via fn_apply_verified_payment()) can
-- transition a transaction's status, same pattern as prompter_invoices.
drop policy if exists "Buat payment transaction tenant sendiri" on public.prompter_payment_transactions;
create policy "Buat payment transaction tenant sendiri"
  on public.prompter_payment_transactions for insert
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() = 'owner'
    and status = 'PENDING'
    and provider_payment_id is null
    and provider_event_id is null
    and paid_at is null
  );

-- ---------------------------------------------------------------------------
-- 5. fn_apply_verified_payment() -- the ONLY code path anywhere allowed
--    to move a subscription to ACTIVE. Called exclusively by the payment
--    webhook route using the service_role client, after that route has
--    already verified the provider's webhook signature and recorded the
--    raw delivery in prompter_webhook_events for idempotency. This
--    function re-verifies amount/currency/plan against the transaction
--    row created at checkout time (never trusts the webhook payload's
--    numbers blindly) and performs the whole activation atomically,
--    same discipline as Batch B9's fn_create_ai_job_if_entitled.
--
--    Idempotent: calling this twice for the same transaction (a
--    redelivered webhook) is a safe no-op the second time -- it returns
--    allowed=true, reason='ALREADY_PROCESSED' rather than double-billing
--    the tenant a second billing period or re-running the activation.
--
--    Only amount and currency are cross-checked against the transaction
--    row here -- a real payment processor's webhook confirms an amount,
--    a currency, and (via a client-reference/metadata field) the
--    `internalTransactionId` it was given at checkout time; it has no
--    concept of our own "plan" names to independently confirm. `plan`
--    always comes from the transaction row itself (what checkout
--    actually charged for), never a second, separately-asserted value --
--    there is no second source for it to plausibly disagree with.
-- ---------------------------------------------------------------------------
create or replace function public.fn_apply_verified_payment(
  p_transaction_id uuid,
  p_provider_payment_id text,
  p_provider_event_id text,
  p_verified_amount numeric,
  p_verified_currency text
)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;

  if not found then
    return query select false, 'TRANSACTION_NOT_FOUND'::text;
    return;
  end if;

  if v_txn.status = 'PAID' then
    -- Idempotent redelivery of a webhook already processed -- never
    -- double-activate or extend the period a second time.
    return query select true, 'ALREADY_PROCESSED'::text;
    return;
  end if;

  if v_txn.status <> 'PENDING' then
    -- FAILED/EXPIRED/CANCELLED transaction receiving a late "paid" event
    -- is treated as a mismatch, not silently accepted.
    return query select false, ('TRANSACTION_' || v_txn.status)::text;
    return;
  end if;

  if v_txn.amount <> p_verified_amount or v_txn.currency <> p_verified_currency then
    update public.prompter_payment_transactions
    set status = 'FAILED', failure_reason = 'AMOUNT_OR_CURRENCY_MISMATCH', provider_payment_id = p_provider_payment_id, provider_event_id = p_provider_event_id
    where id = p_transaction_id;
    return query select false, 'AMOUNT_OR_CURRENCY_MISMATCH'::text;
    return;
  end if;

  v_period_start := now();
  v_period_end := now() + interval '1 month';

  update public.prompter_payment_transactions
  set status = 'PAID', provider_payment_id = p_provider_payment_id, provider_event_id = p_provider_event_id, paid_at = now()
  where id = p_transaction_id;

  update public.prompter_subscriptions
  set
    plan = v_txn.plan,
    status = 'ACTIVE',
    billing_provider = v_txn.provider,
    current_period_start = v_period_start,
    current_period_end = v_period_end,
    cancel_at_period_end = false
  where tenant_id = v_txn.tenant_id;

  insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
  values (
    v_txn.tenant_id,
    v_txn.user_id,
    'payment.succeeded',
    'prompter_payment_transactions',
    v_txn.id,
    jsonb_build_object('plan', v_txn.plan, 'amount', v_txn.amount, 'currency', v_txn.currency, 'provider', v_txn.provider)
  );

  return query select true, null::text;
end;
$$;

comment on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) is
  'Batch B10 -- the only path that may set prompter_subscriptions.status = ACTIVE. Re-verifies amount/currency against the transaction row created at checkout time; idempotent on redelivery. Callable only by service_role (see grants below) -- never by an authenticated user or anon.';

revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from public;
revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from anon;
revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from authenticated;

-- ---------------------------------------------------------------------------
-- 6. fn_schedule_cancellation() / fn_apply_scheduled_cancellations() --
--    "cancel at period end" (Bagian D). A cancellation request is a
--    governance action an Owner performs on their own tenant (like
--    changePlan()), but the actual status flip to CANCELED must only
--    happen once current_period_end has passed -- never immediately --
--    so it is a separate, narrowly-scoped SECURITY DEFINER function
--    (settable by an authenticated Owner) distinct from the
--    service_role-only column grant above, plus a sweep function a
--    scheduled job can call safely and repeatedly.
-- ---------------------------------------------------------------------------
create or replace function public.fn_schedule_cancellation(p_cancel boolean)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_role text;
begin
  v_tenant_id := public.fn_current_tenant_id();
  v_role := public.fn_current_role();

  if v_tenant_id is null then
    return query select false, 'NO_TENANT'::text;
    return;
  end if;

  if v_role <> 'owner' then
    return query select false, 'NOT_OWNER'::text;
    return;
  end if;

  update public.prompter_subscriptions
  set cancel_at_period_end = p_cancel
  where tenant_id = v_tenant_id;

  if not found then
    return query select false, 'NO_SUBSCRIPTION'::text;
    return;
  end if;

  return query select true, null::text;
end;
$$;

comment on function public.fn_schedule_cancellation(boolean) is
  'Batch B10 -- Owner-only toggle for cancel-at-period-end. Never sets status directly; only fn_apply_scheduled_cancellations() (or a real provider webhook) transitions status to CANCELED once current_period_end has passed.';

revoke all on function public.fn_schedule_cancellation(boolean) from public;
revoke all on function public.fn_schedule_cancellation(boolean) from anon;
grant execute on function public.fn_schedule_cancellation(boolean) to authenticated;

create or replace function public.fn_apply_scheduled_cancellations()
returns integer
language sql
security definer
set search_path = public
as $$
  with cancelled as (
    update public.prompter_subscriptions
    set status = 'CANCELED', cancel_at_period_end = false
    where cancel_at_period_end = true
      and status = 'ACTIVE'
      and current_period_end is not null
      and current_period_end <= now()
    returning tenant_id
  )
  select count(*)::integer from cancelled;
$$;

comment on function public.fn_apply_scheduled_cancellations() is
  'Batch B10 -- idempotent sweep: moves every ACTIVE subscription whose current_period_end has passed and cancel_at_period_end is true to CANCELED. Intended to be called periodically by a scheduled job (service_role only) once one exists; safe to call repeatedly or not at all in the interim (B9''s own PAST_DUE/CANCELED gate degrades safely either way).';

revoke all on function public.fn_apply_scheduled_cancellations() from public;
revoke all on function public.fn_apply_scheduled_cancellations() from anon;
revoke all on function public.fn_apply_scheduled_cancellations() from authenticated;
