-- LINOE accounting ledger + tax support (Phase C) — ADDITIVE ONLY, NOT APPLIED to any environment.
--
-- Depends on 20261027100000_linoe_finance_foundation.sql (fn_finance_block_mutation, fn_finance_audit,
-- finance_audit_logs). Creates the double-entry store behind lib/accounting:
--   acct_accounts, acct_period_events, acct_journals, acct_journal_lines,
--   acct_bank_statement_lines, acct_bank_matches, acct_bank_reconciliations,
--   acct_open_items, acct_open_item_payments,
--   acct_corporate_tax_settings, acct_fiscal_adjustments, acct_other_activities, acct_tax_payments.
--
-- Safety properties (checked by tests/unit/migrations/accounting-ledger.test.ts):
--   * touches NO existing table, function, policy, cron job or Edge Function;
--   * money is bigint minor units (scale 2), never float/numeric/double;
--   * a journal cannot exist unbalanced, one-sided, without a reference, or in a closed period
--     (balance is a DEFERRED constraint trigger, so a journal and its lines are inserted together);
--   * journals, lines, period events and every tax record are append-only: no UPDATE, DELETE or
--     TRUNCATE. A correction is a reversing journal (reverses_id is UNIQUE: reversed at most once);
--   * source_key is UNIQUE: the same business fact can never be recorded twice;
--   * no seed rows, no opening balances, no rates. Opening balances need evidence (type OPENING);
--   * RLS enabled with NO policies and anon/authenticated lose every grant: only the service role
--     (server-side, after the admin permission gate) can reach these tables.
--
-- Rollback: supabase/rollback/20261027120000_linoe_accounting_ledger.down.sql (refuses if any table has rows).
set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Chart of accounts (structure only)
-- ---------------------------------------------------------------------------
create table if not exists public.acct_accounts (
  code text primary key check (code ~ '^[0-9]{4}$'),
  name text not null check (btrim(name) <> ''),
  account_type text not null check (account_type in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  postable boolean not null default true,
  contra boolean not null default false,
  cash_flow text check (cash_flow in ('CASH', 'OPERATING', 'INVESTING', 'FINANCING')),
  parent_code text references public.acct_accounts (code),
  created_at timestamptz not null default now()
);

-- Period open/close is an append-only event log; the latest event per period wins.
create table if not exists public.acct_period_events (
  id bigint generated always as identity primary key,
  period_key text not null check (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  action text not null check (action in ('CLOSE', 'REOPEN')),
  actor_id uuid not null,
  reason text,
  occurred_at timestamptz not null default now(),
  check (action = 'CLOSE' or (reason is not null and btrim(reason) <> ''))
);

create table if not exists public.acct_journals (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  source_key text not null unique check (btrim(source_key) <> ''),
  entry_date date not null,
  period_key text generated always as (
    lpad((extract(year from entry_date))::int::text, 4, '0') || '-' || lpad((extract(month from entry_date))::int::text, 2, '0')
  ) stored,
  description text not null check (btrim(description) <> ''),
  reference text not null check (btrim(reference) <> ''),
  journal_type text not null check (journal_type in ('NORMAL', 'REVERSAL', 'ADJUSTMENT', 'CLOSING', 'OPENING')),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  evidence text,
  reverses_id uuid unique references public.acct_journals (id),
  posted_by uuid not null,
  posted_at timestamptz not null default now(),
  check (journal_type <> 'OPENING' or (evidence is not null and btrim(evidence) <> '')),
  check ((journal_type = 'REVERSAL') = (reverses_id is not null))
);

create table if not exists public.acct_journal_lines (
  id bigint generated always as identity primary key,
  journal_id uuid not null references public.acct_journals (id),
  line_no integer not null check (line_no > 0),
  account_code text not null references public.acct_accounts (code),
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  memo text,
  unique (journal_id, line_no),
  -- exactly one positive side per line
  check ((debit_minor > 0) <> (credit_minor > 0))
);
create index if not exists acct_journal_lines_account_idx on public.acct_journal_lines (account_code);

-- ---------------------------------------------------------------------------
-- Bank reconciliation
-- ---------------------------------------------------------------------------
create table if not exists public.acct_bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_date date not null,
  reference text not null check (btrim(reference) <> ''),
  amount_minor bigint not null check (amount_minor <> 0),
  source_ref text not null check (btrim(source_ref) <> ''),
  imported_by uuid not null,
  created_at timestamptz not null default now(),
  unique (source_ref, statement_date, reference, amount_minor)
);

create table if not exists public.acct_bank_matches (
  id bigint generated always as identity primary key,
  bank_line_id uuid not null unique references public.acct_bank_statement_lines (id),
  journal_line_id bigint not null unique references public.acct_journal_lines (id),
  basis text not null check (basis in ('REFERENCE_AND_AMOUNT', 'AMOUNT_AND_DATE_WINDOW', 'MANUAL')),
  matched_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.acct_bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  as_of date not null,
  statement_balance_minor bigint not null,
  gl_balance_minor bigint not null,
  unexplained_minor bigint not null,
  finalized_by uuid,
  finalized_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  -- final only when nothing is left unexplained
  check (finalized_by is null or unexplained_minor = 0),
  check ((finalized_by is null) = (finalized_at is null))
);

-- ---------------------------------------------------------------------------
-- Receivables / payables sub-ledger
-- ---------------------------------------------------------------------------
create table if not exists public.acct_open_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('RECEIVABLE', 'PAYABLE')),
  party text not null check (btrim(party) <> ''),
  reference text not null check (btrim(reference) <> ''),
  issue_date date not null,
  due_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (kind, reference),
  check (due_date >= issue_date)
);
create table if not exists public.acct_open_item_payments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.acct_open_items (id),
  paid_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  reference text not null check (btrim(reference) <> ''),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (item_id, reference)
);

-- ---------------------------------------------------------------------------
-- Tax support. NO default rate anywhere: a rate exists only when a named person verified it.
-- ---------------------------------------------------------------------------
create table if not exists public.acct_corporate_tax_settings (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  corporate_tax_rate_bps integer check (corporate_tax_rate_bps is null or corporate_tax_rate_bps between 1 and 10000),
  verified_by text,
  verified_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (corporate_tax_rate_bps is null or (verified_by is not null and verified_at is not null))
);

-- Insert-only: verifying an adjustment is a NEW row that supersedes the pending one.
create table if not exists public.acct_fiscal_adjustments (
  id uuid primary key default gen_random_uuid(),
  tax_year text not null check (tax_year ~ '^[0-9]{4}$'),
  description text not null check (btrim(description) <> ''),
  direction text not null check (direction in ('POSITIVE', 'NEGATIVE')),
  nature text not null check (nature in ('PERMANENT', 'TEMPORARY')),
  amount_minor bigint not null check (amount_minor > 0),
  evidence_ref text,
  verified_by text,
  verified_at timestamptz,
  supersedes_id uuid unique references public.acct_fiscal_adjustments (id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check ((verified_by is null) = (verified_at is null))
);

-- Fiscal profit of the PT's other activities, so the entity-level view can be completed (and verified).
create table if not exists public.acct_other_activities (
  id uuid primary key default gen_random_uuid(),
  tax_year text not null check (tax_year ~ '^[0-9]{4}$'),
  activity_name text not null check (btrim(activity_name) <> ''),
  fiscal_profit_minor bigint not null,
  verified_by text,
  verified_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tax_year, activity_name, created_at),
  check ((verified_by is null) = (verified_at is null))
);

create table if not exists public.acct_tax_payments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('PPH21', 'PPH22', 'PPH23', 'PPH25', 'PPH29', 'PPN', 'LAINNYA')),
  paid_date date not null,
  description text not null check (btrim(description) <> ''),
  amount_minor bigint not null check (amount_minor > 0),
  -- withholding-slip number or payment proof: no proof, no record
  evidence_ref text not null check (btrim(evidence_ref) <> ''),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (kind, evidence_ref)
);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create or replace function public.fn_acct_journal_balanced()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  jid uuid;
  d bigint;
  c bigint;
  n integer;
  nd integer;
  nc integer;
begin
  jid := coalesce(new.journal_id, old.journal_id);
  select coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0), count(*),
         count(*) filter (where debit_minor > 0), count(*) filter (where credit_minor > 0)
    into d, c, n, nd, nc
  from public.acct_journal_lines where journal_id = jid;
  if n < 2 or nd < 1 or nc < 1 then
    raise exception 'journal % must have at least one debit and one credit line', jid using errcode = '23514';
  end if;
  if d <> c then
    raise exception 'journal % is unbalanced (debit % <> credit %)', jid, d, c using errcode = '23514';
  end if;
  return null;
end;
$$;

-- A journal with no lines at all must also be refused (the lines trigger would never fire for it).
create or replace function public.fn_acct_journal_has_lines()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.acct_journal_lines where journal_id = new.id) then
    raise exception 'journal % has no lines', new.id using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.fn_acct_period_open()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  last_action text;
  orig_date date;
begin
  -- Stored generated columns are not yet computed in a BEFORE trigger, so derive the key here.
  select action into last_action
  from public.acct_period_events
  where period_key = lpad((extract(year from new.entry_date))::int::text, 4, '0') || '-' || lpad((extract(month from new.entry_date))::int::text, 2, '0')
  order by id desc limit 1;
  if last_action = 'CLOSE' then
    raise exception 'accounting period % is closed', to_char(new.entry_date, 'YYYY-MM') using errcode = '42501';
  end if;
  if new.reverses_id is not null then
    select entry_date into orig_date from public.acct_journals where id = new.reverses_id;
    if orig_date is null or new.entry_date < orig_date then
      raise exception 'a reversal cannot be dated before the journal it reverses' using errcode = '23514';
    end if;
    if exists (select 1 from public.acct_journals where id = new.reverses_id and journal_type = 'REVERSAL') then
      raise exception 'a reversal cannot itself be reversed' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_acct_journal_period on public.acct_journals;
create trigger trg_acct_journal_period
  before insert on public.acct_journals
  for each row execute function public.fn_acct_period_open();

drop trigger if exists trg_acct_journal_has_lines on public.acct_journals;
create constraint trigger trg_acct_journal_has_lines
  after insert on public.acct_journals
  deferrable initially deferred
  for each row execute function public.fn_acct_journal_has_lines();

drop trigger if exists trg_acct_lines_balanced on public.acct_journal_lines;
create constraint trigger trg_acct_lines_balanced
  after insert on public.acct_journal_lines
  deferrable initially deferred
  for each row execute function public.fn_acct_journal_balanced();

-- A header account can never receive a line.
create or replace function public.fn_acct_line_postable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.acct_accounts where code = new.account_code and postable) then
    raise exception 'account % is not postable', new.account_code using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_acct_line_postable on public.acct_journal_lines;
create trigger trg_acct_line_postable
  before insert on public.acct_journal_lines
  for each row execute function public.fn_acct_line_postable();

-- ---------------------------------------------------------------------------
-- Immutability (reuses the foundation trigger function) + audit
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'acct_accounts', 'acct_period_events', 'acct_journals', 'acct_journal_lines',
    'acct_bank_statement_lines', 'acct_bank_matches', 'acct_open_items', 'acct_open_item_payments',
    'acct_corporate_tax_settings', 'acct_fiscal_adjustments', 'acct_other_activities', 'acct_tax_payments'
  ] loop
    execute format('drop trigger if exists trg_%s_immutable on public.%I', t, t);
    execute format('create trigger trg_%s_immutable before update or delete on public.%I for each row execute function public.fn_finance_block_mutation()', t, t);
    execute format('drop trigger if exists trg_%s_no_truncate on public.%I', t, t);
    execute format('create trigger trg_%s_no_truncate before truncate on public.%I for each statement execute function public.fn_finance_block_mutation()', t, t);
    execute format('drop trigger if exists trg_%s_audit on public.%I', t, t);
    execute format('create trigger trg_%s_audit after insert on public.%I for each row execute function public.fn_finance_audit()', t, t);
  end loop;
end
$$;

-- bank reconciliations may be finalised once (update of finalized_*), nothing else changes
create or replace function public.fn_acct_bank_rec_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'reconciliations cannot be deleted' using errcode = '42501';
  end if;
  if old.finalized_by is not null
     or new.as_of is distinct from old.as_of
     or new.statement_balance_minor is distinct from old.statement_balance_minor
     or new.gl_balance_minor is distinct from old.gl_balance_minor
     or new.unexplained_minor is distinct from old.unexplained_minor
     or new.created_by is distinct from old.created_by then
    raise exception 'a finalised reconciliation and its figures cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_acct_bank_rec_guard on public.acct_bank_reconciliations;
create trigger trg_acct_bank_rec_guard
  before update or delete on public.acct_bank_reconciliations
  for each row execute function public.fn_acct_bank_rec_guard();
drop trigger if exists trg_acct_bank_rec_no_truncate on public.acct_bank_reconciliations;
create trigger trg_acct_bank_rec_no_truncate
  before truncate on public.acct_bank_reconciliations
  for each statement execute function public.fn_finance_block_mutation();
drop trigger if exists trg_acct_bank_rec_audit on public.acct_bank_reconciliations;
create trigger trg_acct_bank_rec_audit
  after insert or update on public.acct_bank_reconciliations
  for each row execute function public.fn_finance_audit();

-- ---------------------------------------------------------------------------
-- RLS: enabled, NO policies. Grants: service_role only, no DELETE, no TRUNCATE.
-- service_role is revoked explicitly before it is granted: Supabase DEFAULT PRIVILEGES in schema public give every new table,
-- sequence and function to anon, authenticated and service_role, so a GRANT alone would leave DELETE/TRUNCATE/UPDATE in place.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'acct_accounts', 'acct_period_events', 'acct_journals', 'acct_journal_lines',
    'acct_bank_statement_lines', 'acct_bank_matches', 'acct_bank_reconciliations',
    'acct_open_items', 'acct_open_item_payments',
    'acct_corporate_tax_settings', 'acct_fiscal_adjustments', 'acct_other_activities', 'acct_tax_payments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
  end loop;
end
$$;
grant update on public.acct_bank_reconciliations to service_role;

revoke all on sequence public.acct_period_events_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.acct_journals_seq_seq from public, anon, authenticated, service_role;
revoke all on sequence public.acct_journal_lines_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.acct_bank_matches_id_seq from public, anon, authenticated, service_role;
grant usage on sequence public.acct_period_events_id_seq to service_role;
grant usage on sequence public.acct_journals_seq_seq to service_role;
grant usage on sequence public.acct_journal_lines_id_seq to service_role;
grant usage on sequence public.acct_bank_matches_id_seq to service_role;

revoke all on function public.fn_acct_journal_balanced() from public, anon, authenticated, service_role;
revoke all on function public.fn_acct_journal_has_lines() from public, anon, authenticated, service_role;
revoke all on function public.fn_acct_period_open() from public, anon, authenticated, service_role;
revoke all on function public.fn_acct_line_postable() from public, anon, authenticated, service_role;
revoke all on function public.fn_acct_bank_rec_guard() from public, anon, authenticated, service_role;
