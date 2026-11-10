-- ============================================================================
-- 10_migrations_part_6.sql  (bagian 6 dari 8)  -- SANDBOX DOKU SAJA
-- Migrasi 41 s/d 45 dari 49:  20261027120000_linoe_accounting_ledger.sql  ...  20261030100100_prompter_b1_trial_remainder_carryover.sql
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- File ini DIBANGUN OTOMATIS oleh tools/build_bundles.py; isi migrasi disalin apa adanya.
-- Jalankan HANYA di project sandbox (cek ref di URL dashboard), SETELAH 00 PASS dan 01 sukses,
-- dan berurutan (bagian 6 butuh 40 migrasi sudah tercatat). Satu transaksi: gagal = tidak ada yang terpasang.
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
  if (select count(*) from public._linoe_sandbox_applied) <> 40 then
    raise exception 'ABORT: urutan salah. Harus ada 40 migrasi tercatat sebelum bagian ini.';
  end if;
end $guard$;

-- >>> 20261027120000_linoe_accounting_ledger.sql  sha256=2436fd006c77d33dd33330fde66858eb024c47da61615f398b5ef898ab28088f
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
insert into public._linoe_sandbox_applied (version, sha256) values ('20261027120000', '2436fd006c77d33dd33330fde66858eb024c47da61615f398b5ef898ab28088f');

-- >>> 20261027130000_linoe_tax_optimization_approvals.sql  sha256=550e635fbe40e73c794eb9d7cb345104fa5c9dea80d038cb4ff0f8ad3f55d8f0
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
insert into public._linoe_sandbox_applied (version, sha256) values ('20261027130000', '550e635fbe40e73c794eb9d7cb345104fa5c9dea80d038cb4ff0f8ad3f55d8f0');

-- >>> 20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql  sha256=af580f85cf55eabc9310fd98902cc04209aa5d098e30eb31b0ee8ce1d99db7f9
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
insert into public._linoe_sandbox_applied (version, sha256) values ('20261029220000', 'af580f85cf55eabc9310fd98902cc04209aa5d098e30eb31b0ee8ce1d99db7f9');

-- >>> 20261030100000_prompter_b1_server_only_checkout.sql  sha256=67ae6601d1c8a73179e4964a7010d97325fadde53b3835385fc073243559c88d
-- LINOE Billing B1: transactions are created ONLY by a trusted server path, priced ONLY from the database catalog.
-- NOT APPLIED to any database by the PR that adds this file.
--
-- Closes (Billing P0 audit): an Owner could INSERT a PENDING prompter_payment_transactions row directly over
-- PostgREST with ANY plan / amount / currency / provider (policy "Buat payment transaction tenant sendiri"), and the
-- evidence table still carried client UPDATE / DELETE / TRUNCATE grants.
--
-- What this does (one transaction, additive except the policy/grant revocations):
--   1. prompter_plan_prices: the price catalog in the DATABASE (no client access at all; seeded from lib/billing/plans.ts,
--      kept in sync by a drift test).
--   2. fn_begin_checkout(tenant, user, plan, provider): service_role only. NO amount / currency parameter exists, so no
--      caller can supply a price. It re-checks in SQL that the user is an Owner of that tenant, that the plan has a
--      catalog price and is ACTIVE in prompter_plan_entitlements, and it caps open PENDING rows per tenant.
--   3. fn_payment_txn_insert_guard + trigger (defense in depth, any role): a new transaction must be PENDING, carry no
--      provider ids / paid_at, and match the catalog price and currency exactly. Client roles are rejected outright.
--   4. DROP the client INSERT policy; REVOKE all client write privileges (INSERT/UPDATE/DELETE/TRUNCATE) on
--      prompter_payment_transactions. SELECT for the tenant's own rows (RLS) is unchanged.
--
-- Compatible with PR #74 (20261029220000): touches nothing of prompter_subscriptions / fn_set_trial_plan_preference;
-- fn_apply_verified_payment (webhook path, service_role) is not modified and keeps working.
-- Deploy order: apply this migration, then merge/deploy the app (either order is fail-closed while live payments are HOLD).
-- Rollback: supabase/rollback/20261030100000_prompter_b1_server_only_checkout.down.sql (fail-closed, needs confirmation).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. Price catalog (database-side source of truth for what a checkout may charge).
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_plan_prices (
  plan text primary key references public.prompter_plan_entitlements(plan),
  price_idr integer not null check (price_idr > 0),
  currency text not null default 'IDR' check (currency = 'IDR'),
  billing_period text not null default 'MONTH' check (billing_period = 'MONTH'),
  updated_at timestamptz not null default now(),
  constraint prompter_plan_prices_not_free check (plan <> 'FREE')
);

comment on table public.prompter_plan_prices is
  'Billing B1: the only price list a checkout may use (fn_begin_checkout and the payment-transaction insert guard read it). Mirrors lib/billing/plans.ts PLAN_TIERS priceIDR for sellable plans (a unit test fails on drift). No client access; only a migration / service_role may change it. A plan is purchasable only if it has a row here AND is ACTIVE in prompter_plan_entitlements (so AGENCY / COMING_SOON and UMKMPRO_BUNDLE are not sellable).';

drop trigger if exists trg_prompter_plan_prices_updated_at on public.prompter_plan_prices;
create trigger trg_prompter_plan_prices_updated_at
  before update on public.prompter_plan_prices
  for each row execute function public.prompter_set_updated_at();

alter table public.prompter_plan_prices enable row level security;
revoke all on public.prompter_plan_prices from public, anon, authenticated;

insert into public.prompter_plan_prices (plan, price_idr)
select v.plan, v.price_idr
from (values ('STARTER', 99000), ('GROWTH', 199000), ('PRO', 399000), ('BUSINESS', 799000)) as v(plan, price_idr)
where exists (select 1 from public.prompter_plan_entitlements e where e.plan = v.plan)
on conflict (plan) do nothing;

-- ---------------------------------------------------------------------------
-- 2. fn_begin_checkout: the single server-side way to create a PENDING transaction.
--    Outcomes (out_outcome): CREATED | INVALID | NOT_MEMBER | NOT_OWNER | PLAN_NOT_PURCHASABLE |
--                            PLAN_NOT_AVAILABLE | NO_SUBSCRIPTION | TOO_MANY_PENDING
--    Never raises for a business condition. Amount and currency are returned FROM the catalog.
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
  v_pending integer;
  v_new uuid;
begin
  if p_tenant_id is null or p_user_id is null
     or coalesce(p_plan, '') = ''
     or p_provider is null or p_provider !~ '^[A-Za-z0-9_-]{2,40}$' then
    return query select null::uuid, null::numeric, null::text, 'INVALID'::text;
    return;
  end if;

  -- Independent of whatever the application already checked: the user must be an Owner of THIS tenant.
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

  perform 1 from public.prompter_subscriptions where tenant_id = p_tenant_id;
  if not found then
    return query select null::uuid, null::numeric, null::text, 'NO_SUBSCRIPTION'::text;
    return;
  end if;

  -- Serialise checkout creation per tenant, then cap abandoned PENDING rows (spam / enumeration guard).
  perform pg_advisory_xact_lock(hashtext('prompter_checkout:' || p_tenant_id::text));
  select count(*) into v_pending
  from public.prompter_payment_transactions
  where tenant_id = p_tenant_id and status = 'PENDING' and created_at > now() - interval '1 hour';
  if v_pending >= 10 then
    return query select null::uuid, null::numeric, null::text, 'TOO_MANY_PENDING'::text;
    return;
  end if;

  insert into public.prompter_payment_transactions (tenant_id, user_id, provider, plan, amount, currency)
  values (p_tenant_id, p_user_id, p_provider, p_plan, v_price, v_currency)
  returning id into v_new;

  return query select v_new, v_price::numeric, v_currency, 'CREATED'::text;
end;
$$;

comment on function public.fn_begin_checkout(uuid, uuid, text, text) is
  'Billing B1: creates a PENDING payment transaction priced from prompter_plan_prices. No amount or currency parameter by design. service_role only; the application passes the tenant / user from the verified session and this function re-verifies Owner membership in SQL.';

revoke all on function public.fn_begin_checkout(uuid, uuid, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_begin_checkout(uuid, uuid, text, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Defense in depth for ANY insert into prompter_payment_transactions (including a buggy server path).
--    SECURITY INVOKER on purpose: current_user is the real caller (anon / authenticated under PostgREST, the function
--    owner inside the SECURITY DEFINER fn_begin_checkout), exactly as in the PR #74 trigger.
-- ---------------------------------------------------------------------------
create or replace function public.fn_payment_txn_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_price integer;
  v_currency text;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'payment transactions can only be created by the server (fn_begin_checkout)'
      using errcode = '42501';
  end if;
  if new.status is distinct from 'PENDING'
     or new.provider_payment_id is not null or new.provider_event_id is not null or new.paid_at is not null then
    raise exception 'a new payment transaction must be PENDING with no provider ids and no paid_at'
      using errcode = '23514';
  end if;
  select price_idr, currency into v_price, v_currency from public.prompter_plan_prices where plan = new.plan;
  if not found or new.amount is distinct from v_price::numeric or new.currency is distinct from v_currency then
    raise exception 'payment transaction plan / amount / currency does not match the server price catalog'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.fn_payment_txn_insert_guard() is
  'Billing B1: rejects client-role inserts and any insert whose plan / amount / currency differs from prompter_plan_prices, or that is not a clean PENDING row. Fires for every role.';

drop trigger if exists trg_prompter_payment_txn_insert_guard on public.prompter_payment_transactions;
create trigger trg_prompter_payment_txn_insert_guard
  before insert on public.prompter_payment_transactions
  for each row execute function public.fn_payment_txn_insert_guard();

-- ---------------------------------------------------------------------------
-- 4. No client write path to the payment evidence table. Reads (own tenant, via RLS) are unchanged.
--    Existing rows are not touched (no INSERT / UPDATE / DELETE of data in this migration except the catalog seed).
-- ---------------------------------------------------------------------------
drop policy if exists "Buat payment transaction tenant sendiri" on public.prompter_payment_transactions;
revoke all on public.prompter_payment_transactions from public, anon, authenticated;
grant select on public.prompter_payment_transactions to authenticated;
insert into public._linoe_sandbox_applied (version, sha256) values ('20261030100000', '67ae6601d1c8a73179e4964a7010d97325fadde53b3835385fc073243559c88d');

-- >>> 20261030100100_prompter_b1_trial_remainder_carryover.sql  sha256=66a9737737b1ccf0ca1649be780f6186335675e60e0dffb254e15be5aecc1e92
-- LINOE Billing B1 (part 2, independently applicable): unused trial time is NOT lost on the first payment.
-- NOT APPLIED to any database by the PR that adds this file.
--
-- Today fn_apply_verified_payment sets current_period_end = now() + 1 month on the TRIALING -> ACTIVE transition, which
-- silently discards the days the customer still had left of the 14-day trial. This trigger adds the unused remainder
-- (capped at 14 days, the unchanged trial length) to that first paid period. It does not change the trial length, the
-- trial entitlements, or any other transition: renewals (ACTIVE -> ACTIVE), replays and expired trials are unaffected.
-- Works for fn_apply_verified_payment (current) and any later payment function that moves the same columns.
-- Rollback: supabase/rollback/20261030100100_prompter_b1_trial_remainder_carryover.down.sql

set local lock_timeout = '3s';

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
  'Billing B1: adds the unused trial time (max 14 days) to the first paid period on TRIALING -> ACTIVE when the writer also moved current_period_end. No other transition is affected.';

drop trigger if exists trg_prompter_subscriptions_trial_carryover on public.prompter_subscriptions;
create trigger trg_prompter_subscriptions_trial_carryover
  before update of status, current_period_end on public.prompter_subscriptions
  for each row execute function public.fn_subscription_trial_carryover();
insert into public._linoe_sandbox_applied (version, sha256) values ('20261030100100', '66a9737737b1ccf0ca1649be780f6186335675e60e0dffb254e15be5aecc1e92');

commit;
