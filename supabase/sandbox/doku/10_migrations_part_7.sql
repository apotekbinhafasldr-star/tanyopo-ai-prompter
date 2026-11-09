-- ============================================================================
-- 10_migrations_part_7.sql  (bagian 7 dari 8)  -- SANDBOX DOKU SAJA
-- Migrasi 46 s/d 47 dari 49:  20261030140000_prompter_b2_double_payment_safety.sql  ...  20261031100000_prompter_b4_payment_alerts.sql
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- File ini DIBANGUN OTOMATIS oleh tools/build_bundles.py; isi migrasi disalin apa adanya.
-- Jalankan HANYA di project sandbox (cek ref di URL dashboard), SETELAH 00 PASS dan 01 sukses,
-- dan berurutan (bagian 7 butuh 45 migrasi sudah tercatat). Satu transaksi: gagal = tidak ada yang terpasang.
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
  if (select count(*) from public._linoe_sandbox_applied) <> 45 then
    raise exception 'ABORT: urutan salah. Harus ada 45 migrasi tercatat sebelum bagian ini.';
  end if;
end $guard$;

-- >>> 20261030140000_prompter_b2_double_payment_safety.sql  sha256=d4592d2adcd76ab990fa68544e58807be39b70a283b928d95bd709ceb9558c07
-- LINOE Billing B2: double-payment safety + payment idempotency. NOT APPLIED to any database by the PR that adds it.
--
-- Closes (B2 audit, 30 Oct 2026):
--   1. Two paid invoices gave ONE month (fn_apply_verified_payment overwrote current_period_end with now()+1 month).
--   2. A paid invoice for another plan silently changed the plan.
--   3. A PAID transaction could exist without any subscription change (UPDATE matched 0 rows, no error).
--   4. A paid notification for an EXPIRED / CANCELLED / FAILED invoice, or with a wrong amount, was dropped:
--      the customer's money was neither applied nor visible anywhere.
--   5. Several PENDING invoices per tenant could be open at once.
--
-- Founder rules implemented:
--   * Same plan while ACTIVE and the paid period is still running: ONE period (1 month) is ADDED to the existing
--     current_period_end. An expired period restarts from the activation time. The unused-trial bonus (carryover
--     trigger, 20261030100100) still applies exactly once, only on TRIALING -> ACTIVE.
--   * Different plan while a paid period is running: fn_begin_checkout refuses (PLAN_CHANGE_NOT_ALLOWED) and an old
--     invoice that is paid anyway is NOT applied -- it becomes REVIEW (money recorded, nothing silently changed).
--   * At most ONE open PENDING invoice per tenant (partial unique index = race-proof). An identical request within
--     30 minutes returns the same invoice (EXISTING); a different plan/provider supersedes the old one (CANCELLED).
--   * The subscription UPDATE must affect exactly one row, otherwise the whole call fails and nothing is marked PAID.
--   * A paid notification that cannot be applied safely is never ignored and never trusted blindly: the transaction
--     becomes REVIEW (new status) with the reason, the provider ids and the reported amount kept as evidence.
--     fn_resolve_review_payment() (service_role) applies a REVIEW transaction only when the caller supplies gateway evidence
--     (same payment reference, status PAID, matching amount) obtained from the gateway status API (B3). Without that verification it stays REVIEW for manual reconciliation.
--
-- Compatible with #74 (client cannot write subscriptions), #75 (txns only via fn_begin_checkout) and the carryover
-- trigger. No PUBLOE / UMKMpro object is touched. Does not modify any existing row.
-- Rollback: supabase/rollback/20261030140000_prompter_b2_double_payment_safety.down.sql (refuses while REVIEW rows exist).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. New transaction status REVIEW.
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.prompter_payment_transactions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%PENDING%'
  loop
    execute format('alter table public.prompter_payment_transactions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.prompter_payment_transactions
  add constraint prompter_payment_transactions_status_check
  check (status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVIEW'));

-- ---------------------------------------------------------------------------
-- 2. At most one open PENDING invoice per tenant (fails the whole migration if duplicates already exist).
-- ---------------------------------------------------------------------------
create unique index if not exists uq_prompter_payment_txn_one_pending_per_tenant
  on public.prompter_payment_transactions (tenant_id)
  where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- 3. fn_apply_verified_payment v2 (same signature / grants as v1).
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
  v_sub public.prompter_subscriptions%rowtype;
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_rows integer;
  v_review text;
begin
  select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;

  if not found then
    return query select false, 'TRANSACTION_NOT_FOUND'::text;
    return;
  end if;

  if v_txn.status = 'PAID' then
    -- Idempotent redelivery: never activate or extend a second time.
    return query select true, 'ALREADY_PROCESSED'::text;
    return;
  end if;

  if v_txn.status = 'REVIEW' then
    -- Already recorded for manual reconciliation; a redelivery changes nothing.
    return query select false, 'NEEDS_REVIEW'::text;
    return;
  end if;

  if v_txn.status <> 'PENDING' then
    v_review := 'LATE_PAYMENT_' || v_txn.status;
  elsif v_txn.amount <> p_verified_amount or v_txn.currency <> p_verified_currency then
    v_review := 'AMOUNT_OR_CURRENCY_MISMATCH';
  else
    -- Serialise every payment of this tenant on the subscription row (txn row first, then subscription row).
    select * into v_sub from public.prompter_subscriptions where tenant_id = v_txn.tenant_id for update;
    if not found then
      v_review := 'NO_SUBSCRIPTION';
    elsif v_sub.status = 'ACTIVE' and v_sub.current_period_end is not null
          and v_sub.current_period_end > v_now and v_sub.plan <> v_txn.plan then
      v_review := 'PLAN_CONFLICT_ACTIVE_PERIOD';
    end if;
  end if;

  if v_review is not null then
    -- The customer's money may have moved but the subscription must not change: keep the evidence and stop.
    update public.prompter_payment_transactions t
    set status = 'REVIEW',
        failure_reason = v_review,
        provider_payment_id = case
          when p_provider_payment_id is null then t.provider_payment_id
          when exists (select 1 from public.prompter_payment_transactions o
                       where o.provider = t.provider and o.provider_payment_id = p_provider_payment_id and o.id <> t.id)
            then t.provider_payment_id
          else p_provider_payment_id end,
        provider_event_id = coalesce(p_provider_event_id, t.provider_event_id),
        metadata = t.metadata || jsonb_build_object('review', jsonb_build_object(
          'reason', v_review, 'previous_status', v_txn.status,
          'reported_amount', p_verified_amount, 'reported_currency', p_verified_currency, 'at', v_now))
    where t.id = v_txn.id;

    insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
    values (v_txn.tenant_id, v_txn.user_id, 'payment.needs_review', 'prompter_payment_transactions', v_txn.id,
            jsonb_build_object('reason', v_review, 'previous_status', v_txn.status, 'plan', v_txn.plan,
                               'amount', v_txn.amount, 'reported_amount', p_verified_amount, 'provider', v_txn.provider));

    return query select false, 'NEEDS_REVIEW'::text;
    return;
  end if;

  if v_sub.status = 'ACTIVE' and v_sub.current_period_end is not null and v_sub.current_period_end > v_now then
    -- Same plan, paid period still running: ADD one period, never overwrite what the customer already paid for.
    v_start := coalesce(v_sub.current_period_start, v_now);
    v_end := v_sub.current_period_end + interval '1 month';
  else
    v_start := v_now;
    v_end := v_now + interval '1 month';
  end if;

  update public.prompter_payment_transactions
  set status = 'PAID', provider_payment_id = p_provider_payment_id, provider_event_id = p_provider_event_id, paid_at = v_now
  where id = v_txn.id;

  update public.prompter_subscriptions
  set plan = v_txn.plan,
      status = 'ACTIVE',
      billing_provider = v_txn.provider,
      current_period_start = v_start,
      current_period_end = v_end,
      cancel_at_period_end = false
  where tenant_id = v_txn.tenant_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    -- Rolls back the PAID mark above: nothing is reported as applied, the gateway retries.
    raise exception 'SUBSCRIPTION_UPDATE_AFFECTED_% (expected 1)', v_rows using errcode = 'P0001';
  end if;

  insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
  values (
    v_txn.tenant_id, v_txn.user_id, 'payment.succeeded', 'prompter_payment_transactions', v_txn.id,
    jsonb_build_object('plan', v_txn.plan, 'amount', v_txn.amount, 'currency', v_txn.currency, 'provider', v_txn.provider)
  );

  return query select true, null::text;
end;
$$;

comment on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) is
  'Billing B2 (supersedes B10 v1): the only path that may set prompter_subscriptions.status = ACTIVE. Idempotent per transaction; stacks one period onto a running same-plan paid period; never changes the plan during a paid period; marks any payment it cannot apply safely as REVIEW (never drops it); the subscription UPDATE must affect exactly one row. service_role only.';

revoke all on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_apply_verified_payment(uuid, text, text, numeric, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. fn_resolve_review_payment: apply a REVIEW transaction ONLY after the caller verified it with the gateway.
--    p_gateway_verified_amount / currency MUST come from the gateway's own status API (B3), never from the webhook body.
-- ---------------------------------------------------------------------------
create or replace function public.fn_resolve_review_payment(
  p_transaction_id uuid,
  p_gateway_verified_amount numeric,
  p_gateway_verified_currency text,
  p_gateway_reference text,
  p_gateway_status text
)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.prompter_payment_transactions%rowtype;
begin
  select * into v_txn from public.prompter_payment_transactions where id = p_transaction_id for update;
  if not found then
    return query select false, 'TRANSACTION_NOT_FOUND'::text;
    return;
  end if;
  if v_txn.status <> 'REVIEW' then
    return query select false, 'NOT_IN_REVIEW'::text;
    return;
  end if;
  -- The evidence must refer to THE payment the webhook recorded on this transaction, and the gateway must say PAID.
  if v_txn.provider_payment_id is null or coalesce(p_gateway_reference, '') = '' then
    return query select false, 'NO_RECORDED_PAYMENT_REFERENCE'::text;
    return;
  end if;
  if p_gateway_reference <> v_txn.provider_payment_id then
    return query select false, 'GATEWAY_REFERENCE_MISMATCH'::text;
    return;
  end if;
  if p_gateway_status is distinct from 'PAID' then
    return query select false, 'GATEWAY_NOT_PAID'::text;
    return;
  end if;
  if v_txn.amount <> p_gateway_verified_amount or v_txn.currency <> p_gateway_verified_currency then
    return query select false, 'AMOUNT_OR_CURRENCY_MISMATCH'::text;
    return;
  end if;
  if exists (select 1 from public.prompter_payment_transactions o where o.tenant_id = v_txn.tenant_id and o.status = 'PENDING') then
    return query select false, 'OTHER_PENDING_INVOICE'::text;
    return;
  end if;

  insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, resource_id, context)
  values (v_txn.tenant_id, null, 'payment.review_resolution_attempted', 'prompter_payment_transactions', v_txn.id,
          jsonb_build_object('gateway_reference', p_gateway_reference, 'gateway_status', p_gateway_status,
                             'gateway_amount', p_gateway_verified_amount, 'currency', p_gateway_verified_currency,
                             'review_reason', v_txn.failure_reason));

  -- Re-run the normal, fully guarded activation path (it may legitimately send it back to REVIEW).
  update public.prompter_payment_transactions set status = 'PENDING', failure_reason = null where id = v_txn.id;
  return query select * from public.fn_apply_verified_payment(
    v_txn.id, v_txn.provider_payment_id, v_txn.provider_event_id, p_gateway_verified_amount, p_gateway_verified_currency);
end;
$$;

comment on function public.fn_resolve_review_payment(uuid, numeric, text, text, text) is
  'Billing B2: applies a REVIEW transaction ONLY when the caller supplies gateway evidence (the same payment reference the webhook recorded, status PAID, matching amount/currency) obtained from the gateway status API (B3), never from the webhook body. Writes an audit row, then re-runs fn_apply_verified_payment so every safety rule still holds. service_role only; no application route calls it yet.';

revoke all on function public.fn_resolve_review_payment(uuid, numeric, text, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_resolve_review_payment(uuid, numeric, text, text, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. fn_begin_checkout v2 (same signature / grants as B1; adds the B2 rules).
--    Outcomes: CREATED | EXISTING | INVALID | NOT_MEMBER | NOT_OWNER | PLAN_NOT_PURCHASABLE | PLAN_NOT_AVAILABLE |
--              NO_SUBSCRIPTION | PLAN_CHANGE_NOT_ALLOWED | TOO_MANY_PENDING
-- ---------------------------------------------------------------------------
create or replace function public.fn_begin_checkout(
  p_tenant_id uuid,
  p_user_id uuid,
  p_plan text,
  p_provider text
) returns table(out_transaction_id uuid, out_amount numeric, out_currency text, out_outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_tenant uuid;
  v_role text;
  v_price integer;
  v_currency text;
  v_availability text;
  v_sub_status text;
  v_sub_plan text;
  v_sub_end timestamptz;
  v_attempts integer;
  v_open public.prompter_payment_transactions%rowtype;
  v_new uuid;
begin
  if p_tenant_id is null or p_user_id is null
     or coalesce(p_plan, '') = ''
     or p_provider is null or p_provider !~ '^[A-Za-z0-9_-]{2,40}$' then
    return query select null::uuid, null::numeric, null::text, 'INVALID'::text;
    return;
  end if;

  select tenant_id, role into v_member_tenant, v_role from public.user_profiles where id = p_user_id;
  if not found or v_member_tenant is distinct from p_tenant_id then
    return query select null::uuid, null::numeric, null::text, 'NOT_MEMBER'::text;
    return;
  end if;
  if v_role is distinct from 'owner' then
    return query select null::uuid, null::numeric, null::text, 'NOT_OWNER'::text;
    return;
  end if;

  select pr.price_idr, pr.currency, e.availability
    into v_price, v_currency, v_availability
  from public.prompter_plan_prices pr
  join public.prompter_plan_entitlements e on e.plan = pr.plan
  where pr.plan = p_plan;
  if not found then
    return query select null::uuid, null::numeric, null::text, 'PLAN_NOT_PURCHASABLE'::text;
    return;
  end if;
  if v_availability is distinct from 'ACTIVE' then
    return query select null::uuid, null::numeric, null::text, 'PLAN_NOT_AVAILABLE'::text;
    return;
  end if;

  select status, plan, current_period_end into v_sub_status, v_sub_plan, v_sub_end
  from public.prompter_subscriptions where tenant_id = p_tenant_id;
  if not found then
    return query select null::uuid, null::numeric, null::text, 'NO_SUBSCRIPTION'::text;
    return;
  end if;

  -- MVP rule: no plan change while a paid period is running.
  if v_sub_status = 'ACTIVE' and v_sub_end is not null and v_sub_end > now() and v_sub_plan is distinct from p_plan then
    return query select null::uuid, null::numeric, null::text, 'PLAN_CHANGE_NOT_ALLOWED'::text;
    return;
  end if;

  -- Serialise checkout creation per tenant.
  perform pg_advisory_xact_lock(hashtext('prompter_checkout:' || p_tenant_id::text));

  select * into v_open from public.prompter_payment_transactions
  where tenant_id = p_tenant_id and status = 'PENDING' for update;
  if found and v_open.plan = p_plan and v_open.provider = p_provider and v_open.created_at > now() - interval '30 minutes' then
    return query select v_open.id, v_open.amount, v_open.currency, 'EXISTING'::text;
    return;
  end if;

  -- Spam / enumeration guard on creation churn (any status). Checked BEFORE anything is changed.
  select count(*) into v_attempts
  from public.prompter_payment_transactions
  where tenant_id = p_tenant_id and created_at > now() - interval '1 hour';
  if v_attempts >= 20 then
    return query select null::uuid, null::numeric, null::text, 'TOO_MANY_PENDING'::text;
    return;
  end if;

  if v_open.id is not null then
    -- A different / older request replaces the open invoice. If it is paid anyway it ends in REVIEW, never lost.
    update public.prompter_payment_transactions
    set status = 'CANCELLED', failure_reason = 'SUPERSEDED_BY_NEWER_CHECKOUT'
    where id = v_open.id;
  end if;

  insert into public.prompter_payment_transactions (tenant_id, user_id, provider, plan, amount, currency)
  values (p_tenant_id, p_user_id, p_provider, p_plan, v_price, v_currency)
  returning id into v_new;

  return query select v_new, v_price::numeric, v_currency, 'CREATED'::text;
end;
$$;

comment on function public.fn_begin_checkout(uuid, uuid, text, text) is
  'Billing B2 (supersedes B1 v1): creates the single open PENDING invoice of a tenant, priced from prompter_plan_prices (no amount parameter). Returns the same invoice for an identical request within 30 minutes (EXISTING), supersedes a different one, refuses a plan change during a paid period. service_role only.';

revoke all on function public.fn_begin_checkout(uuid, uuid, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_begin_checkout(uuid, uuid, text, text) to service_role;
  end if;
end $$;
insert into public._linoe_sandbox_applied (version, sha256) values ('20261030140000', 'd4592d2adcd76ab990fa68544e58807be39b70a283b928d95bd709ceb9558c07');

-- >>> 20261031100000_prompter_b4_payment_alerts.sql  sha256=5629249a858cbc19720f29d959a03ba802f0ddf7318ef27c57fb94d21c336827
-- LINOE Billing B4.1: payment alert queue (REVIEW + refund / chargeback / reversal). NOT APPLIED to any database by the PR that adds it.
--
-- Why (B3 review + B4 audit, 30 Oct 2026):
--   * B3 recorded refund / chargeback / reversal as an audit row. prompter_audit_logs is TENANT-WRITABLE (policy "Tulis audit log
--     sebagai diri sendiri"), so a tenant member could forge a row and suppress a real alarm. It is no longer a source of truth.
--   * REVIEW transactions (B2) had no queue and no recipient.
--
-- What this adds (all additive, own prompter_ objects, nothing of PUBLOE / UMKMpro / Finance Hub is touched):
--   prompter_payment_operators            allowlist of auth user ids that may work the queue (service_role only; filled by the Founder in the SQL Editor)
--   prompter_payment_alerts               ONE row per (transaction, kind); service_role only; RLS on, no policy, no grant to anon / authenticated
--   prompter_payment_alert_actions        append-only history of ACK / RESOLVE / AUTO_RESOLVE / REOPEN (update / delete / truncate blocked)
--   prompter_payment_alert_evidence       append-only registry of the trusted EVENT IDENTITIES (evidence refs) already seen per alert, with the
--                                         evidence snapshot of each. This is what separates "a NEW verified event" (reopens a RESOLVED alert,
--                                         exactly once, even under parallel calls) from "a replay of an old one" (never reopens; only counted)
--   prompter_payment_alert_sync_state     single row: last attempt / success / error of the sync (observability only)
--   fn_record_payment_alarm(...)          idempotent create-or-reopen of a refund / chargeback / reversal alert (called by the server after a gateway-VERIFIED
--                                         answer, with the evidence ref derived from the gateway's own answer). Unknown ref on a RESOLVED alert -> REOPENED
--                                         (reopened_count + 1, REOPEN history); known ref -> REPEAT (repeat_count + 1, stays RESOLVED); row-locked, parallel-safe
--   fn_sync_payment_alerts(...)           derives alerts from TRUSTED sources only: transactions in REVIEW + server-written webhook events
--                                         (ALARM_*); CREATES missing alerts (never reopens: reopening is only done by fn_record_payment_alarm, which
--                                         sees the gateway-verified evidence); auto-resolves REVIEW alerts whose transaction left REVIEW. Idempotent, advisory-lock guarded,
--                                         one transaction (a failure rolls back and the next run re-derives everything: nothing is lost)
--   fn_ack_payment_alert / fn_resolve_payment_alert   operator actions. They change ONLY the alert row + history. They never touch a
--                                         transaction or a subscription and never move money.
--   fn_note_payment_alert_sync_failure    records a failed sync attempt (the failed transaction itself cannot)
--   fn_is_payment_operator
--
-- All functions use `set search_path = public, pg_temp` (pg_temp LAST: a temp object can never shadow a public one inside SECURITY DEFINER code).
-- No pg_cron / pg_net is used or assumed here. Scheduling is a separate, optional, Founder-approved step (see docs/BILLING_B4_PAYMENT_ALERTS.md).
-- Rollback: supabase/rollback/20261031100000_prompter_b4_payment_alerts.down.sql (refuses while any alert is not RESOLVED).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. Operator allowlist
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_payment_operators (
  user_id uuid primary key,
  label text not null check (length(btrim(label)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text
);
comment on table public.prompter_payment_operators is
  'LINOE B4: auth user ids allowed to work the payment alert queue. service_role only. Managed manually by the Founder (SQL Editor).';

-- ---------------------------------------------------------------------------
-- 2. Alerts
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_payment_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('REVIEW', 'REFUND', 'CHARGEBACK', 'REVERSAL')),
  severity text not null check (severity in ('HIGH', 'CRITICAL')),
  state text not null default 'OPEN' check (state in ('OPEN', 'ACKED', 'RESOLVED')),
  -- no foreign key on purpose: a tenant / data-deletion cascade must never be blocked by (or silently erase) this evidence.
  transaction_id uuid not null,
  tenant_id uuid not null,
  source text not null check (source in ('TXN_REVIEW', 'WEBHOOK_EVENT', 'VERIFIED_CALL')),
  reason text,
  evidence jsonb not null default '{}'::jsonb check (length(evidence::text) <= 4000),
  first_seen_at timestamptz not null default now(),
  acked_by uuid,
  acked_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution text check (resolution in ('OPERATOR', 'AUTO')),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 1000),
  -- B4.1: a NEW verified event on a RESOLVED alert reopens it (never silently swallowed); a replay is only counted
  reopened_count integer not null default 0,
  last_reopened_at timestamptz,
  repeat_count integer not null default 0,
  last_repeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the dedupe rule: one alert per transaction and kind, enforced by the database, not by application code
  constraint uq_prompter_payment_alert_txn_kind unique (transaction_id, kind),
  constraint ck_prompter_payment_alert_resolved check (
    (state = 'RESOLVED') = (resolved_at is not null and resolution is not null)
  ),
  constraint ck_prompter_payment_alert_operator_resolution check (
    resolution is distinct from 'OPERATOR' or (resolved_by is not null and length(btrim(coalesce(resolution_note, ''))) >= 5)
  )
);
create index if not exists idx_prompter_payment_alerts_queue
  on public.prompter_payment_alerts (state, severity, first_seen_at desc);
comment on table public.prompter_payment_alerts is
  'LINOE B4: payment alert queue. Derived from trusted server-side sources only. service_role only; never readable or writable by tenants.';

-- ---------------------------------------------------------------------------
-- 3. Append-only history
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_payment_alert_actions (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.prompter_payment_alerts(id) on delete restrict,
  action text not null check (action in ('ACK', 'RESOLVE', 'AUTO_RESOLVE', 'REOPEN')),
  actor_user_id uuid,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists idx_prompter_payment_alert_actions_alert
  on public.prompter_payment_alert_actions (alert_id, created_at);

-- Registry of event identities already seen per alert. PRIMARY KEY (alert_id, evidence_ref) is the exactly-once guard.
create table if not exists public.prompter_payment_alert_evidence (
  alert_id uuid not null references public.prompter_payment_alerts(id) on delete restrict,
  evidence_ref text not null check (length(evidence_ref) between 1 and 200),
  source text not null check (source in ('VERIFIED_CALL', 'WEBHOOK_EVENT')),
  evidence jsonb not null default '{}'::jsonb check (length(evidence::text) <= 4000),
  seen_at timestamptz not null default now(),
  primary key (alert_id, evidence_ref)
);

create or replace function public.fn_prompter_payment_alert_protect()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'prompter_payment_alert_* rows are evidence and cannot be deleted or truncated (% on %)', tg_op, tg_table_name;
end $$;

create or replace function public.fn_prompter_payment_alert_actions_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only (% blocked)', tg_table_name, tg_op;
end $$;

drop trigger if exists trg_prompter_payment_alerts_no_delete on public.prompter_payment_alerts;
create trigger trg_prompter_payment_alerts_no_delete
  before delete on public.prompter_payment_alerts
  for each row execute function public.fn_prompter_payment_alert_protect();
drop trigger if exists trg_prompter_payment_alerts_no_truncate on public.prompter_payment_alerts;
create trigger trg_prompter_payment_alerts_no_truncate
  before truncate on public.prompter_payment_alerts
  for each statement execute function public.fn_prompter_payment_alert_protect();

drop trigger if exists trg_prompter_payment_alert_actions_immutable on public.prompter_payment_alert_actions;
create trigger trg_prompter_payment_alert_actions_immutable
  before update or delete on public.prompter_payment_alert_actions
  for each row execute function public.fn_prompter_payment_alert_actions_immutable();
drop trigger if exists trg_prompter_payment_alert_actions_no_truncate on public.prompter_payment_alert_actions;
create trigger trg_prompter_payment_alert_actions_no_truncate
  before truncate on public.prompter_payment_alert_actions
  for each statement execute function public.fn_prompter_payment_alert_actions_immutable();

drop trigger if exists trg_prompter_payment_alert_evidence_immutable on public.prompter_payment_alert_evidence;
create trigger trg_prompter_payment_alert_evidence_immutable
  before update or delete on public.prompter_payment_alert_evidence
  for each row execute function public.fn_prompter_payment_alert_actions_immutable();
drop trigger if exists trg_prompter_payment_alert_evidence_no_truncate on public.prompter_payment_alert_evidence;
create trigger trg_prompter_payment_alert_evidence_no_truncate
  before truncate on public.prompter_payment_alert_evidence
  for each statement execute function public.fn_prompter_payment_alert_actions_immutable();

-- ---------------------------------------------------------------------------
-- 4. Sync state (observability only)
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_payment_alert_sync_state (
  id smallint primary key check (id = 1),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  consecutive_failures integer not null default 0,
  last_counts jsonb not null default '{}'::jsonb
);
insert into public.prompter_payment_alert_sync_state (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Privileges: service_role only. RLS enabled with NO policy = deny for everyone else, even if a grant leaks.
-- ---------------------------------------------------------------------------
alter table public.prompter_payment_operators enable row level security;
alter table public.prompter_payment_alerts enable row level security;
alter table public.prompter_payment_alert_actions enable row level security;
alter table public.prompter_payment_alert_evidence enable row level security;
alter table public.prompter_payment_alert_sync_state enable row level security;

revoke all on table public.prompter_payment_operators from public, anon, authenticated;
revoke all on table public.prompter_payment_alerts from public, anon, authenticated;
revoke all on table public.prompter_payment_alert_actions from public, anon, authenticated;
revoke all on table public.prompter_payment_alert_evidence from public, anon, authenticated;
revoke all on table public.prompter_payment_alert_sync_state from public, anon, authenticated;

grant select on public.prompter_payment_operators to service_role;
grant select, insert, update on public.prompter_payment_alerts to service_role;
grant select, insert on public.prompter_payment_alert_actions to service_role;
grant select, insert on public.prompter_payment_alert_evidence to service_role;
grant select, update on public.prompter_payment_alert_sync_state to service_role;

-- ---------------------------------------------------------------------------
-- 6. Functions
-- ---------------------------------------------------------------------------
create or replace function public.fn_is_payment_operator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.prompter_payment_operators o where o.user_id = p_user_id and o.active);
$$;

-- Direct create-or-reopen of a refund / chargeback / reversal alert. The caller (server) passes a gateway-VERIFIED fact and
-- p_evidence_ref, the identity of that fact derived from the gateway's own Get Status answer (never from a webhook body or a
-- tenant-writable table). Outcomes:
--   CREATED   first time for (transaction, kind)
--   REOPENED  RESOLVED alert + a ref never seen for it  -> OPEN again, reopened_count + 1, REOPEN history (exactly once, row-locked)
--   REPEAT    RESOLVED alert + a ref already seen       -> stays RESOLVED, repeat_count + 1 (a replay; nothing is lost, nothing reopens)
--   EXISTING  alert is OPEN / ACKED (a new ref is still registered); the operator is already looking at it
create or replace function public.fn_record_payment_alarm(
  p_transaction_id uuid,
  p_kind text,
  p_evidence jsonb default '{}'::jsonb,
  p_evidence_ref text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_state text;
  v_new boolean;
  v_evidence jsonb := coalesce(p_evidence, '{}'::jsonb);
begin
  if p_kind is null or p_kind not in ('REFUND', 'CHARGEBACK', 'REVERSAL') then
    return 'INVALID_KIND';
  end if;
  if p_evidence_ref is null or length(btrim(p_evidence_ref)) = 0 or length(p_evidence_ref) > 200 then
    return 'INVALID_EVIDENCE_REF';
  end if;
  if length(v_evidence::text) > 4000 then
    return 'EVIDENCE_TOO_LARGE';
  end if;
  select tenant_id into v_tenant from public.prompter_payment_transactions where id = p_transaction_id;
  if not found then
    return 'TRANSACTION_NOT_FOUND';
  end if;

  -- Serialise everything that concerns ONE alert on its row lock.
  select id, state into v_id, v_state
    from public.prompter_payment_alerts where transaction_id = p_transaction_id and kind = p_kind for update;

  if not found then
    insert into public.prompter_payment_alerts (kind, severity, transaction_id, tenant_id, source, reason, evidence)
    values (p_kind, case when p_kind = 'CHARGEBACK' then 'CRITICAL' else 'HIGH' end,
            p_transaction_id, v_tenant, 'VERIFIED_CALL', 'GATEWAY_' || p_kind, v_evidence)
    on conflict (transaction_id, kind) do nothing
    returning id into v_id;
    if v_id is not null then
      insert into public.prompter_payment_alert_evidence (alert_id, evidence_ref, source, evidence)
      values (v_id, p_evidence_ref, 'VERIFIED_CALL', v_evidence);
      return 'CREATED';
    end if;
    -- another caller created it between our SELECT and INSERT: continue as an existing alert
    select id, state into v_id, v_state
      from public.prompter_payment_alerts where transaction_id = p_transaction_id and kind = p_kind for update;
  end if;

  -- PRIMARY KEY (alert_id, evidence_ref): only the first caller with a given ref sees v_new = true
  insert into public.prompter_payment_alert_evidence (alert_id, evidence_ref, source, evidence)
  values (v_id, p_evidence_ref, 'VERIFIED_CALL', v_evidence)
  on conflict (alert_id, evidence_ref) do nothing
  returning true into v_new;

  if v_new is not true then
    if v_state = 'RESOLVED' then
      update public.prompter_payment_alerts
         set repeat_count = repeat_count + 1, last_repeat_at = now(), updated_at = now()
       where id = v_id;
      return 'REPEAT';
    end if;
    return 'EXISTING';
  end if;

  if v_state = 'RESOLVED' then
    update public.prompter_payment_alerts
       set state = 'OPEN', reopened_count = reopened_count + 1, last_reopened_at = now(), evidence = v_evidence,
           acked_by = null, acked_at = null, resolved_by = null, resolved_at = null, resolution = null,
           resolution_note = null, updated_at = now()
     where id = v_id;
    insert into public.prompter_payment_alert_actions (alert_id, action, note)
    values (v_id, 'REOPEN', left('Bukti baru terverifikasi: ' || p_evidence_ref, 1000));
    return 'REOPENED';
  end if;
  return 'EXISTING';
end $$;

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

create or replace function public.fn_ack_payment_alert(p_alert_id uuid, p_operator uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.fn_is_payment_operator(p_operator) then
    return 'NOT_OPERATOR';
  end if;
  if p_note is not null and length(p_note) > 1000 then
    return 'NOTE_TOO_LONG';
  end if;

  update public.prompter_payment_alerts
     set state = 'ACKED', acked_by = p_operator, acked_at = now(), updated_at = now()
   where id = p_alert_id and state = 'OPEN'
  returning id into v_id;

  if v_id is null then
    return case when exists (select 1 from public.prompter_payment_alerts where id = p_alert_id)
                then 'INVALID_STATE' else 'NOT_FOUND' end;
  end if;
  insert into public.prompter_payment_alert_actions (alert_id, action, actor_user_id, note)
  values (v_id, 'ACK', p_operator, p_note);
  return 'ACKED';
end $$;

create or replace function public.fn_resolve_payment_alert(p_alert_id uuid, p_operator uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.fn_is_payment_operator(p_operator) then
    return 'NOT_OPERATOR';
  end if;
  if p_note is null or length(btrim(p_note)) < 5 then
    return 'NOTE_REQUIRED';
  end if;
  if length(p_note) > 1000 then
    return 'NOTE_TOO_LONG';
  end if;

  update public.prompter_payment_alerts
     set state = 'RESOLVED', resolution = 'OPERATOR', resolved_by = p_operator, resolved_at = now(),
         resolution_note = btrim(p_note), updated_at = now()
   where id = p_alert_id and state in ('OPEN', 'ACKED')
  returning id into v_id;

  if v_id is null then
    return case when exists (select 1 from public.prompter_payment_alerts where id = p_alert_id)
                then 'INVALID_STATE' else 'NOT_FOUND' end;
  end if;
  insert into public.prompter_payment_alert_actions (alert_id, action, actor_user_id, note)
  values (v_id, 'RESOLVE', p_operator, btrim(p_note));
  return 'RESOLVED';
end $$;

-- Functions are service_role only (the Supabase default grants EXECUTE to PUBLIC / anon / authenticated).
revoke all on function public.fn_is_payment_operator(uuid) from public, anon, authenticated;
revoke all on function public.fn_record_payment_alarm(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.fn_sync_payment_alerts(interval) from public, anon, authenticated;
revoke all on function public.fn_note_payment_alert_sync_failure(text) from public, anon, authenticated;
revoke all on function public.fn_ack_payment_alert(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fn_resolve_payment_alert(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_is_payment_operator(uuid) to service_role;
grant execute on function public.fn_record_payment_alarm(uuid, text, jsonb, text) to service_role;
grant execute on function public.fn_sync_payment_alerts(interval) to service_role;
grant execute on function public.fn_note_payment_alert_sync_failure(text) to service_role;
grant execute on function public.fn_ack_payment_alert(uuid, uuid, text) to service_role;
grant execute on function public.fn_resolve_payment_alert(uuid, uuid, text) to service_role;
insert into public._linoe_sandbox_applied (version, sha256) values ('20261031100000', '5629249a858cbc19720f29d959a03ba802f0ddf7318ef27c57fb94d21c336827');

commit;
