-- ============================================================================
-- 10_migrations_part_5.sql  (bagian 5 dari 8)  -- SANDBOX DOKU SAJA
-- Migrasi 33 s/d 40 dari 49:  20261018160000_prompter_manual_ad_metrics.sql  ...  20261027110000_linoe_admin_center_access.sql
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- File ini DIBANGUN OTOMATIS oleh tools/build_bundles.py; isi migrasi disalin apa adanya.
-- Jalankan HANYA di project sandbox (cek ref di URL dashboard), SETELAH 00 PASS dan 01 sukses,
-- dan berurutan (bagian 5 butuh 32 migrasi sudah tercatat). Satu transaksi: gagal = tidak ada yang terpasang.
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
  if (select count(*) from public._linoe_sandbox_applied) <> 32 then
    raise exception 'ABORT: urutan salah. Harus ada 32 migrasi tercatat sebelum bagian ini.';
  end if;
end $guard$;

-- >>> 20261018160000_prompter_manual_ad_metrics.sql  sha256=ffbf01cbf3f8e800796558451b8ab2ebabec39de8da8eec17106116a89b78709
-- LINOE Winning Ads Intelligence -- Phase 2B: manual ad metrics.
-- Founder-approved design (Option B): a NEW, isolated table for ad metrics a
-- user types in by hand for ads they run themselves, so the Ad Performance
-- Verdict (Phase 2A) can be computed without waiting for the Meta Ads API.
--
-- PREPARED FOR REVIEW ONLY. NOT APPLIED TO PRODUCTION BY THIS CHANGE.
-- Applying it to the shared Supabase project needs separate Founder approval
-- (never `supabase db push` on that project -- see README / docs/DATABASE.md).
-- The application fails closed (feature shows "belum aktif") while the table
-- does not exist.
--
-- ADDITIVE ONLY: one new table, two new functions, two new triggers. It does
-- not alter public.prompter_marketing_metrics (the connector-written table that
-- Budget Guard, Optimization and Analytics read), public.prompter_channel_campaigns,
-- or any other existing object. Nothing reads this table except the Phase 2B
-- verdict section -- in particular NOT Budget Guard (manual spend must never
-- count toward, or lower, an enforcement limit) and NOT the H1/H2 launch path.
--
-- Tenant integrity (the point of this migration's design): the references
-- master_campaign_id / channel_campaign_id are validated against the
-- tenant-owned channel campaign in TWO independent layers that both apply when
-- a client writes straight through the database API (PostgREST), bypassing any
-- server action:
--   1. RLS WITH CHECK (insert/update) requires the channel campaign to exist
--      with the same tenant_id, the same master campaign and channel, and no
--      external_campaign_id.
--   2. A BEFORE INSERT/UPDATE trigger (SECURITY DEFINER, pinned search_path)
--      re-checks the same facts without depending on the caller's RLS view,
--      rejects a future date, and freezes identity columns on update.
--
-- Audit (atomic): an AFTER INSERT/UPDATE/DELETE row trigger writes the
-- prompter_audit_logs row in the SAME transaction as the change. If the audit
-- insert fails the data change rolls back; if the data change fails (CHECK,
-- unique, RLS, guard) no audit row survives. It also covers writes made
-- straight through the database API (PostgREST), which no server action sees.
-- The application therefore writes NO audit rows for this table itself.
-- The older prompter_marketing_metrics policy does NOT do this; that finding is
-- documented in docs/DATABASE.md and is remediated separately, not in this PR.

create table if not exists public.prompter_manual_ad_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  master_campaign_id uuid not null references public.prompter_master_campaigns(id) on delete cascade,
  channel_campaign_id uuid not null references public.prompter_channel_campaigns(id) on delete cascade,
  channel text not null,
  metric_date date not null,
  spend numeric(14, 2) not null,
  impressions bigint not null,
  clicks bigint not null,
  conversions bigint not null,
  revenue numeric(14, 2) not null,
  currency text not null,
  entered_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_manual_ad_metrics_unique unique (channel_campaign_id, metric_date),
  constraint prompter_manual_ad_metrics_channel check (channel in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X')),
  constraint prompter_manual_ad_metrics_currency check (currency ~ '^[A-Z]{3}$'),
  constraint prompter_manual_ad_metrics_date_floor check (metric_date >= date '2020-01-01'),
  constraint prompter_manual_ad_metrics_spend_range check (spend >= 0 and spend <= 100000000000),
  constraint prompter_manual_ad_metrics_revenue_range check (revenue >= 0 and revenue <= 100000000000),
  constraint prompter_manual_ad_metrics_impressions_range check (impressions >= 0 and impressions <= 10000000000),
  constraint prompter_manual_ad_metrics_clicks_le_impressions check (clicks >= 0 and clicks <= impressions),
  constraint prompter_manual_ad_metrics_conversions_le_clicks check (conversions >= 0 and conversions <= clicks),
  constraint prompter_manual_ad_metrics_revenue_needs_conversions check (revenue = 0 or conversions > 0)
);

comment on table public.prompter_manual_ad_metrics is
  'LINOE Winning Ads Phase 2B: daily ad metrics typed in manually by owner/marketing for ads run outside LINOE. UNVERIFIED by any ad platform. Isolated from prompter_marketing_metrics (connector data): never read by Budget Guard, Optimization or the launch path.';

create index if not exists idx_prompter_manual_ad_metrics_tenant
  on public.prompter_manual_ad_metrics (tenant_id, metric_date desc);
create index if not exists idx_prompter_manual_ad_metrics_master
  on public.prompter_manual_ad_metrics (master_campaign_id);

-- Tenant / ownership / state guard. SECURITY DEFINER so the check does not
-- depend on what the caller's RLS lets them see; the tenant comparison is
-- explicit. Not callable as a function by clients (revoked below); it only
-- runs as a trigger.
create or replace function public.fn_prompter_manual_ad_metrics_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cc record;
  v_actor uuid;
begin
  select tenant_id, master_campaign_id, channel, external_campaign_id
    into v_cc
    from public.prompter_channel_campaigns
   where id = new.channel_campaign_id;

  if not found then
    raise exception 'manual_ad_metrics: channel campaign not found' using errcode = '23503';
  end if;
  if v_cc.tenant_id is distinct from new.tenant_id then
    raise exception 'manual_ad_metrics: channel campaign belongs to another tenant' using errcode = '42501';
  end if;
  if v_cc.master_campaign_id is distinct from new.master_campaign_id then
    raise exception 'manual_ad_metrics: master campaign does not match the channel campaign' using errcode = '23514';
  end if;
  if v_cc.channel is distinct from new.channel then
    raise exception 'manual_ad_metrics: channel does not match the channel campaign' using errcode = '23514';
  end if;
  if v_cc.external_campaign_id is not null then
    raise exception 'manual_ad_metrics: channel campaign already has an external campaign id (platform data is the source of truth)' using errcode = '23514';
  end if;
  if new.metric_date > (current_date + 1) then
    raise exception 'manual_ad_metrics: metric_date is in the future' using errcode = '23514';
  end if;

  v_actor := auth.uid();

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.entered_by := v_actor;
    end if;
    new.updated_by := new.entered_by;
  else
    if new.tenant_id is distinct from old.tenant_id
       or new.master_campaign_id is distinct from old.master_campaign_id
       or new.channel_campaign_id is distinct from old.channel_campaign_id
       or new.channel is distinct from old.channel
       or new.metric_date is distinct from old.metric_date
       or new.currency is distinct from old.currency then
      raise exception 'manual_ad_metrics: identity columns are immutable (delete and re-add instead)' using errcode = '23514';
    end if;
    new.entered_by := old.entered_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(v_actor, new.updated_by);
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.fn_prompter_manual_ad_metrics_guard() from public, anon, authenticated;

drop trigger if exists trg_prompter_manual_ad_metrics_guard on public.prompter_manual_ad_metrics;
create trigger trg_prompter_manual_ad_metrics_guard
  before insert or update on public.prompter_manual_ad_metrics
  for each row execute function public.fn_prompter_manual_ad_metrics_guard();

-- Atomic audit trail. SECURITY DEFINER so the audit row is written regardless of
-- the caller's RLS on prompter_audit_logs (the table owner is not subject to RLS
-- there; FORCE RLS is off). The tenant comes from the audited row itself (which
-- RLS/guard already tied to the caller's tenant), the actor from auth.uid()
-- (NULL for service_role/SQL sessions), never from client input. Trigger-only:
-- execute is revoked from every client role.
create or replace function public.fn_prompter_manual_ad_metrics_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.prompter_manual_ad_metrics;
  v_action text;
  v_before jsonb := null;
  v_after jsonb := null;
  v_constraint text;
begin
  if tg_op = 'INSERT' then
    v_row := new;
    v_action := 'manual_metrics.create';
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_row := new;
    v_action := 'manual_metrics.update';
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
  else
    v_row := old;
    v_action := 'manual_metrics.delete';
    v_before := to_jsonb(old);
  end if;

  begin
    insert into public.prompter_audit_logs
      (tenant_id, actor_user_id, action, resource_type, resource_id, before_data, after_data, context)
    values (
      v_row.tenant_id,
      auth.uid(),
      v_action,
      'prompter_manual_ad_metrics',
      v_row.id,
      v_before,
      v_after,
      jsonb_build_object(
        'source', 'manual',
        'verified_by_platform', false,
        'recorded_by', 'db_trigger',
        'channel_campaign_id', v_row.channel_campaign_id,
        'metric_date', v_row.metric_date
      )
    );
  exception when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- The ONLY tolerated failure: the tenant itself is being deleted and this row
    -- is going away through ON DELETE CASCADE, so its audit parent is already
    -- gone. Any other audit failure (including a missing actor) aborts the change.
    if tg_op = 'DELETE' and v_constraint = 'prompter_audit_logs_tenant_id_fkey' then
      return old;
    end if;
    raise;
  end;

  return null;
end;
$$;

revoke all on function public.fn_prompter_manual_ad_metrics_audit() from public, anon, authenticated;

drop trigger if exists trg_prompter_manual_ad_metrics_audit on public.prompter_manual_ad_metrics;
create trigger trg_prompter_manual_ad_metrics_audit
  after insert or update or delete on public.prompter_manual_ad_metrics
  for each row execute function public.fn_prompter_manual_ad_metrics_audit();

alter table public.prompter_manual_ad_metrics enable row level security;

-- Supabase default privileges grant ALL (incl. TRUNCATE, REFERENCES, TRIGGER) to
-- anon and authenticated on every new public table. Drop them all, then grant
-- back only what the RLS policies below are written for. service_role keeps its
-- default access (server-side admin client; bypasses RLS by design).
revoke all on public.prompter_manual_ad_metrics from public, anon, authenticated;
grant select, insert, update, delete on public.prompter_manual_ad_metrics to authenticated;

drop policy if exists "Lihat metrik iklan manual tenant sendiri" on public.prompter_manual_ad_metrics;
create policy "Lihat metrik iklan manual tenant sendiri"
  on public.prompter_manual_ad_metrics for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing tambah metrik iklan manual" on public.prompter_manual_ad_metrics;
create policy "Owner/marketing tambah metrik iklan manual"
  on public.prompter_manual_ad_metrics for insert
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
    and exists (
      select 1
        from public.prompter_channel_campaigns cc
       where cc.id = prompter_manual_ad_metrics.channel_campaign_id
         and cc.tenant_id = prompter_manual_ad_metrics.tenant_id
         and cc.master_campaign_id = prompter_manual_ad_metrics.master_campaign_id
         and cc.channel = prompter_manual_ad_metrics.channel
         and cc.external_campaign_id is null
    )
  );

drop policy if exists "Owner/marketing ubah metrik iklan manual" on public.prompter_manual_ad_metrics;
create policy "Owner/marketing ubah metrik iklan manual"
  on public.prompter_manual_ad_metrics for update
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
    and exists (
      select 1
        from public.prompter_channel_campaigns cc
       where cc.id = prompter_manual_ad_metrics.channel_campaign_id
         and cc.tenant_id = prompter_manual_ad_metrics.tenant_id
         and cc.master_campaign_id = prompter_manual_ad_metrics.master_campaign_id
         and cc.channel = prompter_manual_ad_metrics.channel
         and cc.external_campaign_id is null
    )
  );

drop policy if exists "Owner/marketing hapus metrik iklan manual" on public.prompter_manual_ad_metrics;
create policy "Owner/marketing hapus metrik iklan manual"
  on public.prompter_manual_ad_metrics for delete
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));
insert into public._linoe_sandbox_applied (version, sha256) values ('20261018160000', 'ffbf01cbf3f8e800796558451b8ab2ebabec39de8da8eec17106116a89b78709');

-- >>> 20261019100000_prompter_p0_ai_jobs_lockdown.sql  sha256=0da43286f1e8a60123bd0272ab1e668146bb5bd37a90059c725d33f369d8ba66
-- P0-1 remediation: a tenant must not be able to reset its own AI quota.
--
-- Finding (verified against the production catalog, read-only): the trial and
-- plan AI quota is counted from rows of public.prompter_ai_jobs
-- (fn_create_ai_job_if_entitled: count(*) ... created_at >= period start).
-- The table's RLS policy "Owner/marketing buat & ubah ai job" is FOR ALL, and
-- `authenticated` holds table-level INSERT/UPDATE/DELETE, so an owner or
-- marketing user could, with their own JWT through the REST API, DELETE their
-- job rows or PATCH created_at and bring the count back to zero.
--
-- Fix: privileges, not policy. The RLS policy and tenant isolation are left
-- untouched.
--   * INSERT: only fn_create_ai_job_if_entitled() creates jobs. It is
--     SECURITY DEFINER owned by postgres, so it is unaffected by this revoke.
--   * DELETE / TRUNCATE: no client path. (The only legitimate delete, the
--     "AI not configured" branch in services/ai-jobs.ts, no longer exists:
--     configuration is now checked BEFORE a job is created, and the
--     unreachable fallback uses the server-side admin client.)
--   * UPDATE: restricted to the bookkeeping columns services/ai-jobs.ts
--     writes after the model call. created_at, tenant_id, job_type,
--     actor_user_id, input_reference and estimated_cost become immutable for
--     clients, so a job row can no longer be moved out of the counting window
--     or re-assigned.
--
-- service_role is not touched (it keeps its grants). No data is changed.
-- Rollback: supabase/rollback/20261019100000_prompter_p0_ai_jobs_lockdown.down.sql

revoke insert, delete, truncate on public.prompter_ai_jobs from authenticated, anon;

-- Revoking the table-level UPDATE also clears any column-level UPDATE grants.
revoke update on public.prompter_ai_jobs from authenticated, anon;

grant update (
  status,
  provider,
  model,
  tokens_input,
  tokens_output,
  fallback_provider,
  output_reference,
  error,
  error_category,
  completed_at
) on public.prompter_ai_jobs to authenticated;
insert into public._linoe_sandbox_applied (version, sha256) values ('20261019100000', '0da43286f1e8a60123bd0272ab1e668146bb5bd37a90059c725d33f369d8ba66');

-- >>> 20261019100100_prompter_p0_subscription_trial_insert_guard.sql  sha256=72389edca8260661b8b6905ff5adbc59929e450ee6ea943bd6975c47059de741
-- P0-2 / P0-2b remediation: a client-initiated INSERT into
-- public.prompter_subscriptions must always be the canonical fresh trial,
-- timed by the SERVER clock.
--
-- Finding (verified against the production catalog, read-only): the INSERT
-- policy "Buat subscription tenant sendiri" pins status/plan/billing_provider/
-- payment_provider_customer_reference but NOT current_period_start,
-- current_period_end or created_at, and `authenticated` holds INSERT on those
-- columns. handle_new_user() does not create the subscription row; the app
-- creates it lazily, so every new tenant is briefly without a row and could
-- insert its own with:
--   * current_period_end = NULL or far in the future  -> trial never expires
--     (the expiry check only fires when current_period_end is not null);
--   * current_period_start / created_at in the future -> the trial AI window
--     starts in the future, the job count is 0 forever -> unlimited AI.
--
-- Fix: a BEFORE INSERT trigger that, for direct client inserts only
-- (current_user is anon/authenticated), overwrites the time and billing
-- fields with server-side values. The app's own insert
-- (services/billing.ts#getOrCreateSubscription: status TRIALING, now,
-- now + 14 days) is unchanged in effect.
--
-- The function is SECURITY INVOKER on purpose: inside a SECURITY DEFINER
-- function (payment webhooks, scheduled jobs) and for service_role,
-- current_user is not anon/authenticated, so those paths are NOT modified.
-- UPDATE behaviour (column-level `plan` only) is not touched.
--
-- Second half of the same fix (verified against the production catalog,
-- read-only, 2026-10-19): `authenticated` and `anon` also hold table-level
-- DELETE and TRUNCATE on this table. Row-level DELETE is already blocked by
-- RLS (there is no DELETE policy), but TRUNCATE ignores RLS entirely, and a
-- deleted row would let a tenant INSERT a brand-new 14-day trial (and a fresh
-- AI quota window, which is derived from current_period_start). The app only
-- SELECTs, INSERTs the first trial row and UPDATEs `plan` (services/billing.ts);
-- it never deletes. So DELETE/TRUNCATE are revoked from both roles, and
-- `anon` (no tenant, never legitimate here) loses INSERT as well.
-- ON DELETE CASCADE from tenants still works (it runs as the table owner).
--
-- 14 days = TRIAL_DURATION_DAYS in services/billing.ts. Change both together.
-- Rollback: supabase/rollback/20261019100100_prompter_p0_subscription_trial_insert_guard.down.sql
--
-- LOCK SAFETY (release audit 2026-10-21/23): CREATE/DROP TRIGGER on prompter_subscriptions waits for any
-- transaction that has an open write on the table, and while it waits it queues every later writer behind
-- it. Fail fast instead: if the lock is not obtained within 3 seconds the statement fails with 55P03
-- (lock_not_available), the WHOLE migration rolls back (nothing is half-applied) and it can simply be re-run.
-- SET LOCAL is transaction-scoped: it is undone at COMMIT/ROLLBACK and never changes a session, role, database
-- or server default. It takes effect when the file is applied as one transaction (Supabase CLI, the SQL
-- editor and apply_migration all send the file that way); a client that splits the file into separate
-- autocommit statements (plain `psql -f`) gets a harmless no-op, so use `psql -1 -f` there.
set local lock_timeout = '3s';

create or replace function public.fn_enforce_trial_subscription_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.status := 'TRIALING';
    new.plan := 'FREE';
    new.created_at := now();
    new.updated_at := now();
    new.current_period_start := now();
    new.current_period_end := now() + interval '14 days';

    -- Billing / commercial fields are never client-controlled.
    new.billing_provider := null;
    new.payment_provider_customer_reference := null;
    new.provider_subscription_id := null;
    new.success_fee_rate_bps := null;
    new.cancel_at_period_end := false;
    new.billing_country := null;
    new.invoice_currency := null;
    new.tax_metadata := '{}'::jsonb;
  end if;

  return new;
end;
$$;

comment on function public.fn_enforce_trial_subscription_insert() is
  'P0-2/P0-2b: forces a client INSERT into prompter_subscriptions to the canonical server-timed 14-day trial. Applies only when current_user is anon or authenticated; service_role, webhooks and scheduled jobs are unaffected.';

drop trigger if exists trg_prompter_subscriptions_enforce_trial_insert on public.prompter_subscriptions;
create trigger trg_prompter_subscriptions_enforce_trial_insert
  before insert on public.prompter_subscriptions
  for each row execute function public.fn_enforce_trial_subscription_insert();

-- No client path may delete or truncate subscription rows (trial re-creation
-- and cross-tenant TRUNCATE). SELECT, the first-trial INSERT and the
-- column-level UPDATE (plan) for `authenticated` are unchanged.
revoke delete, truncate on public.prompter_subscriptions from authenticated, anon;
revoke insert on public.prompter_subscriptions from anon;
insert into public._linoe_sandbox_applied (version, sha256) values ('20261019100100', '72389edca8260661b8b6905ff5adbc59929e450ee6ea943bd6975c47059de741');

-- >>> 20261019100200_prompter_p0_plan_entitlements_lockdown.sql  sha256=e483750a4af17982e0d9ad2b2d874871d33e558e76cba9631bf30522647bdd12
-- S1 (trial + AI quota security), part 3 of 3: plan entitlement table must be read-only for app roles.
--
-- Evidence (production catalog, read-only, 2026-10-19/21): anon and authenticated hold
-- INSERT/UPDATE/DELETE/TRUNCATE on public.prompter_plan_entitlements. RLS has only a SELECT policy, so
-- INSERT/UPDATE/DELETE are already blocked by RLS, but TRUNCATE ignores RLS. After `truncate
-- prompter_plan_entitlements` the quota function (still the B10 body on production) finds no entitlement
-- row, `v_used >= null` is NULL and every job is granted: unlimited AI for EVERY tenant. Reaching TRUNCATE
-- needs a SQL-executing path (PostgREST has no TRUNCATE verb), but the privilege has no legitimate user.
--
-- Scope: privileges on this LINOE-owned table ONLY. REVOKE-only, idempotent, no data change.
--
-- DELIBERATELY NOT HERE: this migration does NOT (re)define fn_create_ai_job_if_entitled(). The final,
-- guarded definition of that function (role check, input validation, fail-closed ENTITLEMENT_NOT_CONFIGURED)
-- lives in the separate AI-jobs quota guard (PR #48). A second CREATE OR REPLACE here would silently
-- overwrite that guard whenever the two are applied in the "wrong" order. With TRUNCATE revoked, only the
-- table owner / service_role can empty the table, which closes the exploit path on its own; the in-function
-- fail-closed block is defence in depth that arrives with PR #48.
--
-- Rollback: supabase/rollback/20261019100000_prompter_s1_trial_ai_quota.down.sql (fail-closed; cannot restore
-- this privilege).

revoke insert, update, delete, truncate on public.prompter_plan_entitlements from anon, authenticated;
insert into public._linoe_sandbox_applied (version, sha256) values ('20261019100200', 'e483750a4af17982e0d9ad2b2d874871d33e558e76cba9631bf30522647bdd12');

-- >>> 20261021120000_prompter_ai_jobs_quota_guard.sql  sha256=4037f87f42e93c43472f5b321f9e257500d5d849c1036f257158b0594ae3f356
-- LINOE — AI Jobs quota guard (part 1 of 2). Additive; no table/column/policy/grant change.
--
-- WHY (audit 2026-10-20/21, reproduced on a local synthetic PostgreSQL, nothing on production):
--   1. fn_create_ai_job_if_entitled() is SECURITY DEFINER and has no role check, so ANY logged-in user of
--      a tenant (member, kasir, ...) can consume that tenant's AI quota, while the table policy only lets
--      owner/marketing create jobs directly.
--   2. job_type / input_reference are only validated by the table CHECK / not at all (2 MB accepted).
--   3. Quota = count(prompter_ai_jobs rows created in the period). Anything that can change created_at /
--      tenant_id, or remove rows, resets the quota. (PR #31 closes this with privileges; this migration
--      adds a second layer that survives a privilege rollback or a future GRANT mistake.)
--
-- WHAT:
--   A  fn_create_ai_job_if_entitled(text, jsonb): SAME signature / return shape / quota maths. New, additive
--      denial rows (no exception, so the app shows its generic "Akses AI tidak diizinkan" message):
--        ROLE_NOT_ALLOWED    caller's role (fn_current_role(), derived from auth.uid() -> user_profiles; never
--                            from client input) is not owner/marketing -- the same roles the table policy allows.
--        INVALID_JOB_TYPE    not one of the six job types the app routes (lib/ai/task-classes.ts).
--        INVALID_INPUT       input_reference is not a JSON object, or is larger than 64 KiB.
--      NO_TENANT is still checked first and the quota/period logic is byte-for-byte unchanged.
--   B  BEFORE UPDATE row trigger on prompter_ai_jobs: id, tenant_id, actor_user_id, job_type, input_reference
--      and created_at are immutable for the client roles anon/authenticated. Completion / failure / retry
--      bookkeeping (status, provider, model, tokens, output_reference, error*, completed_at, ...) is untouched.
--   C  BEFORE TRUNCATE statement trigger: blocked for anon/authenticated.
--   D  The body is a SUPERSET of both existing definitions (B10 on main and PR #31's fail-closed
--      ENTITLEMENT_NOT_CONFIGURED block), so the apply order relative to #31 cannot drop either. PR #31's
--      migration 20261019100200 re-creates this function WITHOUT the role check: it must be applied BEFORE this
--      migration (file order already guarantees it); part 2 verifies the guard is live before it installs.
--   Service role, table owner, FK cascades (tenant deletion, run as the owner) and SECURITY DEFINER functions
--   are NOT restricted by B/C.
--
-- NOT DONE ON PURPOSE: no new ledger, no cost cap, no change to allowances/periods/trial logic, no change to any
-- PUBLOE / UMKMpro AI / Apotek object. The DELETE guard is in part 2 (it needs PR #31's server-side release).
-- Rollback: supabase/rollback/20261021120000_prompter_ai_jobs_quota_guard.down.sql

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
  v_role text;
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_entitlement_plan text;
  v_period_start timestamptz;
  v_used integer;
  v_new_job_id uuid;
  v_input jsonb;
begin
  v_tenant_id := public.fn_current_tenant_id();
  v_actor_user_id := auth.uid();

  if v_tenant_id is null then
    return query select null::uuid, false, 'NO_TENANT'::text, 0, 0;
    return;
  end if;

  -- Same roles the "Owner/marketing buat & ubah ai job" policy allows. Identity comes from the JWT
  -- (auth.uid()), never from a parameter.
  v_role := public.fn_current_role();
  if v_role is null or v_role not in ('owner', 'marketing') then
    return query select null::uuid, false, 'ROLE_NOT_ALLOWED'::text, 0, 0;
    return;
  end if;

  if p_job_type is null or p_job_type not in (
    'MARKETING_BLUEPRINT', 'CAMPAIGN_PROPOSAL', 'CONTENT_GENERATION',
    'SEO_RECOMMENDATIONS', 'ANALYTICS_INSIGHT', 'OPTIMIZATION_RECOMMENDATION'
  ) then
    return query select null::uuid, false, 'INVALID_JOB_TYPE'::text, 0, 0;
    return;
  end if;

  v_input := coalesce(p_input_reference, '{}'::jsonb);
  if jsonb_typeof(v_input) <> 'object' or octet_length(v_input::text) > 65536 then
    return query select null::uuid, false, 'INVALID_INPUT'::text, 0, 0;
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

  if v_sub.status in ('PAST_DUE', 'CANCELED') then
    return query select null::uuid, false, 'SUBSCRIPTION_' || v_sub.status, 0, 0;
    return;
  end if;

  v_entitlement_plan := case when v_sub.status = 'TRIALING' then 'FREE' else coalesce(v_sub.plan, 'FREE') end;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_entitlement_plan;
  if not found then
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  -- FAIL CLOSED (same block as PR #31 20261019100200): no entitlement row / NULL allowance never means "unlimited".
  -- Repeated here so that applying this migration after (or without) #31 can never remove that fix.
  if v_entitlement.plan is null or v_entitlement.ai_usage_allowance is null then
    return query select null::uuid, false, 'ENTITLEMENT_NOT_CONFIGURED'::text, 0, 0;
    return;
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
  values (v_tenant_id, v_actor_user_id, p_job_type, 'PROCESSING', v_input)
  returning id into v_new_job_id;

  return query select v_new_job_id, true, null::text, v_used + 1, v_entitlement.ai_usage_allowance;
end;
$$;

comment on function public.fn_create_ai_job_if_entitled(text, jsonb) is
  'B9/B10 quota RPC + AI-jobs quota guard: owner/marketing only (ROLE_NOT_ALLOWED), known job types only (INVALID_JOB_TYPE), input_reference must be a JSON object <= 64 KiB (INVALID_INPUT). Quota maths unchanged.';

-- Privilege-neutral: CREATE OR REPLACE keeps the existing ACL of the RPC (anon no / authenticated yes on production).

-- ---- B + C : row/statement guards (SECURITY INVOKER on purpose: current_user is the real caller) --------
create or replace function public.fn_guard_ai_job_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.id             is distinct from old.id
    or new.tenant_id      is distinct from old.tenant_id
    or new.actor_user_id  is distinct from old.actor_user_id
    or new.job_type       is distinct from old.job_type
    or new.input_reference is distinct from old.input_reference
    or new.created_at     is distinct from old.created_at
  ) then
    raise exception 'prompter_ai_jobs: id, tenant_id, actor_user_id, job_type, input_reference and created_at are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.fn_guard_ai_job_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'prompter_ai_jobs: TRUNCATE is not allowed' using errcode = '42501';
  end if;
  return null;
end;
$$;

revoke all on function public.fn_guard_ai_job_immutable() from public, anon, authenticated;
revoke all on function public.fn_guard_ai_job_truncate() from public, anon, authenticated;

drop trigger if exists trg_prompter_ai_jobs_immutable on public.prompter_ai_jobs;
create trigger trg_prompter_ai_jobs_immutable
  before update on public.prompter_ai_jobs
  for each row execute function public.fn_guard_ai_job_immutable();

drop trigger if exists trg_prompter_ai_jobs_no_truncate on public.prompter_ai_jobs;
create trigger trg_prompter_ai_jobs_no_truncate
  before truncate on public.prompter_ai_jobs
  for each statement execute function public.fn_guard_ai_job_truncate();
insert into public._linoe_sandbox_applied (version, sha256) values ('20261021120000', '4037f87f42e93c43472f5b321f9e257500d5d849c1036f257158b0594ae3f356');

-- >>> 20261021120100_prompter_ai_jobs_delete_guard.sql  sha256=903bde666f87c981c7ab00a449a538ecdf000823bb3fa79c108593d5ed099d91
-- LINOE — AI Jobs quota guard (part 2 of 2): DELETE guard. Additive.
--
-- WHY: the quota is the number of prompter_ai_jobs rows in the period, so a client that can DELETE its own rows
-- resets its quota (reproduced locally on main: 30/30 used -> delete -> 30 more).
--
-- PREREQUISITE (fail-closed): PR #31 (20261019100000_prompter_p0_ai_jobs_lockdown) must already be applied and its
-- app code deployed. On main today services/ai-jobs.ts releases an unconfigured-AI job with a USER-client DELETE;
-- blocking that before #31's server-side release (admin client) is live would leave those rows counted against the
-- tenant. So this migration REFUSES to run while `authenticated` still holds DELETE on prompter_ai_jobs.
--
-- WHAT: BEFORE DELETE row trigger -> anon/authenticated can never delete a job row, whatever the grants say
-- (defence in depth against a privilege rollback / default-privilege regression). service_role (the release path),
-- the table owner and FK cascades (tenant deletion) are not restricted.
-- Rollback: supabase/rollback/20261021120100_prompter_ai_jobs_delete_guard.down.sql

do $prereq$
begin
  if has_table_privilege('authenticated', 'public.prompter_ai_jobs', 'DELETE') then
    raise exception 'prerequisite missing: apply PR #31 (ai_jobs lockdown) and deploy its server-side job release first; authenticated still has DELETE on prompter_ai_jobs';
  end if;
  if position('ROLE_NOT_ALLOWED' in pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure)) = 0 then
    raise exception 'prerequisite missing: part 1 (quota guard) is not live in fn_create_ai_job_if_entitled -- was it overwritten by an older migration? re-apply part 1';
  end if;
end
$prereq$;

create or replace function public.fn_guard_ai_job_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'prompter_ai_jobs: rows cannot be deleted by the client (releases go through the server)'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.fn_guard_ai_job_delete() from public, anon, authenticated;

drop trigger if exists trg_prompter_ai_jobs_no_delete on public.prompter_ai_jobs;
create trigger trg_prompter_ai_jobs_no_delete
  before delete on public.prompter_ai_jobs
  for each row execute function public.fn_guard_ai_job_delete();
insert into public._linoe_sandbox_applied (version, sha256) values ('20261021120100', '903bde666f87c981c7ab00a449a538ecdf000823bb3fa79c108593d5ed099d91');

-- >>> 20261027100000_linoe_finance_foundation.sql  sha256=6265938bb4c16757d3a4e7cac99eda69b537ea0d8a8709bc8c727ac754db1776
-- LINOE Finance & Tax foundation (Phase A) — ADDITIVE ONLY, NOT APPLIED to any environment.
--
-- Creates the platform-level finance tables used by lib/finance and
-- services/finance-admin.ts:
--   finance_platform_admins        who may see platform finance data (NOT the tenant owner role)
--   finance_ledger_entries         append-only ledger, one row per financial fact, UNIQUE idempotency_key
--   finance_refunds                refunds and their lifecycle
--   finance_settlements            gateway payouts
--   finance_operating_expenses     expenses; never deleted, only voided
--   finance_tax_settings           append-only tax configuration versions (no default rates)
--   finance_audit_logs             immutable audit trail
--
-- Safety properties (checked by tests/unit/migrations/finance-foundation.test.ts):
--   * touches NO existing table, function, policy, cron job or Edge Function;
--   * money is bigint minor units (scale 2), never float/numeric/double;
--   * RLS is enabled with NO policies and anon/authenticated lose every grant, so only the
--     service role (used server-side after the finance-admin gate) can read or write;
--   * service_role gets no DELETE and no TRUNCATE; ledger and audit rows are immutable via triggers.
--
-- Rollback: supabase/rollback/20261027100000_linoe_finance_foundation.down.sql (refuses if any table has rows).
set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------
create or replace function public.fn_finance_block_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'finance table % is append-only (% blocked)', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

create or replace function public.fn_finance_audit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor uuid;
  entity text;
  payload jsonb;
begin
  begin
    actor := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when others then
    actor := null;
  end;
  if tg_op = 'DELETE' then
    payload := to_jsonb(old);
  else
    payload := to_jsonb(new);
  end if;
  entity := coalesce(payload ->> 'id', payload ->> 'user_id');
  insert into public.finance_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (actor, tg_op, tg_table_name, entity, payload);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_audit_logs (created first: other tables' audit triggers write to it)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- finance_platform_admins
-- ---------------------------------------------------------------------------
create table if not exists public.finance_platform_admins (
  user_id uuid primary key references auth.users (id) on delete restrict,
  role text not null check (role in ('FINANCE_ADMIN', 'FINANCE_VIEWER')),
  is_active boolean not null default true,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  note text
);

-- ---------------------------------------------------------------------------
-- finance_ledger_entries
-- ---------------------------------------------------------------------------
create table if not exists public.finance_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 3 and 300),
  entry_type text not null check (entry_type in ('PAYMENT_VERIFIED', 'REFUND', 'GATEWAY_FEE', 'SETTLEMENT', 'EXPENSE')),
  direction text not null check (direction in ('IN', 'OUT')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_at timestamptz,
  provider text,
  provider_ref text,
  tenant_id uuid,
  source_event_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists finance_ledger_entries_type_effective_idx
  on public.finance_ledger_entries (entry_type, effective_at);

-- ---------------------------------------------------------------------------
-- finance_refunds
-- ---------------------------------------------------------------------------
create table if not exists public.finance_refunds (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_refund_id text not null,
  provider_payment_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('REQUESTED', 'APPROVED', 'PROCESSED', 'FAILED')),
  processed_at timestamptz,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_refund_id),
  check (status <> 'PROCESSED' or processed_at is not null)
);
create index if not exists finance_refunds_payment_idx on public.finance_refunds (provider, provider_payment_id);

-- ---------------------------------------------------------------------------
-- finance_settlements
-- ---------------------------------------------------------------------------
create table if not exists public.finance_settlements (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_settlement_id text not null,
  settled_at timestamptz not null,
  gross_minor bigint not null check (gross_minor >= 0),
  fee_minor bigint not null check (fee_minor >= 0),
  refund_deducted_minor bigint not null default 0 check (refund_deducted_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_settlement_id)
);

-- ---------------------------------------------------------------------------
-- finance_operating_expenses (never deleted; voiding is the only change allowed)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_operating_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null check (length(category) between 1 and 80),
  vendor text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  tax_minor bigint check (tax_minor is null or tax_minor >= 0),
  receipt_ref text,
  is_void boolean not null default false,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (is_void = (voided_at is not null))
);
create index if not exists finance_operating_expenses_date_idx on public.finance_operating_expenses (expense_date);

create or replace function public.fn_finance_expense_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'finance expenses are never deleted; void them instead' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.expense_date is distinct from old.expense_date
     or new.category is distinct from old.category
     or new.vendor is distinct from old.vendor
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.tax_minor is distinct from old.tax_minor
     or new.receipt_ref is distinct from old.receipt_ref
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'only voiding is allowed on a finance expense' using errcode = '42501';
  end if;
  if old.is_void and not new.is_void then
    raise exception 'a voided finance expense cannot be restored' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_tax_settings (append-only versions; no default rates anywhere)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_tax_settings (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  pkp_status text not null default 'UNVERIFIED' check (pkp_status in ('UNVERIFIED', 'PKP', 'NON_PKP')),
  ppn_rate_bps integer check (ppn_rate_bps is null or ppn_rate_bps between 1 and 10000),
  prices_include_ppn boolean,
  final_tax_rate_bps integer check (final_tax_rate_bps is null or final_tax_rate_bps between 1 and 10000),
  annual_threshold_minor bigint check (annual_threshold_minor is null or annual_threshold_minor > 0),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  verified_by text,
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  -- a configuration only counts as verified when someone is named and dated; any rate needs that
  check (
    (pkp_status = 'UNVERIFIED' and ppn_rate_bps is null and final_tax_rate_bps is null)
    or (verified_by is not null and verified_at is not null)
  )
);

-- ---------------------------------------------------------------------------
-- Immutability + audit triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_finance_audit_logs_immutable on public.finance_audit_logs;
create trigger trg_finance_audit_logs_immutable
  before update or delete on public.finance_audit_logs
  for each row execute function public.fn_finance_block_mutation();
drop trigger if exists trg_finance_audit_logs_no_truncate on public.finance_audit_logs;
create trigger trg_finance_audit_logs_no_truncate
  before truncate on public.finance_audit_logs
  for each statement execute function public.fn_finance_block_mutation();

drop trigger if exists trg_finance_ledger_immutable on public.finance_ledger_entries;
create trigger trg_finance_ledger_immutable
  before update or delete on public.finance_ledger_entries
  for each row execute function public.fn_finance_block_mutation();
drop trigger if exists trg_finance_ledger_no_truncate on public.finance_ledger_entries;
create trigger trg_finance_ledger_no_truncate
  before truncate on public.finance_ledger_entries
  for each statement execute function public.fn_finance_block_mutation();

drop trigger if exists trg_finance_tax_settings_immutable on public.finance_tax_settings;
create trigger trg_finance_tax_settings_immutable
  before update or delete on public.finance_tax_settings
  for each row execute function public.fn_finance_block_mutation();

drop trigger if exists trg_finance_expenses_guard on public.finance_operating_expenses;
create trigger trg_finance_expenses_guard
  before update or delete on public.finance_operating_expenses
  for each row execute function public.fn_finance_expense_guard();

drop trigger if exists trg_finance_ledger_audit on public.finance_ledger_entries;
create trigger trg_finance_ledger_audit
  after insert on public.finance_ledger_entries
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_refunds_audit on public.finance_refunds;
create trigger trg_finance_refunds_audit
  after insert or update on public.finance_refunds
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_settlements_audit on public.finance_settlements;
create trigger trg_finance_settlements_audit
  after insert on public.finance_settlements
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_expenses_audit on public.finance_operating_expenses;
create trigger trg_finance_expenses_audit
  after insert or update on public.finance_operating_expenses
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_tax_settings_audit on public.finance_tax_settings;
create trigger trg_finance_tax_settings_audit
  after insert on public.finance_tax_settings
  for each row execute function public.fn_finance_audit();
drop trigger if exists trg_finance_admins_audit on public.finance_platform_admins;
create trigger trg_finance_admins_audit
  after insert or update on public.finance_platform_admins
  for each row execute function public.fn_finance_audit();

-- ---------------------------------------------------------------------------
-- Row level security: enabled, NO policies => anon/authenticated see nothing.
-- Grants: everything revoked from public/anon/authenticated AND service_role, then service_role is granted only what it needs.
-- service_role must be revoked explicitly: in Supabase the DEFAULT PRIVILEGES of schema public hand every new table, sequence and
-- function to anon, authenticated and service_role, so a GRANT alone would leave service_role with DELETE/TRUNCATE/UPDATE.
-- (Trigger functions need no EXECUTE for the role that fires them; the grant is checked when the trigger is created.)
-- ---------------------------------------------------------------------------
alter table public.finance_audit_logs enable row level security;
alter table public.finance_platform_admins enable row level security;
alter table public.finance_ledger_entries enable row level security;
alter table public.finance_refunds enable row level security;
alter table public.finance_settlements enable row level security;
alter table public.finance_operating_expenses enable row level security;
alter table public.finance_tax_settings enable row level security;

revoke all on public.finance_audit_logs from public, anon, authenticated, service_role;
revoke all on public.finance_platform_admins from public, anon, authenticated, service_role;
revoke all on public.finance_ledger_entries from public, anon, authenticated, service_role;
revoke all on public.finance_refunds from public, anon, authenticated, service_role;
revoke all on public.finance_settlements from public, anon, authenticated, service_role;
revoke all on public.finance_operating_expenses from public, anon, authenticated, service_role;
revoke all on public.finance_tax_settings from public, anon, authenticated, service_role;
revoke all on sequence public.finance_audit_logs_id_seq from public, anon, authenticated, service_role;

grant select, insert on public.finance_audit_logs to service_role;
grant select, insert, update on public.finance_platform_admins to service_role;
grant select, insert on public.finance_ledger_entries to service_role;
grant select, insert, update on public.finance_refunds to service_role;
grant select, insert on public.finance_settlements to service_role;
grant select, insert, update on public.finance_operating_expenses to service_role;
grant select, insert on public.finance_tax_settings to service_role;
grant usage on sequence public.finance_audit_logs_id_seq to service_role;

revoke all on function public.fn_finance_block_mutation() from public, anon, authenticated, service_role;
revoke all on function public.fn_finance_audit() from public, anon, authenticated, service_role;
revoke all on function public.fn_finance_expense_guard() from public, anon, authenticated, service_role;
insert into public._linoe_sandbox_applied (version, sha256) values ('20261027100000', '6265938bb4c16757d3a4e7cac99eda69b537ea0d8a8709bc8c727ac754db1776');

-- >>> 20261027110000_linoe_admin_center_access.sql  sha256=871d14bc69f995bd0b3e61ff40c262c8fbe7bf9cc7b209df385cc809c8121e29
-- LINOE Admin Center access model (Phase B) — NOT APPLIED to any environment.
--
-- DEPENDS ON 20261027100000_linoe_finance_foundation.sql (PR #61): it extends
-- public.finance_platform_admins, which that migration creates. Apply in order.
--
-- Changes (only to the new finance_platform_admins table; no pre-existing object is touched):
--   * roles: adds SUPER_ADMIN (Founder) and STAFF (explicit permissions) next to the two PR #61 roles;
--   * permissions text[]: only known permission names, and 'staff.manage' can never be stored for STAFF;
--   * safety trigger: the last active SUPER_ADMIN can never be deactivated, revoked, demoted or deleted.
--
-- No Super Admin is created here and no email address is hard-coded anywhere. The first Super Admin is
-- seeded by a separate, explicitly approved statement. See docs/ADMIN_CENTER.md.
--
-- Rollback: supabase/rollback/20261027110000_linoe_admin_center_access.down.sql
set local lock_timeout = '3s';

alter table public.finance_platform_admins
  add column if not exists permissions text[] not null default '{}'::text[];

alter table public.finance_platform_admins
  drop constraint if exists finance_platform_admins_role_check;
alter table public.finance_platform_admins
  add constraint finance_platform_admins_role_check
  check (role in ('SUPER_ADMIN', 'STAFF', 'FINANCE_ADMIN', 'FINANCE_VIEWER'));

alter table public.finance_platform_admins
  drop constraint if exists finance_platform_admins_permissions_check;
alter table public.finance_platform_admins
  add constraint finance_platform_admins_permissions_check
  check (
    permissions <@ array[
      'admin.overview', 'finance.view', 'finance.export', 'finance.expense.write',
      'finance.settlement.import', 'tax.view', 'tax.manage', 'tax.export',
      'accounting.view', 'tax.optimization.view', 'bank.manage', 'staff.view'
    ]::text[]
  );

create or replace function public.fn_finance_admins_keep_super_admin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  remaining integer;
begin
  -- Only matters when a currently active SUPER_ADMIN row is being removed or weakened.
  if old.role = 'SUPER_ADMIN' and old.is_active and old.revoked_at is null then
    if tg_op = 'DELETE'
       or new.role <> 'SUPER_ADMIN'
       or not new.is_active
       or new.revoked_at is not null then
      select count(*) into remaining
      from public.finance_platform_admins
      where role = 'SUPER_ADMIN' and is_active and revoked_at is null and user_id <> old.user_id;
      if remaining < 1 then
        raise exception 'the last active SUPER_ADMIN cannot be removed or weakened' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_admins_keep_super_admin on public.finance_platform_admins;
create trigger trg_finance_admins_keep_super_admin
  before update or delete on public.finance_platform_admins
  for each row execute function public.fn_finance_admins_keep_super_admin();

revoke all on function public.fn_finance_admins_keep_super_admin() from public, anon, authenticated;
insert into public._linoe_sandbox_applied (version, sha256) values ('20261027110000', '871d14bc69f995bd0b3e61ff40c262c8fbe7bf9cc7b209df385cc809c8121e29');

commit;
