-- LINOE Tax Optimization founder approvals (Phase E.1) — NOT APPLIED to any environment.
--
-- DEPENDS ON (apply in order):
--   20261027100000_linoe_finance_foundation.sql   (finance_platform_admins, finance_audit_logs, fn_finance_block_mutation, fn_finance_audit)
--   20261027110000_linoe_admin_center_access.sql  (SUPER_ADMIN role)
--
-- Adds:
--   * public.tax_opt_decisions: append-only event log of Founder decisions (APPROVED / REJECTED / REVOKED), hash-chained per subject.
--     No UPDATE, DELETE or TRUNCATE ever; a correction or revocation is a NEW event.
--   * public.tax_opt_record_decision(): the ONLY write path (SECURITY DEFINER, service_role only). Serialises per subject
--     (advisory lock), rejects double submission (request id), concurrent writers (expected sequence), stale review (the hashes the
--     Founder saw differ from the current ones) and non-Founder actors.
--   * public.tax_opt_effective_status(): an approval is effective only while the current calculation hash AND rules version equal
--     the ones approved. Any change makes it STALE until a new decision.
--   * public.tax_opt_verify_chain(): recomputes the hash chain (tamper evidence).
--   * guard on public.finance_platform_admins: no self-promotion and no escalation unless granted by another active SUPER_ADMIN.
--
-- A decision is an INTERNAL recommendation record. It never marks any tax figure verified, never replaces accountant verification and
-- never reports or pays anything. No Super Admin is created here and no email address appears anywhere.
-- Stores hashes, states and short references only: no amounts, no document content, no URLs.
--
-- Rollback: supabase/rollback/20261027130000_linoe_tax_optimization_approvals.down.sql (refuses if any decision exists).
set local lock_timeout = '3s';

create table if not exists public.tax_opt_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  subject_key text not null check (subject_key ~ '^[A-Z_]{3,40}:[0-9]{4}(-[0-9]{2})?:[A-Z0-9_,]{1,80}$'),
  seq integer not null check (seq >= 1),
  prev_event_id uuid references public.tax_opt_decisions (id),
  prev_hash text check (prev_hash is null or prev_hash ~ '^[0-9a-f]{64}$'),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  recommendation_type text not null check (recommendation_type in ('SCHEME_SELECTION', 'COST_TREATMENT', 'CREDIT_CLAIM', 'NOTICE_RESPONSE')),
  tax_year text not null check (tax_year ~ '^[0-9]{4}$'),
  decision text not null check (decision in ('APPROVED', 'REJECTED', 'REVOKED')),
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  decision_by uuid not null references auth.users (id) on delete restrict,
  decided_at timestamptz not null default clock_timestamp(),
  rules_version text not null check (rules_version ~ '^[A-Za-z0-9._;=:-]{3,120}$'),
  calc_hash text not null check (calc_hash ~ '^[0-9a-f]{64}$'),
  figure_states text[] not null default '{}'::text[]
    check (figure_states <@ array['TERVERIFIKASI', 'SIMULASI', 'PERLU_VERIFIKASI_AKUNTAN', 'BELUM_DAPAT_DIHITUNG']::text[]),
  open_items integer not null default 0 check (open_items >= 0),
  evidence_refs text[] not null default '{}'::text[],
  accountant_verification_ref text check (accountant_verification_ref is null or char_length(accountant_verification_ref) between 3 and 200),
  scope text not null default 'INTERNAL_RECOMMENDATION_ONLY' check (scope = 'INTERNAL_RECOMMENDATION_ONLY'),
  unique (subject_key, seq),
  check (decision <> 'APPROVED' or (cardinality(figure_states) > 0 and figure_states <@ array['TERVERIFIKASI']::text[] and open_items = 0)),
  check (cardinality(evidence_refs) <= 50),
  check (subject_key like recommendation_type || ':' || tax_year || ':%'),
  check (seq = 1 or prev_event_id is not null)
);
create index if not exists tax_opt_decisions_subject_seq_idx on public.tax_opt_decisions (subject_key, seq desc);

-- Evidence references are short ids only: never a link (no public URL to a tax document), no whitespace, no path.
create or replace function public.fn_tax_opt_refs_ok(refs text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(bool_and(r ~ '^[A-Za-z0-9._:/#-]{3,120}$' and r !~* '^[a-z][a-z0-9+.-]*://' and r !~ '^/' and r !~ '\.\.'), true)
  from unnest(refs) as r
$$;
alter table public.tax_opt_decisions drop constraint if exists tax_opt_decisions_refs_check;
alter table public.tax_opt_decisions
  add constraint tax_opt_decisions_refs_check check (public.fn_tax_opt_refs_ok(evidence_refs));

-- ---------------------------------------------------------------------------
-- Integrity trigger: only an active SUPER_ADMIN can be the decider; the chain must be gapless; hash is computed here.
-- ---------------------------------------------------------------------------
create or replace function public.fn_tax_opt_decision_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  last_row public.tax_opt_decisions%rowtype;
  canon text;
begin
  if not exists (
    select 1 from public.finance_platform_admins a
    where a.user_id = new.decision_by and a.role = 'SUPER_ADMIN' and a.is_active and a.revoked_at is null
  ) then
    raise exception 'only an active SUPER_ADMIN can record a tax optimization decision' using errcode = '42501';
  end if;

  select * into last_row from public.tax_opt_decisions where subject_key = new.subject_key order by seq desc limit 1;
  if not found then
    if new.seq <> 1 or new.prev_event_id is not null or new.prev_hash is not null then
      raise exception 'first event of a subject must have seq 1 and no predecessor' using errcode = 'TO409';
    end if;
  else
    if new.seq <> last_row.seq + 1 or new.prev_event_id is distinct from last_row.id or new.prev_hash is distinct from last_row.event_hash then
      raise exception 'event does not extend the latest event of this subject' using errcode = 'TO409';
    end if;
    if new.recommendation_type <> last_row.recommendation_type or new.tax_year <> last_row.tax_year then
      raise exception 'recommendation type and tax year cannot change inside a subject' using errcode = 'TO409';
    end if;
  end if;

  new.decided_at := clock_timestamp();
  canon := concat_ws('|', new.id::text, new.subject_key, new.seq::text, coalesce(new.prev_hash, ''), new.decision,
    new.decision_by::text, to_char(new.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    new.rules_version, new.calc_hash, new.reason,
    -- Everything a reviewer relies on is in the hash, so evidence or states cannot be swapped without detection.
    new.recommendation_type, new.tax_year, array_to_string(new.evidence_refs, ','), coalesce(new.accountant_verification_ref, ''),
    array_to_string(new.figure_states, ','), new.open_items::text, new.scope);
  new.event_hash := encode(sha256(convert_to(canon, 'UTF8')), 'hex');
  return new;
end;
$$;
drop trigger if exists trg_tax_opt_decision_guard on public.tax_opt_decisions;
create trigger trg_tax_opt_decision_guard
  before insert on public.tax_opt_decisions
  for each row execute function public.fn_tax_opt_decision_guard();

drop trigger if exists trg_tax_opt_decisions_immutable on public.tax_opt_decisions;
create trigger trg_tax_opt_decisions_immutable
  before update or delete on public.tax_opt_decisions
  for each row execute function public.fn_finance_block_mutation();
drop trigger if exists trg_tax_opt_decisions_no_truncate on public.tax_opt_decisions;
create trigger trg_tax_opt_decisions_no_truncate
  before truncate on public.tax_opt_decisions
  for each statement execute function public.fn_finance_block_mutation();
drop trigger if exists trg_tax_opt_decisions_audit on public.tax_opt_decisions;
create trigger trg_tax_opt_decisions_audit
  after insert on public.tax_opt_decisions
  for each row execute function public.fn_finance_audit();

-- ---------------------------------------------------------------------------
-- The only write path
-- ---------------------------------------------------------------------------
create or replace function public.tax_opt_record_decision(
  p_actor uuid,
  p_request_id uuid,
  p_subject_key text,
  p_recommendation_type text,
  p_tax_year text,
  p_decision text,
  p_reason text,
  p_rules_version text,
  p_viewed_rules_version text,
  p_calc_hash text,
  p_viewed_calc_hash text,
  p_figure_states text[],
  p_open_items integer,
  p_evidence_refs text[],
  p_accountant_ref text,
  p_expected_seq integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.tax_opt_decisions%rowtype;
  last_row public.tax_opt_decisions%rowtype;
  new_id uuid := gen_random_uuid();
begin
  if p_actor is null or p_request_id is null or p_subject_key is null then
    raise exception 'actor, request id and subject are required' using errcode = '22004';
  end if;

  -- Serialise every writer of this subject; concurrent submissions queue here.
  perform pg_advisory_xact_lock(hashtextextended('tax_opt:' || p_subject_key, 0));

  -- Double submission: the same request id returns the stored event and writes nothing.
  select * into existing from public.tax_opt_decisions where request_id = p_request_id;
  if found then
    if existing.subject_key = p_subject_key and existing.decision = p_decision and existing.decision_by = p_actor then
      return existing.id;
    end if;
    raise exception 'request id was already used for a different decision' using errcode = 'TO409';
  end if;

  -- The Founder must have reviewed exactly what is being recorded now.
  if p_viewed_calc_hash is distinct from p_calc_hash then
    raise exception 'calculation changed since it was reviewed' using errcode = 'TO412';
  end if;
  if p_viewed_rules_version is distinct from p_rules_version then
    raise exception 'rules version changed since it was reviewed' using errcode = 'TO412';
  end if;

  select * into last_row from public.tax_opt_decisions where subject_key = p_subject_key order by seq desc limit 1;
  if coalesce(last_row.seq, 0) <> coalesce(p_expected_seq, -1) then
    raise exception 'another decision was recorded first (expected seq %, latest %)', p_expected_seq, coalesce(last_row.seq, 0) using errcode = 'TO409';
  end if;

  if p_decision = 'APPROVED' and found and last_row.decision = 'APPROVED'
     and last_row.calc_hash = p_calc_hash and last_row.rules_version = p_rules_version then
    raise exception 'this calculation is already approved' using errcode = 'TO409';
  end if;
  if p_decision = 'REVOKED' and (not found or last_row.decision <> 'APPROVED') then
    raise exception 'only an approval can be revoked' using errcode = 'TO409';
  end if;
  if p_decision = 'REJECTED' and found and last_row.decision = 'APPROVED' then
    raise exception 'revoke the approval first, then reject' using errcode = 'TO409';
  end if;

  insert into public.tax_opt_decisions (
    id, request_id, subject_key, seq, prev_event_id, prev_hash, event_hash, recommendation_type, tax_year, decision, reason,
    decision_by, rules_version, calc_hash, figure_states, open_items, evidence_refs, accountant_verification_ref
  ) values (
    new_id, p_request_id, p_subject_key, coalesce(last_row.seq, 0) + 1, last_row.id, last_row.event_hash, repeat('0', 64),
    p_recommendation_type, p_tax_year, p_decision, p_reason, p_actor, p_rules_version, p_calc_hash,
    coalesce(p_figure_states, '{}'::text[]), coalesce(p_open_items, 0), coalesce(p_evidence_refs, '{}'::text[]), p_accountant_ref
  );
  return new_id;
end;
$$;

create or replace function public.tax_opt_effective_status(p_subject_key text, p_current_calc_hash text, p_current_rules_version text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  last_row public.tax_opt_decisions%rowtype;
begin
  select * into last_row from public.tax_opt_decisions where subject_key = p_subject_key order by seq desc limit 1;
  if not found then return 'NONE'; end if;
  if last_row.decision = 'REJECTED' then return 'REJECTED'; end if;
  if last_row.decision = 'REVOKED' then return 'REVOKED'; end if;
  if last_row.calc_hash <> p_current_calc_hash then return 'STALE_CALC_CHANGED'; end if;
  if last_row.rules_version <> p_current_rules_version then return 'STALE_RULES_CHANGED'; end if;
  return 'APPROVED_EFFECTIVE';
end;
$$;

create or replace function public.tax_opt_verify_chain(p_subject_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r public.tax_opt_decisions%rowtype;
  expected_prev text := null;
  expected_seq integer := 1;
  canon text;
begin
  for r in select * from public.tax_opt_decisions where subject_key = p_subject_key order by seq loop
    if r.seq <> expected_seq or r.prev_hash is distinct from expected_prev then return false; end if;
    canon := concat_ws('|', r.id::text, r.subject_key, r.seq::text, coalesce(r.prev_hash, ''), r.decision, r.decision_by::text,
      to_char(r.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), r.rules_version, r.calc_hash, r.reason,
      r.recommendation_type, r.tax_year, array_to_string(r.evidence_refs, ','), coalesce(r.accountant_verification_ref, ''),
      array_to_string(r.figure_states, ','), r.open_items::text, r.scope);
    if r.event_hash <> encode(sha256(convert_to(canon, 'UTF8')), 'hex') then return false; end if;
    expected_prev := r.event_hash;
    expected_seq := expected_seq + 1;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- No self-promotion, no escalation of staff permissions (finance_platform_admins, created by PR #61/#62)
-- ---------------------------------------------------------------------------
create or replace function public.fn_finance_admins_no_escalation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  escalating boolean;
  any_super boolean;
begin
  if tg_op = 'INSERT' then
    escalating := new.is_active and new.revoked_at is null and new.role in ('SUPER_ADMIN', 'STAFF');
  else
    escalating :=
      (new.role = 'SUPER_ADMIN' and old.role <> 'SUPER_ADMIN')
      or (new.role = 'STAFF' and old.role in ('FINANCE_ADMIN', 'FINANCE_VIEWER'))
      or not (new.permissions <@ old.permissions)
      or (new.is_active and not old.is_active)
      or (new.revoked_at is null and old.revoked_at is not null);
  end if;
  if not escalating then
    return new;
  end if;

  select exists (select 1 from public.finance_platform_admins where role = 'SUPER_ADMIN' and is_active and revoked_at is null) into any_super;
  if not any_super and tg_op = 'INSERT' and new.role = 'SUPER_ADMIN' then
    return new; -- bootstrap of the very first Super Admin by an explicitly approved statement
  end if;
  if new.granted_by is null or new.granted_by = new.user_id then
    raise exception 'an admin cannot grant or raise their own access' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.finance_platform_admins g
    where g.user_id = new.granted_by and g.role = 'SUPER_ADMIN' and g.is_active and g.revoked_at is null and g.user_id <> new.user_id
  ) then
    raise exception 'access can only be granted or raised by another active SUPER_ADMIN' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_finance_admins_no_escalation on public.finance_platform_admins;
create trigger trg_finance_admins_no_escalation
  before insert or update on public.finance_platform_admins
  for each row execute function public.fn_finance_admins_no_escalation();

-- ---------------------------------------------------------------------------
-- RLS and grants: RLS on with NO policies; no public/anon/authenticated access at all; service_role can read the log
-- and call the functions, but cannot write the table directly.
-- ---------------------------------------------------------------------------
alter table public.tax_opt_decisions enable row level security;
revoke all on public.tax_opt_decisions from public, anon, authenticated, service_role;
grant select on public.tax_opt_decisions to service_role;

revoke all on function public.fn_tax_opt_refs_ok(text[]) from public, anon, authenticated;
revoke all on function public.fn_tax_opt_decision_guard() from public, anon, authenticated;
revoke all on function public.fn_finance_admins_no_escalation() from public, anon, authenticated;
revoke all on function public.tax_opt_record_decision(uuid, uuid, text, text, text, text, text, text, text, text, text, text[], integer, text[], text, integer) from public, anon, authenticated;
revoke all on function public.tax_opt_effective_status(text, text, text) from public, anon, authenticated;
revoke all on function public.tax_opt_verify_chain(text) from public, anon, authenticated;
grant execute on function public.tax_opt_record_decision(uuid, uuid, text, text, text, text, text, text, text, text, text, text[], integer, text[], text, integer) to service_role;
grant execute on function public.tax_opt_effective_status(text, text, text) to service_role;
grant execute on function public.tax_opt_verify_chain(text) to service_role;
