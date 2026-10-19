-- LINOE trial anti-abuse (Fast Track 2026-10-19). PREPARED FOR REVIEW ONLY; NOT APPLIED TO PRODUCTION.
--
-- Goal: make repeat-trial farming (new email -> new tenant -> new 14-day trial) detectable and
-- proportionally blockable, WITHOUT storing raw fingerprints, raw IPs or raw emails.
--
-- Privacy model: the application server computes keyed HMAC-SHA256 pseudonyms (secret never reaches
-- the database) and sends only 64-char hex digests. CHECK constraints reject anything else, so a raw
-- value cannot be stored by mistake. Rows expire after 90 days (expires_at) and are purged
-- opportunistically by the gate function itself (no cron is created).
--
-- Scope / safety (shared Supabase project):
--   * additive only: two new LINOE tables, new fn_trial_* functions, one function replaced
--     (fn_enforce_trial_subscription_insert, adds an inert-by-default hold check);
--   * no change to auth.users, tenants, user_profiles or any PUBLOE/Apotek/UMKMpro object;
--   * these tables are NOT tenant-scoped on purpose: signup attempts happen BEFORE a tenant exists
--     (same reasoning as prompter_demo_ai_usage). They are unreachable from tenants: RLS enabled with
--     zero policies, all privileges revoked from anon/authenticated, functions executable by
--     service_role only. The single tenant-facing function (fn_trial_hold_active) answers only for the
--     caller's own tenant;
--   * inert until used: with no rows in the ledger fn_trial_hold_active() is false, so applying this
--     migration changes no behaviour until the application mode is switched on.
--
-- Rollback: supabase/rollback/20261019110000_prompter_trial_abuse_protection.down.sql

-- ---------------------------------------------------------------------------------------------
-- Ledger of signup attempts (pseudonymous)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.prompter_trial_signup_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  key_version smallint not null check (key_version between 1 and 100),
  email_hmac text not null check (email_hmac ~ '^[0-9a-f]{64}$'),
  cookie_hmac text check (cookie_hmac is null or cookie_hmac ~ '^[0-9a-f]{64}$'),
  device_hmac text check (device_hmac is null or device_hmac ~ '^[0-9a-f]{64}$'),
  ip_hmac text check (ip_hmac is null or ip_hmac ~ '^[0-9a-f]{64}$'),
  purpose text not null default 'signup' check (purpose in ('signup', 'claim')),
  decision text not null check (decision in ('ALLOW', 'REVIEW', 'DENY')),
  shadow boolean not null default false,
  risk_score integer not null default 0 check (risk_score >= 0),
  reasons text[] not null default '{}',
  outcome text not null default 'PENDING' check (outcome in ('PENDING', 'SIGNED_UP', 'ABORTED')),
  user_id uuid,
  trial_hold boolean not null default false,
  hold_released_at timestamptz,
  hold_released_reason text
);

comment on table public.prompter_trial_signup_attempts is
  'LINOE trial anti-abuse ledger. Pseudonymous HMAC digests only (no raw email/IP/fingerprint). Not tenant-scoped: signup precedes tenant creation. service_role/SECURITY DEFINER access only. 90-day retention.';

create index if not exists idx_trial_attempts_cookie on public.prompter_trial_signup_attempts (cookie_hmac, created_at) where cookie_hmac is not null;
create index if not exists idx_trial_attempts_device on public.prompter_trial_signup_attempts (device_hmac, created_at) where device_hmac is not null;
create index if not exists idx_trial_attempts_ip on public.prompter_trial_signup_attempts (ip_hmac, created_at) where ip_hmac is not null;
create index if not exists idx_trial_attempts_email on public.prompter_trial_signup_attempts (email_hmac, created_at);
create index if not exists idx_trial_attempts_user on public.prompter_trial_signup_attempts (user_id) where user_id is not null;
create index if not exists idx_trial_attempts_expiry on public.prompter_trial_signup_attempts (expires_at);

-- ---------------------------------------------------------------------------------------------
-- Persistent, atomic fixed-window counters (replaces the per-instance in-memory limiter when on)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.prompter_trial_rate_buckets (
  scope text not null check (scope ~ '^[a-z_]{1,32}$'),
  key_hmac text not null check (key_hmac ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds > 0),
  hits integer not null default 0 check (hits >= 0),
  expires_at timestamptz not null,
  primary key (scope, key_hmac, window_start)
);

comment on table public.prompter_trial_rate_buckets is
  'LINOE trial anti-abuse: fixed-window hit counters keyed by HMAC pseudonyms. service_role/SECURITY DEFINER access only.';

create index if not exists idx_trial_buckets_expiry on public.prompter_trial_rate_buckets (expires_at);

alter table public.prompter_trial_signup_attempts enable row level security;
alter table public.prompter_trial_rate_buckets enable row level security;

-- Supabase grants ALL on new public tables to anon/authenticated through default privileges.
revoke all on public.prompter_trial_signup_attempts from public, anon, authenticated;
revoke all on public.prompter_trial_rate_buckets from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Atomic counter helper: returns the hit count INCLUDING this hit and the seconds left in the window
-- ---------------------------------------------------------------------------------------------
create or replace function public.fn_trial_bucket_hit(
  p_scope text,
  p_key_hmac text,
  p_window_seconds integer
)
returns table(hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.prompter_trial_rate_buckets as b (scope, key_hmac, window_start, window_seconds, hits, expires_at)
  values (p_scope, p_key_hmac, v_start, p_window_seconds, 1, v_start + make_interval(secs => p_window_seconds * 2))
  on conflict (scope, key_hmac, window_start)
  do update set hits = b.hits + 1
  returning b.hits into v_hits;

  return query select v_hits,
    greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::integer);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The gate: rate limit + repeat-trial risk scoring + proportional decision. One atomic call.
--   ALLOW  : proceed normally.
--   REVIEW : signup proceeds, but the account's trial is created already expired (hold) until support
--            releases it (false-positive recovery). Never set in shadow mode.
--   DENY   : signup refused (strong repeat evidence, or rate limit exceeded).
-- IP and device-signal matches alone can NEVER reach DENY: they are weak, shared signals (NAT, family
-- phones, offices). Only repeated use of the same random first-party device cookie by different emails
-- reaches DENY.
-- ---------------------------------------------------------------------------------------------
create or replace function public.fn_trial_gate_core(
  p_purpose text,
  p_mode text,
  p_key_version integer,
  p_email_hmac text,
  p_cookie_hmac text,
  p_device_hmac text,
  p_ip_hmac text
)
returns table(decision text, attempt_id uuid, risk_score integer, reasons text[], retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys text[];
  v_k text;
  v_shadow boolean;
  v_reasons text[] := '{}';
  v_score integer := 0;
  v_decision text;
  v_n_cookie integer := 0;
  v_n_device integer := 0;
  v_n_ip integer := 0;
  v_hits integer;
  v_retry integer;
  v_worst_retry integer := 0;
  v_limited boolean := false;
  v_id uuid;
  v_prefix text := case when p_purpose = 'claim' then 'claim_' else '' end;
  v_live interval := interval '30 days';
  v_pending_ttl interval := interval '15 minutes';
begin
  if p_purpose not in ('signup', 'claim') then
    raise exception 'invalid purpose %', p_purpose using errcode = '22023';
  end if;
  if p_mode not in ('shadow', 'enforce') then
    raise exception 'invalid mode %', p_mode using errcode = '22023';
  end if;
  if p_email_hmac is null or p_email_hmac !~ '^[0-9a-f]{64}$'
     or (p_cookie_hmac is not null and p_cookie_hmac !~ '^[0-9a-f]{64}$')
     or (p_device_hmac is not null and p_device_hmac !~ '^[0-9a-f]{64}$')
     or (p_ip_hmac is not null and p_ip_hmac !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid pseudonym format' using errcode = '22023';
  end if;
  v_shadow := (p_mode = 'shadow');

  -- Serialize concurrent attempts that share any identifier (sorted => no deadlocks).
  select array_agg(k order by k) into v_keys
  from (select distinct unnest(array[p_email_hmac, p_cookie_hmac, p_device_hmac]) as k) s
  where k is not null;
  foreach v_k in array v_keys loop
    perform pg_advisory_xact_lock(hashtextextended('prompter_trial_gate:' || v_k, 0));
  end loop;

  -- Bounded opportunistic retention purge (no cron needed).
  delete from public.prompter_trial_signup_attempts
   where id in (select id from public.prompter_trial_signup_attempts where expires_at < now() order by expires_at limit 50);
  delete from public.prompter_trial_rate_buckets
   where (scope, key_hmac, window_start) in
         (select scope, key_hmac, window_start from public.prompter_trial_rate_buckets where expires_at < now() limit 50);

  -- Persistent atomic rate limits. Every attempt counts, including denied ones.
  select h.hits, h.retry_after_seconds into v_hits, v_retry from public.fn_trial_bucket_hit(v_prefix || 'ip_hour', p_ip_hmac, 3600) h where p_ip_hmac is not null;
  if v_hits > 5 then v_limited := true; v_reasons := array_append(v_reasons, 'RATE_IP_HOUR'::text); v_worst_retry := greatest(v_worst_retry, v_retry); end if;
  v_hits := null;
  select h.hits, h.retry_after_seconds into v_hits, v_retry from public.fn_trial_bucket_hit(v_prefix || 'ip_day', p_ip_hmac, 86400) h where p_ip_hmac is not null;
  if v_hits > 20 then v_limited := true; v_reasons := array_append(v_reasons, 'RATE_IP_DAY'::text); v_worst_retry := greatest(v_worst_retry, v_retry); end if;
  v_hits := null;
  select h.hits, h.retry_after_seconds into v_hits, v_retry from public.fn_trial_bucket_hit(v_prefix || 'email_hour', p_email_hmac, 3600) h;
  if v_hits > 5 then v_limited := true; v_reasons := array_append(v_reasons, 'RATE_EMAIL_HOUR'::text); v_worst_retry := greatest(v_worst_retry, v_retry); end if;
  v_hits := null;
  select h.hits, h.retry_after_seconds into v_hits, v_retry from public.fn_trial_bucket_hit(v_prefix || 'cookie_day', p_cookie_hmac, 86400) h where p_cookie_hmac is not null;
  if v_hits > 6 then v_limited := true; v_reasons := array_append(v_reasons, 'RATE_COOKIE_DAY'::text); v_worst_retry := greatest(v_worst_retry, v_retry); end if;
  v_hits := null;
  select h.hits, h.retry_after_seconds into v_hits, v_retry from public.fn_trial_bucket_hit(v_prefix || 'device_day', p_device_hmac, 86400) h where p_device_hmac is not null;
  if v_hits > 10 then v_limited := true; v_reasons := array_append(v_reasons, 'RATE_DEVICE_DAY'::text); v_worst_retry := greatest(v_worst_retry, v_retry); end if;

  if v_limited then
    -- Rate-limited attempts are not written to the ledger (no write amplification for a flood).
    -- In shadow mode the application ignores the decision, so legitimate users are never blocked.
    return query select 'DENY'::text, null::uuid, 100, v_reasons, v_worst_retry;
    return;
  end if;

  -- Distinct OTHER emails seen on the same pseudonym within 30 days (aborted/stale-pending excluded).
  if p_cookie_hmac is not null then
    select count(distinct a.email_hmac) into v_n_cookie from public.prompter_trial_signup_attempts a
     where a.cookie_hmac = p_cookie_hmac and a.email_hmac <> p_email_hmac and a.decision <> 'DENY'
       and a.created_at > now() - v_live
       and (a.outcome = 'SIGNED_UP' or (a.outcome = 'PENDING' and a.created_at > now() - v_pending_ttl));
  end if;
  if p_device_hmac is not null then
    select count(distinct a.email_hmac) into v_n_device from public.prompter_trial_signup_attempts a
     where a.device_hmac = p_device_hmac and a.email_hmac <> p_email_hmac and a.decision <> 'DENY'
       and a.created_at > now() - v_live
       and (a.outcome = 'SIGNED_UP' or (a.outcome = 'PENDING' and a.created_at > now() - v_pending_ttl));
  end if;
  if p_ip_hmac is not null then
    select count(distinct a.email_hmac) into v_n_ip from public.prompter_trial_signup_attempts a
     where a.ip_hmac = p_ip_hmac and a.email_hmac <> p_email_hmac and a.decision <> 'DENY'
       and a.created_at > now() - v_live
       and (a.outcome = 'SIGNED_UP' or (a.outcome = 'PENDING' and a.created_at > now() - v_pending_ttl));
  end if;

  if v_n_cookie >= 1 then v_score := v_score + 50; v_reasons := array_append(v_reasons, 'COOKIE_REPEAT_1'::text); end if;
  if v_n_cookie >= 2 then v_score := v_score + 50; v_reasons := array_append(v_reasons, 'COOKIE_REPEAT_2'::text); end if;
  if v_n_device >= 1 then v_score := v_score + 20; v_reasons := array_append(v_reasons, 'DEVICE_REPEAT_1'::text); end if;
  if v_n_device >= 2 then v_score := v_score + 20; v_reasons := array_append(v_reasons, 'DEVICE_REPEAT_2'::text); end if;
  if v_n_ip >= 3 then v_score := v_score + 10; v_reasons := array_append(v_reasons, 'IP_SHARED_3'::text); end if;
  if v_n_ip >= 8 then v_score := v_score + 10; v_reasons := array_append(v_reasons, 'IP_SHARED_8'::text); end if;

  v_decision := case when v_score >= 100 then 'DENY' when v_score >= 50 then 'REVIEW' else 'ALLOW' end;

  insert into public.prompter_trial_signup_attempts
    (key_version, email_hmac, cookie_hmac, device_hmac, ip_hmac, purpose, decision, shadow, risk_score, reasons, outcome, trial_hold)
  values
    (p_key_version, p_email_hmac, p_cookie_hmac, p_device_hmac, p_ip_hmac, p_purpose, v_decision, v_shadow, v_score, v_reasons,
     case when v_decision = 'DENY' then 'ABORTED' else 'PENDING' end,
     (v_decision = 'REVIEW' and not v_shadow))
  returning id into v_id;

  return query select v_decision, v_id, v_score, v_reasons, 0;
end;
$$;

create or replace function public.fn_trial_signup_gate(
  p_mode text,
  p_key_version integer,
  p_email_hmac text,
  p_cookie_hmac text,
  p_device_hmac text,
  p_ip_hmac text
)
returns table(decision text, attempt_id uuid, risk_score integer, reasons text[], retry_after_seconds integer)
language sql
security definer
set search_path = public
as $$
  select * from public.fn_trial_gate_core('signup', p_mode, p_key_version, p_email_hmac, p_cookie_hmac, p_device_hmac, p_ip_hmac);
$$;

-- ---------------------------------------------------------------------------------------------
-- LINOE-only trial CLAIM (closes the direct-signup bypass without any Auth hook or Auth config change).
--
-- Anyone holding the public Supabase key can call the Auth signup endpoint directly and skip the app's
-- registerAction gate; handle_new_user then creates a tenant. But a LINOE trial only exists once a row is
-- written to prompter_subscriptions, and that is LINOE-owned. So the trial is "claimed" server-side:
-- the app calls fn_trial_claim (service_role) which runs the SAME gate (purpose 'claim', own rate buckets)
-- for the authenticated user and creates the subscription itself. Once `claim_required` is switched on,
-- any client-side INSERT only yields an already-expired placeholder (see the trigger below), so a direct
-- signup cannot self-start a trial. UMKMpro/PUBLOE/Apotek signups and logins are untouched: nothing here runs
-- unless the user opens LINOE and has no subscription yet.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.prompter_trial_config (
  id boolean primary key default true check (id),
  claim_required boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.prompter_trial_config (id, claim_required) values (true, false) on conflict (id) do nothing;
comment on table public.prompter_trial_config is
  'LINOE trial anti-abuse switch (single row). claim_required=false (default) leaves behaviour unchanged. service_role/SECURITY DEFINER access only.';
alter table public.prompter_trial_config enable row level security;
revoke all on public.prompter_trial_config from public, anon, authenticated;

create or replace function public.fn_trial_claim_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select claim_required from public.prompter_trial_config where id), false);
$$;

create or replace function public.fn_trial_set_claim_required(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.prompter_trial_config set claim_required = coalesce(p_on, false), updated_at = now() where id;
  return coalesce(p_on, false);
end;
$$;

create or replace function public.fn_trial_claim(
  p_mode text,
  p_key_version integer,
  p_user_id uuid,
  p_email_hmac text,
  p_cookie_hmac text,
  p_device_hmac text,
  p_ip_hmac text
)
returns table(outcome text, decision text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_sub public.prompter_subscriptions%rowtype;
  v_found boolean;
  v_claimed boolean;
  v_hold boolean;
  v_g record;
  v_expire boolean;
  v_decision text;
begin
  if p_mode <> 'enforce' then
    raise exception 'trial claim runs in enforce mode only' using errcode = '22023';
  end if;
  if p_user_id is null then
    return query select 'NO_USER'::text, null::text, 0;
    return;
  end if;
  select up.tenant_id into v_tenant from public.user_profiles up where up.id = p_user_id;
  if v_tenant is null then
    return query select 'NO_TENANT'::text, null::text, 0;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('prompter_trial_claim:' || v_tenant::text, 0));

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant for update;
  v_found := found;
  v_claimed := exists (select 1 from public.prompter_trial_signup_attempts a where a.user_id = p_user_id and a.purpose = 'claim');

  -- An existing row is final unless it is the expired placeholder a client-side insert produced while
  -- claim_required was on (period end before creation) and this user has not been through a claim yet.
  if v_found and not (
       v_sub.status = 'TRIALING' and v_sub.billing_provider is null
       and v_sub.current_period_end is not null and v_sub.current_period_end < v_sub.created_at
       and not v_claimed) then
    return query select 'EXISTS'::text, null::text, 0;
    return;
  end if;

  v_hold := exists (
    select 1 from public.prompter_trial_signup_attempts a
     where a.user_id = p_user_id and a.trial_hold and a.hold_released_at is null and a.outcome = 'SIGNED_UP');

  if v_hold then
    v_expire := true;
    v_decision := 'REVIEW';
  else
    select * into v_g from public.fn_trial_gate_core('claim', p_mode, p_key_version, p_email_hmac, p_cookie_hmac, p_device_hmac, p_ip_hmac);
    if v_g.attempt_id is null then
      return query select 'RATE_LIMITED'::text, v_g.decision, v_g.retry_after_seconds;
      return;
    end if;
    v_decision := v_g.decision;
    v_expire := v_g.decision <> 'ALLOW';
    update public.prompter_trial_signup_attempts as a
       set outcome = 'SIGNED_UP', user_id = p_user_id, trial_hold = v_expire
     where a.id = v_g.attempt_id and a.outcome in ('PENDING', 'ABORTED');
  end if;

  if v_found then
    update public.prompter_subscriptions
       set created_at = now(), updated_at = now(), current_period_start = now(),
           current_period_end = case when v_expire then now() - interval '1 minute' else now() + interval '14 days' end
     where tenant_id = v_tenant;
  else
    insert into public.prompter_subscriptions (tenant_id, status, plan, created_at, updated_at, current_period_start, current_period_end)
    values (v_tenant, 'TRIALING', 'FREE', now(), now(), now(),
            case when v_expire then now() - interval '1 minute' else now() + interval '14 days' end);
  end if;

  return query select case when v_expire then 'HELD' else 'CREATED' end, v_decision, 0;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Finalize: link the attempt to the created auth user, or mark it aborted (typo retry, existing
-- account, signup error) so it never counts as a trial start. Only PENDING rows transition.
-- ---------------------------------------------------------------------------------------------
create or replace function public.fn_trial_signup_finalize(
  p_attempt_id uuid,
  p_user_id uuid,
  p_signed_up boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_attempt_id is null then
    return false;
  end if;
  update public.prompter_trial_signup_attempts
     set outcome = case when p_signed_up and p_user_id is not null then 'SIGNED_UP' else 'ABORTED' end,
         user_id = case when p_signed_up then p_user_id else null end
   where id = p_attempt_id and outcome = 'PENDING';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tenant-facing check used by the subscription insert trigger. Answers ONLY for the caller's own
-- tenant, so it cannot be used to probe other tenants. False when the ledger has no matching row.
-- ---------------------------------------------------------------------------------------------
create or replace function public.fn_trial_hold_active(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_tenant_id is not null
     and p_tenant_id is not distinct from public.fn_current_tenant_id()
     and exists (
       select 1
         from public.prompter_trial_signup_attempts a
         join public.user_profiles up on up.id = a.user_id
        where up.tenant_id = p_tenant_id
          and a.outcome = 'SIGNED_UP'
          and a.trial_hold
          and a.hold_released_at is null
     );
$$;

-- Replaces the P0-2 trigger function: identical behaviour plus the hold. A held tenant's client-created
-- trial starts already expired (period end in the past), which the existing quota gate
-- (fn_create_ai_job_if_entitled -> TRIAL_EXPIRED) already enforces. service_role/webhook inserts are
-- untouched (current_user check unchanged).
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

    -- Held tenants, and (once the claim gate is switched on) EVERY client-side insert, get an already-expired
    -- placeholder. The real trial is created server-side by fn_trial_claim after the gate has run.
    if public.fn_trial_claim_required() or public.fn_trial_hold_active(new.tenant_id) then
      new.current_period_end := now() - interval '1 minute';
    end if;

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

-- ---------------------------------------------------------------------------------------------
-- False-positive recovery (support/operator, service_role only). Releases the hold and, if the
-- held trial row already exists, grants the normal 14-day trial from now. Identifies a held row by
-- its signature: period end earlier than created_at (a normal trial always ends after it).
-- ---------------------------------------------------------------------------------------------
create or replace function public.fn_trial_release_hold(p_attempt_id uuid, p_reason text)
returns table(released boolean, subscriptions_restored integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_tenant uuid;
  v_n integer := 0;
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'a reason of at least 5 characters is required' using errcode = '22023';
  end if;

  update public.prompter_trial_signup_attempts
     set hold_released_at = now(), hold_released_reason = left(btrim(p_reason), 200)
   where id = p_attempt_id and trial_hold and hold_released_at is null
  returning user_id into v_user;

  if not found then
    return query select false, 0;
    return;
  end if;

  select up.tenant_id into v_tenant from public.user_profiles up where up.id = v_user;
  if v_tenant is not null then
    update public.prompter_subscriptions s
       set current_period_start = now(), current_period_end = now() + interval '14 days', updated_at = now()
     where s.tenant_id = v_tenant and s.status = 'TRIALING' and s.billing_provider is null
       and s.current_period_end < s.created_at;
    get diagnostics v_n = row_count;
  end if;

  return query select true, v_n;
end;
$$;

-- Bounded manual purge (also usable from a future approved cron).
create or replace function public.fn_trial_abuse_purge(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a integer;
  v_b integer;
begin
  delete from public.prompter_trial_signup_attempts
   where id in (select id from public.prompter_trial_signup_attempts where expires_at < now() order by expires_at limit least(greatest(p_limit, 1), 10000));
  get diagnostics v_a = row_count;
  delete from public.prompter_trial_rate_buckets
   where (scope, key_hmac, window_start) in
         (select scope, key_hmac, window_start from public.prompter_trial_rate_buckets where expires_at < now() limit least(greatest(p_limit, 1), 10000));
  get diagnostics v_b = row_count;
  return v_a + v_b;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: Supabase grants EXECUTE on new public functions to anon/authenticated by default.
-- ---------------------------------------------------------------------------------------------
revoke all on function public.fn_trial_bucket_hit(text, text, integer) from public, anon, authenticated;
revoke all on function public.fn_trial_gate_core(text, text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_trial_claim(text, integer, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_trial_set_claim_required(boolean) from public, anon, authenticated;
revoke all on function public.fn_trial_claim_required() from public, anon;
revoke all on function public.fn_trial_signup_gate(text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_trial_signup_finalize(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.fn_trial_release_hold(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_trial_abuse_purge(integer) from public, anon, authenticated;
revoke all on function public.fn_trial_hold_active(uuid) from public, anon;

grant execute on function public.fn_trial_bucket_hit(text, text, integer) to service_role;
grant execute on function public.fn_trial_claim(text, integer, uuid, text, text, text, text) to service_role;
grant execute on function public.fn_trial_set_claim_required(boolean) to service_role;
-- The subscription trigger runs as the calling role and needs the (data-free) switch.
grant execute on function public.fn_trial_claim_required() to authenticated, service_role;
grant execute on function public.fn_trial_signup_gate(text, integer, text, text, text, text) to service_role;
grant execute on function public.fn_trial_signup_finalize(uuid, uuid, boolean) to service_role;
grant execute on function public.fn_trial_release_hold(uuid, text) to service_role;
grant execute on function public.fn_trial_abuse_purge(integer) to service_role;
-- The trigger runs as the calling role, so authenticated needs EXECUTE on the own-tenant-only check.
grant execute on function public.fn_trial_hold_active(uuid) to authenticated, service_role;
