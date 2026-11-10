-- ============================================================================
-- 10_migrations_part_4.sql  (bagian 4 dari 8)  -- SANDBOX DOKU SAJA
-- Migrasi 28 s/d 32 dari 49:  20260915051359_prompter_b10_payment_billing_core.sql  ...  20260928161604_prompter_demo_ai_usage.sql
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- File ini DIBANGUN OTOMATIS oleh tools/build_bundles.py; isi migrasi disalin apa adanya.
-- Jalankan HANYA di project sandbox (cek ref di URL dashboard), SETELAH 00 PASS dan 01 sukses,
-- dan berurutan (bagian 4 butuh 27 migrasi sudah tercatat). Satu transaksi: gagal = tidak ada yang terpasang.
-- ============================================================================
begin;
do $guard$
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: marker sandbox tidak ada. Bukan project sandbox / 01_shim belum dijalankan.';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('products', 'product_batches', 'warehouses', 'warehouse_stock', 'inventory_movements', 'purchase_orders', 'transactions', 'transaction_items', 'online_orders', 'pesanan_meja', 'receivables', 'employees', 'attendance', 'payroll_notes', 'kontrak_karyawan', 'leave_requests')) then
    raise exception 'ABORT: tabel UMKMpro terdeteksi -> kemungkinan project PRODUCTION. Berhenti.';
  end if;
  if (select count(*) from public._linoe_sandbox_applied) <> 27 then
    raise exception 'ABORT: urutan salah. Harus ada 27 migrasi tercatat sebelum bagian ini.';
  end if;
end $guard$;

-- >>> 20260915051359_prompter_b10_payment_billing_core.sql  sha256=3057a88da773ccfe4ec672891d4c94ccd737d569f3114d11b099f8e271925bec
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
insert into public._linoe_sandbox_applied (version, sha256) values ('20260915051359', '3057a88da773ccfe4ec672891d4c94ccd737d569f3114d11b099f8e271925bec');

-- >>> 20260924173424_prompter_trial_expiry_gate_fix.sql  sha256=bced3f768e99f7145b2ffe1626a588a561e1ec560247fea961801c30c4d3daac
-- Batch B12 P0 remediation: trial-expiry gap on non-AI entitlement paths.
--
-- fn_create_ai_job_if_entitled() (B9/B10) already denies a TRIALING
-- subscription past its current_period_end. fn_activate_product() and
-- fn_reserve_active_campaign_slot() never got the same check when B10
-- added the PAST_DUE/CANCELED guard to them -- both currently only
-- collapse an expired trial down to FREE-tier numeric limits, they never
-- deny outright the way an expired trial denies AI usage. This closes
-- that gap by mirroring fn_create_ai_job_if_entitled's exact condition,
-- placed before the existing PAST_DUE/CANCELED check in each function.
--
-- CREATE OR REPLACE with an identical signature preserves each
-- function's existing GRANT/REVOKE state (function OID persists) -- no
-- grant statements needed here, same as B10's redefinition of these two
-- functions.

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

  if found and v_sub.status = 'TRIALING' and v_sub.current_period_end is not null and now() > v_sub.current_period_end then
    return query select false, 'TRIAL_EXPIRED'::text;
    return;
  end if;

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
  'Batch B9 P0-1/P2-3, extended by Batch B10 to deny PAST_DUE/CANCELED subscriptions and to always use FREE-tier numbers while TRIALING regardless of the plan column; extended by this migration to deny outright once a TRIALING subscription has passed current_period_end (mirrors fn_create_ai_job_if_entitled).';

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

  if found and v_sub.status = 'TRIALING' and v_sub.current_period_end is not null and now() > v_sub.current_period_end then
    return query select false, 'TRIAL_EXPIRED'::text;
    return;
  end if;

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
  'Batch B9 P0-1/P2-2, extended by Batch B10 to deny PAST_DUE/CANCELED subscriptions and to always use FREE-tier numbers while TRIALING regardless of the plan column; extended by this migration to deny outright once a TRIALING subscription has passed current_period_end (mirrors fn_create_ai_job_if_entitled).';
insert into public._linoe_sandbox_applied (version, sha256) values ('20260924173424', 'bced3f768e99f7145b2ffe1626a588a561e1ec560247fea961801c30c4d3daac');

-- >>> 20260926062741_prompter_scheduled_cancellations_cron.sql  sha256=923631930bb3ad9032780e9868eb820502d683b0091a4560f115aaa0d65b6a42
-- Batch B12 P0-3 remediation: wire the existing, already-correct
-- fn_apply_scheduled_cancellations() sweep (Batch B10) into pg_cron --
-- an extension already installed on this shared project and already
-- used by UMKMpro AI's own scheduled jobs (cron.job jobid 1-4).
-- Nothing about fn_apply_scheduled_cancellations() itself changes; this
-- migration only adds the missing schedule that invokes it.
--
-- Runs hourly, directly inside Postgres via cron.schedule() -- no new
-- Edge Function, no new HTTP endpoint, no new secret/env var. pg_cron
-- jobs on this project run as the `postgres` role, which already has
-- implicit privilege to call this SECURITY DEFINER function (function
-- owner/superuser is unaffected by the REVOKE ALL FROM anon/authenticated
-- already in place from Batch B10), so no new grant is required.
--
-- cron.schedule() with an existing job name updates that job in place
-- (pg_cron >= 1.4) rather than creating a duplicate, so this migration
-- is safe to re-run.
--
-- pg_cron is already enabled on the shared production project (used by
-- UMKMpro AI's own scheduled jobs), so this is a no-op there. It is
-- included so this migration is self-contained and portable to any
-- environment (e.g. a fresh local Supabase stack) where the extension
-- exists but has not been enabled yet.
create extension if not exists pg_cron;

select cron.schedule(
  'prompter-apply-scheduled-cancellations',
  '0 * * * *',
  $$select public.fn_apply_scheduled_cancellations();$$
);
insert into public._linoe_sandbox_applied (version, sha256) values ('20260926062741', '923631930bb3ad9032780e9868eb820502d683b0091a4560f115aaa0d65b6a42');

-- >>> 20260926113000_prompter_payment_lifecycle_remediation.sql  sha256=44c25a3e6281265614a5b8d78f5582b2ecdfd6ac75dfbb54a014ba5df5bdffae
-- Payment Remediation (post-B11 payment-readiness audit) — closes two
-- lifecycle gaps found in the paid-subscription/payment-transaction
-- state machine. Additive only: no existing table, column, function
-- signature, RLS policy, or grant is altered. Does NOT touch
-- fn_apply_verified_payment(), fn_schedule_cancellation(),
-- fn_apply_scheduled_cancellations() (P0-3, FROZEN), the B9 entitlement
-- functions, or the Trial Expiry fix (FROZEN) — this migration only adds
-- two new sweep functions and two new, separately-named pg_cron jobs.
--
-- Gap 1 — Subscription period expiry: fn_apply_verified_payment() sets
-- status='ACTIVE' with a one-month current_period_end, but nothing ever
-- moved a subscription off ACTIVE once that date passed without a new
-- payment (the B10 migration's own comment anticipated this as "a future
-- renewal-failure path" that was never built). Fix: fn_apply_expired_subscriptions()
-- mirrors fn_apply_scheduled_cancellations()'s exact shape and moves any
-- ACTIVE subscription whose current_period_end has passed to the
-- already-existing PAST_DUE status -- a status the B9 entitlement
-- functions (fn_create_ai_job_if_entitled, fn_activate_product,
-- fn_reserve_active_campaign_slot) already deny paid entitlement for,
-- unchanged. No new status is introduced. A subscription that renews
-- (fn_apply_verified_payment runs again) is picked back up to ACTIVE
-- with a fresh period regardless of what this function most recently set
-- it to, so a renewal racing this sweep is always resolved correctly.
--
-- Gap 2 — Stale PENDING payment transactions: a checkout that's started
-- but never completed (or never resolved by a webhook) stays PENDING
-- forever today -- confirmed live in production (a PENDING transaction
-- from days earlier). Fix: fn_expire_stale_payment_transactions() moves
-- a PENDING transaction older than 24 hours (this app has no stored
-- provider-side expiry timestamp yet, so created_at + a fixed window is
-- the most honest authoritative timestamp available without inventing a
-- new column) to the already-existing EXPIRED status. PAID/FAILED/
-- CANCELLED/already-EXPIRED rows are never touched -- the WHERE clause
-- only ever matches status = 'PENDING'.

create or replace function public.fn_apply_expired_subscriptions()
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.prompter_subscriptions
    set status = 'PAST_DUE'
    where status = 'ACTIVE'
      and current_period_end is not null
      and current_period_end < now()
    returning tenant_id
  )
  select count(*)::integer from expired;
$$;

comment on function public.fn_apply_expired_subscriptions() is
  'Payment Remediation -- idempotent sweep: moves every ACTIVE subscription whose current_period_end has already passed to PAST_DUE (an existing status B9''s entitlement functions already deny paid access for). Intended to be called periodically by pg_cron (service_role only); safe to call repeatedly or not at all in the interim.';

revoke all on function public.fn_apply_expired_subscriptions() from public;
revoke all on function public.fn_apply_expired_subscriptions() from anon;
revoke all on function public.fn_apply_expired_subscriptions() from authenticated;

create or replace function public.fn_expire_stale_payment_transactions()
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.prompter_payment_transactions
    set status = 'EXPIRED', failure_reason = coalesce(failure_reason, 'CHECKOUT_TIMEOUT')
    where status = 'PENDING'
      and created_at < now() - interval '24 hours'
    returning id
  )
  select count(*)::integer from expired;
$$;

comment on function public.fn_expire_stale_payment_transactions() is
  'Payment Remediation -- idempotent sweep: moves a PENDING payment transaction older than 24 hours to EXPIRED. Never touches PAID/FAILED/CANCELLED/already-EXPIRED rows. Intended to be called periodically by pg_cron (service_role only).';

revoke all on function public.fn_expire_stale_payment_transactions() from public;
revoke all on function public.fn_expire_stale_payment_transactions() from anon;
revoke all on function public.fn_expire_stale_payment_transactions() from authenticated;

-- pg_cron is already enabled on this shared production project (see
-- 20260926090000_prompter_scheduled_cancellations_cron.sql) -- this
-- statement is a no-op there and only matters for a fresh environment
-- (e.g. a local Supabase stack) where it hasn't been enabled yet.
create extension if not exists pg_cron;

-- Two separate, distinctly-named jobs -- neither reuses nor modifies the
-- P0-3 job ('prompter-apply-scheduled-cancellations'), which stays
-- exactly as it is (FROZEN).
select cron.schedule(
  'prompter-apply-expired-subscriptions',
  '0 * * * *',
  $$select public.fn_apply_expired_subscriptions();$$
);

select cron.schedule(
  'prompter-expire-stale-payment-transactions',
  '0 * * * *',
  $$select public.fn_expire_stale_payment_transactions();$$
);
insert into public._linoe_sandbox_applied (version, sha256) values ('20260926113000', '44c25a3e6281265614a5b8d78f5582b2ecdfd6ac75dfbb54a014ba5df5bdffae');

-- >>> 20260928161604_prompter_demo_ai_usage.sql  sha256=8624ca5d75415877cb039e86481adb56d78174913acf7824b9254adc156128cd
-- LINOE Demo Account & Safe Trial Environment -- Phase 1 implementation.
-- Founder-approved 2026-09-28 (see engagement checkpoint
-- LINOE_DEMO_DESIGN_READY_FOR_FOUNDER_REVIEW -> Founder Decision).
--
-- PREPARED FOR REVIEW ONLY. NOT APPLIED TO PRODUCTION BY THIS CHANGE.
--
-- Architecture note (why this table has no tenant_id and no RLS
-- tenant policy, unlike every other prompter_* table in this schema):
-- the Founder's approved design is an ISOLATED PER-SESSION demo, not a
-- shared demo tenant ("Jika desain audit menunjukkan isolated per-session
-- state lebih aman, gunakan pendekatan tersebut. Security lebih penting
-- daripada convenience."). A demo visitor never authenticates through
-- Supabase auth and is never given a row in `tenants`/`user_profiles`
-- (those are owned and provisioned by an external system -- see this
-- repo's own foundation-schema migration docstring). There is therefore
-- no `fn_current_tenant_id()` to scope this table by, and nothing here
-- can be reached through, or interfere with, the real tenant/RLS model
-- used by every other prompter_* table.
--
-- This table's only job is enforcing the Founder's hard AI-usage cap
-- ("real AI wajib mempunyai hard usage cap ... Demo tidak boleh
-- menghasilkan API cost tanpa batas") across serverless instances --
-- lib/rate-limit.ts is explicitly documented as process-local and not
-- sufficient alone for that guarantee. It stores nothing about any real
-- tenant, product, campaign, or person: only an opaque, server-generated
-- demo session id and a call counter.
--
-- No cron job is created or scheduled by this migration. A demo session
-- is bounded to 30 minutes by lib/demo/session.ts's own signed-token
-- expiry (verified in application code on every request, never trusted
-- from the client) -- stale rows here are inert (their counter is simply
-- never looked up again once the session token expires) and harmless to
-- leave in place; a periodic cleanup, if ever wanted, is a separate,
-- explicitly-approved change per the Founder's cron STOP condition
-- ("Jangan membuat cron production baru kecuali benar-benar diperlukan.
-- Jika cron diperlukan, STOP dan minta approval Founder terpisah.").

create table if not exists public.prompter_demo_ai_usage (
  session_id text primary key,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint prompter_demo_ai_usage_used_count_nonnegative check (used_count >= 0)
);

comment on table public.prompter_demo_ai_usage is
  'LINOE Demo Environment Phase 1 -- per-demo-session real-AI call counter, enforcing the Founder-required hard usage cap. Not tenant-scoped: demo sessions are never a real tenant. Written to only via fn_consume_demo_ai_usage() through the service-role admin client (lib/supabase/admin.ts) from lib/demo/ai-usage.ts -- never from a client-authenticated request.';

-- RLS enabled with zero policies: deny-by-default for anon/authenticated
-- alike. Only the service-role admin client (which bypasses RLS
-- entirely, same as every other admin-only write path in this codebase,
-- e.g. features/campaigns/launch-actions.ts's oauth-credential lookups)
-- ever touches this table. This mirrors the "no anon/authenticated
-- access, service-role or SECURITY DEFINER only" pattern used for every
-- other sensitive table/function in this schema.
alter table public.prompter_demo_ai_usage enable row level security;

revoke all on public.prompter_demo_ai_usage from anon, authenticated;

create or replace function public.fn_consume_demo_ai_usage(p_session_id text, p_hard_cap integer)
returns table(allowed boolean, used_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used_count integer;
begin
  if p_session_id is null or length(trim(p_session_id)) = 0 then
    return query select false, 0;
    return;
  end if;

  -- Single atomic upsert-and-increment: a demo session's first real-AI
  -- call creates its row at count 1, every call after increments it.
  -- Concurrent requests from the same session id serialize on the
  -- underlying row lock, so this cannot be raced past the hard cap the
  -- way a separate check-then-insert could.
  insert into public.prompter_demo_ai_usage (session_id, used_count, last_used_at)
  values (p_session_id, 1, now())
  on conflict (session_id) do update
    set used_count = public.prompter_demo_ai_usage.used_count + 1,
        last_used_at = now()
  returning public.prompter_demo_ai_usage.used_count into v_used_count;

  if v_used_count > p_hard_cap then
    -- Already over the cap: record the attempt (so a determined abuser's
    -- counter keeps climbing rather than getting "free" retries at the
    -- exact cap boundary) but deny it.
    return query select false, v_used_count;
    return;
  end if;

  return query select true, v_used_count;
end;
$$;

comment on function public.fn_consume_demo_ai_usage(text, integer) is
  'LINOE Demo Environment Phase 1 -- atomically consumes one unit of a demo session''s hard AI-usage cap. Takes no tenant identity (there is none for a demo session) and derives nothing from auth.uid(); the session id itself is the opaque, server-issued identifier from lib/demo/session.ts. Fails closed: any caller error is treated by lib/demo/ai-usage.ts as not-allowed.';

-- Same "service-role/SECURITY DEFINER only" boundary as the table itself.
revoke all on function public.fn_consume_demo_ai_usage(text, integer) from public, anon, authenticated;
insert into public._linoe_sandbox_applied (version, sha256) values ('20260928161604', '8624ca5d75415877cb039e86481adb56d78174913acf7824b9254adc156128cd');

commit;
