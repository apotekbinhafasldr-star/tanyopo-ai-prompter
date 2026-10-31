-- LINOE B4.2 — e-mail notification OUTBOX for payment alerts (B4.1). ADDITIVE ONLY.
--
-- What this adds (all names are prompter_* / fn_*; nothing of PUBLOE / UMKMpro is touched):
--   prompter_payment_alert_notifications          one row per (alert, sequence). sequence = 1 + alert.reopened_count, so a REOPEN
--                                                 is a new notification and a REPLAY (same sequence) is a no-op (UNIQUE).
--   prompter_payment_alert_notification_batches   one row per e-mail. The payload (subject + text) and the idempotency key are
--                                                 FROZEN in the database BEFORE anything is sent. Lease + retry/backoff + 23h hard stop.
--   prompter_payment_alert_notification_attempts  append-only audit trail of every attempt (SENT / FAILED / LEASE_EXPIRED / EXPIRED).
--   prompter_payment_alert_notify_state           single-row heartbeat for the UI / monitoring (no secrets).
--
-- Transaction boundary (the evaluation requested for B4.2):
--   The payment / webhook path is NOT modified: fn_record_payment_alarm, fn_sync_payment_alerts and every other B4.1 function are
--   untouched. Notifications are DERIVED, by the claim function, from the alert truth (OPEN alerts). Therefore an outbox failure,
--   a missing row or a broken sender can never fail, roll back or delay a webhook, and a notification that was never created is
--   re-derived on the next claim (self-healing). The outbox is "at least once, deduplicated by (alert_id, sequence) and by the
--   Resend idempotency key".
--
-- Functions (SECURITY DEFINER, `set search_path = public, pg_temp`, service_role only):
--   fn_claim_payment_notification_batch      atomic: advisory lock + FOR UPDATE SKIP LOCKED, lease, retry/backoff, daily budget
--   fn_complete_payment_notification_batch   idempotent
--   fn_fail_payment_notification_batch       backoff / DEAD, sanitised error code only
--   fn_payment_notification_recipient_emails resolves e-mail addresses ONLY for still-active, confirmed operators (by UUID)
--   fn_preview_payment_notifications         read-only counters (dry run, UI)
--
-- No cron / pg_net is created. Scheduling lives in the Netlify Scheduled Function (disabled by default: ALERT_EMAIL_ENABLED).
-- Rollback: supabase/rollback/20261101100000_prompter_b4_2_alert_notifications.down.sql (refuses while any batch / attempt exists).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_payment_alert_notifications (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.prompter_payment_alerts(id) on delete restrict,
  sequence integer not null check (sequence >= 1),
  kind text not null check (kind in ('REVIEW', 'REFUND', 'CHARGEBACK', 'REVERSAL')),
  severity text not null check (severity in ('HIGH', 'CRITICAL')),
  status text not null default 'PENDING' check (status in ('PENDING', 'BATCHED', 'SENT', 'SKIPPED', 'FAILED')),
  batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the dedupe rule, enforced by the database: one notification per alert and reopen-sequence
  constraint uq_prompter_payment_alert_notification unique (alert_id, sequence)
);
create index if not exists idx_prompter_payment_alert_notifications_pending
  on public.prompter_payment_alert_notifications (severity, created_at) where status = 'PENDING';
create index if not exists idx_prompter_payment_alert_notifications_batch
  on public.prompter_payment_alert_notifications (batch_id) where batch_id is not null;

create table if not exists public.prompter_payment_alert_notification_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'READY' check (status in ('READY', 'SENT', 'DEAD')),
  -- frozen payload: never changes after insert (see trigger below)
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 8000),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  item_count integer not null check (item_count between 1 and 50),
  top_severity text not null check (top_severity in ('HIGH', 'CRITICAL')),
  recipient_user_ids uuid[] not null check (cardinality(recipient_user_ids) between 1 and 10),
  -- idempotency key sent to the provider = id || '-' || key_generation (36 + 1 + digits, well inside 1..256)
  key_generation integer not null default 1 check (key_generation >= 1),
  attempts integer not null default 0 check (attempts >= 0),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  provider_message_id text check (provider_message_id is null or provider_message_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  last_error text check (last_error is null or last_error ~ '^[A-Z0-9_:.-]{1,60}$'),
  created_at timestamptz not null default now(),
  created_day date not null default ((now() at time zone 'utc')::date),
  sent_at timestamptz,
  constraint ck_prompter_payment_notification_batch_sent check ((status = 'SENT') = (sent_at is not null))
);
create index if not exists idx_prompter_payment_notification_batches_due
  on public.prompter_payment_alert_notification_batches (next_attempt_at) where status = 'READY';
create index if not exists idx_prompter_payment_notification_batches_day
  on public.prompter_payment_alert_notification_batches (created_day);

create table if not exists public.prompter_payment_alert_notification_attempts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.prompter_payment_alert_notification_batches(id) on delete restrict,
  attempt_no integer not null check (attempt_no >= 1),
  outcome text not null check (outcome in ('SENT', 'FAILED', 'LEASE_EXPIRED', 'EXPIRED')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_:.-]{1,60}$'),
  created_at timestamptz not null default now(),
  constraint uq_prompter_payment_notification_attempt unique (batch_id, attempt_no, outcome)
);

create table if not exists public.prompter_payment_alert_notify_state (
  id smallint primary key check (id = 1),
  last_run_at timestamptz,
  last_claim_result text check (last_claim_result is null or last_claim_result ~ '^[A-Z_]{1,40}$'),
  last_success_at timestamptz,
  last_error text check (last_error is null or last_error ~ '^[A-Z0-9_:.-]{1,60}$'),
  consecutive_failures integer not null default 0
);
insert into public.prompter_payment_alert_notify_state (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Guards: audit rows are append-only, nothing is deleted / truncated, the frozen payload cannot change
-- ---------------------------------------------------------------------------
create or replace function public.fn_prompter_payment_notification_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only / not deletable (% blocked)', tg_table_name, tg_op;
end $$;

create or replace function public.fn_prompter_payment_notification_batch_frozen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.subject is distinct from old.subject or new.body is distinct from old.body
     or new.payload_hash is distinct from old.payload_hash or new.item_count is distinct from old.item_count
     or new.recipient_user_ids is distinct from old.recipient_user_ids or new.id is distinct from old.id
     or new.top_severity is distinct from old.top_severity then
    raise exception 'notification batch payload is frozen and cannot be changed';
  end if;
  return new;
end $$;

drop trigger if exists trg_prompter_payment_notification_attempts_immutable on public.prompter_payment_alert_notification_attempts;
create trigger trg_prompter_payment_notification_attempts_immutable
  before update or delete on public.prompter_payment_alert_notification_attempts
  for each row execute function public.fn_prompter_payment_notification_immutable();
drop trigger if exists trg_prompter_payment_notification_attempts_no_truncate on public.prompter_payment_alert_notification_attempts;
create trigger trg_prompter_payment_notification_attempts_no_truncate
  before truncate on public.prompter_payment_alert_notification_attempts
  for each statement execute function public.fn_prompter_payment_notification_immutable();

drop trigger if exists trg_prompter_payment_notifications_no_delete on public.prompter_payment_alert_notifications;
create trigger trg_prompter_payment_notifications_no_delete
  before delete on public.prompter_payment_alert_notifications
  for each row execute function public.fn_prompter_payment_notification_immutable();
drop trigger if exists trg_prompter_payment_notifications_no_truncate on public.prompter_payment_alert_notifications;
create trigger trg_prompter_payment_notifications_no_truncate
  before truncate on public.prompter_payment_alert_notifications
  for each statement execute function public.fn_prompter_payment_notification_immutable();

drop trigger if exists trg_prompter_payment_notification_batches_no_delete on public.prompter_payment_alert_notification_batches;
create trigger trg_prompter_payment_notification_batches_no_delete
  before delete on public.prompter_payment_alert_notification_batches
  for each row execute function public.fn_prompter_payment_notification_immutable();
drop trigger if exists trg_prompter_payment_notification_batches_no_truncate on public.prompter_payment_alert_notification_batches;
create trigger trg_prompter_payment_notification_batches_no_truncate
  before truncate on public.prompter_payment_alert_notification_batches
  for each statement execute function public.fn_prompter_payment_notification_immutable();
drop trigger if exists trg_prompter_payment_notification_batches_frozen on public.prompter_payment_alert_notification_batches;
create trigger trg_prompter_payment_notification_batches_frozen
  before update on public.prompter_payment_alert_notification_batches
  for each row execute function public.fn_prompter_payment_notification_batch_frozen();

-- ---------------------------------------------------------------------------
-- 3. Privileges: service_role only. RLS enabled with NO policy = deny for everyone else, even if a grant leaks.
--    Writes happen only through the SECURITY DEFINER functions below, so service_role needs SELECT only.
-- ---------------------------------------------------------------------------
alter table public.prompter_payment_alert_notifications enable row level security;
alter table public.prompter_payment_alert_notification_batches enable row level security;
alter table public.prompter_payment_alert_notification_attempts enable row level security;
alter table public.prompter_payment_alert_notify_state enable row level security;

revoke all on table public.prompter_payment_alert_notifications from public, anon, authenticated, service_role;
revoke all on table public.prompter_payment_alert_notification_batches from public, anon, authenticated, service_role;
revoke all on table public.prompter_payment_alert_notification_attempts from public, anon, authenticated, service_role;
revoke all on table public.prompter_payment_alert_notify_state from public, anon, authenticated, service_role;

grant select on public.prompter_payment_alert_notifications to service_role;
grant select on public.prompter_payment_alert_notification_batches to service_role;
grant select on public.prompter_payment_alert_notification_attempts to service_role;
grant select on public.prompter_payment_alert_notify_state to service_role;

-- ---------------------------------------------------------------------------
-- 4. Functions
-- ---------------------------------------------------------------------------

-- Recipients: ACTIVE operators (by UUID) whose auth e-mail is confirmed and not banned / deleted. Returns UUIDs only.
create or replace function public.fn_payment_notification_recipient_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(o.user_id order by o.user_id), '{}'::uuid[])
    from public.prompter_payment_operators o
    join auth.users u on u.id = o.user_id
   where o.active
     and u.email is not null and btrim(u.email) <> ''
     and u.email_confirmed_at is not null
     and (u.banned_until is null or u.banned_until < now())
     and u.deleted_at is null;
$$;

-- E-mail addresses for a frozen recipient list, but ONLY for users that are still active & confirmed right now.
create or replace function public.fn_payment_notification_recipient_emails(p_user_ids uuid[])
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(lower(btrim(u.email)) order by u.id), '{}'::text[])
    from public.prompter_payment_operators o
    join auth.users u on u.id = o.user_id
   where o.active
     and o.user_id = any (coalesce(p_user_ids, '{}'::uuid[]))
     and cardinality(coalesce(p_user_ids, '{}'::uuid[])) <= 10
     and u.email is not null and btrim(u.email) <> ''
     and u.email_confirmed_at is not null
     and (u.banned_until is null or u.banned_until < now())
     and u.deleted_at is null;
$$;

create or replace function public.fn_claim_payment_notification_batch(
  p_daily_limit integer default 20,
  p_critical_reserve integer default 5,
  p_max_items integer default 20,
  p_lease interval default interval '5 minutes',
  p_link text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_max_attempts constant integer := 6;
  c_hard_stop constant interval := interval '23 hours';  -- Resend keeps an idempotency key for 24 hours; stop well before
  v_batch public.prompter_payment_alert_notification_batches;
  v_id uuid;
  v_today integer;
  v_items integer;
  v_crit integer;
  v_recipients uuid[];
  v_subject text;
  v_body text;
  v_lines text;
  v_result jsonb;
  v_dead record;
begin
  if p_daily_limit is null or p_daily_limit not between 1 and 100
     or p_critical_reserve is null or p_critical_reserve not between 0 and p_daily_limit
     or p_max_items is null or p_max_items not between 1 and 50
     or p_lease is null or p_lease < interval '30 seconds' or p_lease > interval '15 minutes' then
    raise exception 'invalid notification claim parameters';
  end if;
  if p_link is not null and (p_link !~ '^https://[^[:space:]<>"'']{1,190}$') then
    raise exception 'invalid notification link';
  end if;

  -- one claimer at a time (a second concurrent run simply does nothing); SKIP LOCKED below is the second line of defence
  if not pg_try_advisory_xact_lock(hashtextextended('linoe:b42:notification-claim', 0)) then
    return jsonb_build_object('result', 'BUSY');
  end if;

  -- heartbeat
  insert into public.prompter_payment_alert_notify_state (id, last_run_at) values (1, now())
  on conflict (id) do update set last_run_at = now();

  -- (a) derive missing notifications from the truth: every OPEN alert has one notification for its current sequence
  insert into public.prompter_payment_alert_notifications (alert_id, sequence, kind, severity)
  select a.id, 1 + a.reopened_count, a.kind, a.severity
    from public.prompter_payment_alerts a
   where a.state = 'OPEN'
  on conflict (alert_id, sequence) do nothing;

  -- (b) a pending notification is dropped when its alert was acknowledged / resolved already or has been superseded by a reopen
  update public.prompter_payment_alert_notifications n
     set status = 'SKIPPED', updated_at = now()
    from public.prompter_payment_alerts a
   where n.status = 'PENDING' and a.id = n.alert_id
     and (a.state <> 'OPEN' or n.sequence < 1 + a.reopened_count);

  -- (c) hard stop: a READY batch whose lease is over and that ran out of attempts / time is DEAD (never retried past the idempotency window)
  for v_dead in
    select b.id, b.attempts from public.prompter_payment_alert_notification_batches b
     where b.status = 'READY' and (b.lease_until is null or b.lease_until < now())
       and (b.attempts >= c_max_attempts or (b.first_attempt_at is not null and now() - b.first_attempt_at > c_hard_stop))
     for update skip locked
  loop
    insert into public.prompter_payment_alert_notification_attempts (batch_id, attempt_no, outcome, error_code)
    values (v_dead.id, greatest(v_dead.attempts, 1), 'EXPIRED', 'RETRY_WINDOW_OVER') on conflict do nothing;
    update public.prompter_payment_alert_notification_batches
       set status = 'DEAD', lease_until = null, last_error = 'RETRY_WINDOW_OVER' where id = v_dead.id;
    update public.prompter_payment_alert_notifications set status = 'FAILED', updated_at = now()
     where batch_id = v_dead.id and status = 'BATCHED';
  end loop;

  -- (d) an existing due batch first (retry of a failed / crashed attempt: SAME batch, SAME frozen payload, SAME idempotency key)
  select b.id into v_id
    from public.prompter_payment_alert_notification_batches b
   where b.status = 'READY' and b.next_attempt_at <= now() and (b.lease_until is null or b.lease_until < now())
   order by (b.top_severity = 'CRITICAL') desc, b.next_attempt_at, b.created_at
   limit 1
   for update skip locked;

  if v_id is not null then
    select * into v_batch from public.prompter_payment_alert_notification_batches where id = v_id;
    if v_batch.lease_until is not null then
      -- the previous claim never reported back (crash / timeout)
      insert into public.prompter_payment_alert_notification_attempts (batch_id, attempt_no, outcome, error_code)
      values (v_batch.id, v_batch.attempts, 'LEASE_EXPIRED', 'LEASE_EXPIRED') on conflict do nothing;
    end if;
    update public.prompter_payment_alert_notification_batches
       set attempts = attempts + 1, first_attempt_at = coalesce(first_attempt_at, now()), lease_until = now() + p_lease
     where id = v_id
    returning * into v_batch;
    update public.prompter_payment_alert_notify_state set last_claim_result = 'CLAIMED_RETRY' where id = 1;
    return jsonb_build_object('result', 'CLAIMED', 'retry', true, 'batch_id', v_batch.id,
      'idempotency_key', v_batch.id::text || '-' || v_batch.key_generation::text,
      'subject', v_batch.subject, 'text', v_batch.body, 'recipient_user_ids', to_jsonb(v_batch.recipient_user_ids),
      'attempt_no', v_batch.attempts, 'item_count', v_batch.item_count, 'top_severity', v_batch.top_severity);
  end if;

  -- (e) otherwise build ONE new batch from the pending notifications (CRITICAL first, merged), if the daily budget allows
  select count(*), count(*) filter (where severity = 'CRITICAL') into v_items, v_crit
    from public.prompter_payment_alert_notifications where status = 'PENDING';
  if v_items = 0 then
    update public.prompter_payment_alert_notify_state set last_claim_result = 'NOTHING' where id = 1;
    return jsonb_build_object('result', 'NOTHING');
  end if;

  select count(*) into v_today from public.prompter_payment_alert_notification_batches
   where created_day = ((now() at time zone 'utc')::date);
  if v_today >= p_daily_limit then
    update public.prompter_payment_alert_notify_state set last_claim_result = 'DAILY_LIMIT' where id = 1;
    return jsonb_build_object('result', 'DAILY_LIMIT');
  end if;
  if v_crit = 0 and v_today >= p_daily_limit - p_critical_reserve then
    -- the last slots of the day are reserved for CRITICAL alerts
    update public.prompter_payment_alert_notify_state set last_claim_result = 'RESERVE_HELD' where id = 1;
    return jsonb_build_object('result', 'RESERVE_HELD');
  end if;

  v_recipients := public.fn_payment_notification_recipient_ids();
  if cardinality(v_recipients) = 0 then
    update public.prompter_payment_alert_notify_state set last_claim_result = 'NO_RECIPIENT' where id = 1;
    return jsonb_build_object('result', 'NO_RECIPIENT');
  end if;
  if cardinality(v_recipients) > 10 then
    v_recipients := v_recipients[1:10];
  end if;

  -- pick the items (CRITICAL first, then oldest), freeze the text
  create temp table if not exists pg_temp.tmp_b42_pick (nid uuid, aid uuid, kind text, severity text, seq integer, rn integer) on commit drop;
  truncate pg_temp.tmp_b42_pick;
  insert into pg_temp.tmp_b42_pick
  select q.id, q.alert_id, q.kind, q.severity, q.sequence, row_number() over (order by (q.severity = 'CRITICAL') desc, q.created_at, q.id)::integer
    from (select n.* from public.prompter_payment_alert_notifications n where n.status = 'PENDING'
           order by (n.severity = 'CRITICAL') desc, n.created_at, n.id limit p_max_items for update skip locked) q;
  select count(*), count(*) filter (where severity = 'CRITICAL') into v_items, v_crit from pg_temp.tmp_b42_pick;
  if v_items = 0 then
    return jsonb_build_object('result', 'NOTHING');
  end if;

  select string_agg(format('- [%s] %s · id %s%s', case when t.severity = 'CRITICAL' then 'KRITIS' else 'TINGGI' end, t.kind,
                           left(t.aid::text, 8), case when t.seq > 1 then format(' · dibuka ulang ke-%s', t.seq - 1) else '' end),
                    E'\n' order by t.rn)
    into v_lines from pg_temp.tmp_b42_pick t;

  v_subject := case when v_crit > 0 then format('[LINOE] %s alarm pembayaran (%s KRITIS)', v_items, v_crit)
                    else format('[LINOE] %s alarm pembayaran', v_items) end;
  v_body := 'LINOE — alarm pembayaran memerlukan tindakan.' || E'\n\n'
         || format('Total: %s alarm (%s kritis).', v_items, v_crit) || E'\n\n'
         || v_lines || E'\n\n'
         || case when p_link is not null then 'Buka antrean: ' || p_link || E'\n\n' else '' end
         || 'Email otomatis. Tidak berisi data pelanggan, nominal, atau kredensial.';

  insert into public.prompter_payment_alert_notification_batches
    (subject, body, payload_hash, item_count, top_severity, recipient_user_ids, attempts, first_attempt_at, next_attempt_at, lease_until)
  values (v_subject, v_body, encode(sha256(convert_to(v_subject || E'\n' || v_body, 'UTF8')), 'hex'), v_items,
          case when v_crit > 0 then 'CRITICAL' else 'HIGH' end, v_recipients, 1, now(), now(), now() + p_lease)
  returning * into v_batch;

  update public.prompter_payment_alert_notifications n
     set status = 'BATCHED', batch_id = v_batch.id, updated_at = now()
    from pg_temp.tmp_b42_pick t where n.id = t.nid;

  update public.prompter_payment_alert_notify_state set last_claim_result = 'CLAIMED_NEW' where id = 1;
  v_result := jsonb_build_object('result', 'CLAIMED', 'retry', false, 'batch_id', v_batch.id,
      'idempotency_key', v_batch.id::text || '-' || v_batch.key_generation::text,
      'subject', v_batch.subject, 'text', v_batch.body, 'recipient_user_ids', to_jsonb(v_batch.recipient_user_ids),
      'attempt_no', v_batch.attempts, 'item_count', v_batch.item_count, 'top_severity', v_batch.top_severity);
  return v_result;
end $$;

create or replace function public.fn_complete_payment_notification_batch(p_batch_id uuid, p_provider_message_id text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.prompter_payment_alert_notification_batches;
begin
  select * into v_b from public.prompter_payment_alert_notification_batches where id = p_batch_id for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if v_b.status = 'SENT' then
    return 'ALREADY_SENT';
  end if;
  -- the provider accepted it: that is the truth, even if the batch was marked DEAD meanwhile
  update public.prompter_payment_alert_notification_batches
     set status = 'SENT', sent_at = now(), lease_until = null, last_error = null,
         provider_message_id = case when p_provider_message_id ~ '^[A-Za-z0-9_-]{1,100}$' then p_provider_message_id end
   where id = p_batch_id;
  update public.prompter_payment_alert_notifications set status = 'SENT', updated_at = now()
   where batch_id = p_batch_id and status in ('BATCHED', 'FAILED');
  insert into public.prompter_payment_alert_notification_attempts (batch_id, attempt_no, outcome, http_status)
  values (p_batch_id, greatest(v_b.attempts, 1), 'SENT', 200) on conflict do nothing;
  update public.prompter_payment_alert_notify_state
     set last_success_at = now(), last_error = null, consecutive_failures = 0 where id = 1;
  return 'SENT';
end $$;

create or replace function public.fn_fail_payment_notification_batch(
  p_batch_id uuid,
  p_attempt_no integer,
  p_error_code text,
  p_http_status integer default null,
  p_rotate_key boolean default false,
  p_permanent boolean default false
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_max_attempts constant integer := 6;
  c_hard_stop constant interval := interval '23 hours';
  v_b public.prompter_payment_alert_notification_batches;
  v_code text := case when p_error_code ~ '^[A-Z0-9_:.-]{1,60}$' then p_error_code else 'UNKNOWN' end;
  v_status integer := case when p_http_status between 100 and 599 then p_http_status end;
  v_backoff interval;
  v_next timestamptz;
begin
  select * into v_b from public.prompter_payment_alert_notification_batches where id = p_batch_id for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if v_b.status <> 'READY' then
    return 'NOT_READY';
  end if;
  if v_b.attempts <> p_attempt_no then
    return 'STALE';  -- a newer claim owns the batch; a late report from an old attempt must not touch it
  end if;

  insert into public.prompter_payment_alert_notification_attempts (batch_id, attempt_no, outcome, http_status, error_code)
  values (v_b.id, v_b.attempts, 'FAILED', v_status, v_code) on conflict do nothing;

  update public.prompter_payment_alert_notify_state
     set last_error = v_code, consecutive_failures = consecutive_failures + 1 where id = 1;

  v_backoff := case v_b.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '15 minutes'
                                 when 4 then interval '60 minutes' else interval '240 minutes' end;
  v_next := now() + v_backoff;

  if p_permanent or v_b.attempts >= c_max_attempts or v_next - coalesce(v_b.first_attempt_at, now()) > c_hard_stop then
    update public.prompter_payment_alert_notification_batches
       set status = 'DEAD', lease_until = null, last_error = v_code where id = v_b.id;
    update public.prompter_payment_alert_notifications set status = 'FAILED', updated_at = now()
     where batch_id = v_b.id and status = 'BATCHED';
    insert into public.prompter_payment_alert_notification_attempts (batch_id, attempt_no, outcome, error_code)
    values (v_b.id, v_b.attempts, 'EXPIRED', v_code) on conflict do nothing;
    return 'DEAD';
  end if;

  update public.prompter_payment_alert_notification_batches
     set lease_until = null, next_attempt_at = v_next, last_error = v_code,
         key_generation = key_generation + case when p_rotate_key then 1 else 0 end
   where id = v_b.id;
  return 'RETRY';
end $$;

create or replace function public.fn_preview_payment_notifications()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'open_alerts_without_notification', (select count(*) from public.prompter_payment_alerts a
        where a.state = 'OPEN' and not exists (select 1 from public.prompter_payment_alert_notifications n
                                                where n.alert_id = a.id and n.sequence = 1 + a.reopened_count)),
    'pending', (select count(*) from public.prompter_payment_alert_notifications where status = 'PENDING'),
    'pending_critical', (select count(*) from public.prompter_payment_alert_notifications where status = 'PENDING' and severity = 'CRITICAL'),
    'ready_batches', (select count(*) from public.prompter_payment_alert_notification_batches where status = 'READY'),
    'dead_batches', (select count(*) from public.prompter_payment_alert_notification_batches where status = 'DEAD'),
    'batches_today', (select count(*) from public.prompter_payment_alert_notification_batches where created_day = ((now() at time zone 'utc')::date)),
    'recipients', cardinality(public.fn_payment_notification_recipient_ids()),
    'last_run_at', (select last_run_at from public.prompter_payment_alert_notify_state where id = 1),
    'last_success_at', (select last_success_at from public.prompter_payment_alert_notify_state where id = 1)
  );
$$;

-- Functions are service_role only (the Supabase default grants EXECUTE to PUBLIC / anon / authenticated).
revoke all on function public.fn_payment_notification_recipient_ids() from public, anon, authenticated;
revoke all on function public.fn_payment_notification_recipient_emails(uuid[]) from public, anon, authenticated;
revoke all on function public.fn_claim_payment_notification_batch(integer, integer, integer, interval, text) from public, anon, authenticated;
revoke all on function public.fn_complete_payment_notification_batch(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_fail_payment_notification_batch(uuid, integer, text, integer, boolean, boolean) from public, anon, authenticated;
revoke all on function public.fn_preview_payment_notifications() from public, anon, authenticated;
grant execute on function public.fn_payment_notification_recipient_ids() to service_role;
grant execute on function public.fn_payment_notification_recipient_emails(uuid[]) to service_role;
grant execute on function public.fn_claim_payment_notification_batch(integer, integer, integer, interval, text) to service_role;
grant execute on function public.fn_complete_payment_notification_batch(uuid, text) to service_role;
grant execute on function public.fn_fail_payment_notification_batch(uuid, integer, text, integer, boolean, boolean) to service_role;
grant execute on function public.fn_preview_payment_notifications() to service_role;
