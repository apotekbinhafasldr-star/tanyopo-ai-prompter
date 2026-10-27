-- Privilege behaviour of ALL finance, accounting and approval objects, on the fully migrated chain, in a database that carries
-- Supabase-like DEFAULT PRIVILEGES (see tax-approvals/support.sql). SYNTHETIC data only. Run as the migration owner (superuser).
--
-- Why this exists: in the real project a bare CREATE TABLE is handed to anon, authenticated and service_role by default privileges.
-- A migration that only REVOKEs from public/anon/authenticated leaves service_role with DELETE, TRUNCATE and UPDATE. A throw-away
-- database without those defaults starts closed and hides that. The checks below fail on exactly that mistake.
create schema if not exists tp;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'tp_nobody') then create role tp_nobody nologin; end if; end $$;
grant usage on schema public to tp_nobody; -- a plain role stands in for PUBLIC: only the object privilege may stop it
grant usage on schema tp to public;

create or replace function tp.ok(cond boolean, name text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', name; end if; raise notice 'PASS: %', name; end $$;

-- run stmt as role r; true only when it is refused with insufficient_privilege (42501), not by some other error
create or replace function tp.denied(r text, stmt text) returns boolean language plpgsql as $$
declare refused boolean := false;
begin
  begin
    execute format('set local role %I', r);
    execute stmt;
  exception when others then
    refused := (sqlstate = '42501');
  end;
  reset role;
  return refused;
end $$;

create or replace function tp.allowed(r text, stmt text) returns boolean language plpgsql as $$
declare done boolean := false;
begin
  begin
    execute format('set local role %I', r);
    execute stmt;
    done := true;
  exception when others then
    done := false;
  end;
  reset role;
  return done;
end $$;

-- run stmt as the owner; true only when a guard trigger refuses it with a message matching pat
create or replace function tp.blocked(stmt text, pat text) returns boolean language plpgsql as $$
declare refused boolean := false;
begin
  begin execute stmt; exception when others then refused := (sqlerrm ilike pat); end;
  return refused;
end $$;

create temp table tp_tables as
  select c.oid, c.oid::regclass::text as t, c.relname::text as name,
         (select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attidentity = '' and a.attgenerated = '' order by a.attnum limit 1) as col
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname ~ '^(acct_|finance_|tax_opt_)';
create temp table tp_seqs as
  select c.oid::regclass::text as s from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname ~ '^(acct_|finance_|tax_opt_)';

select tp.ok((select count(*) from tp_tables) = 21, 'the test covers all 21 finance, accounting and approval tables (7 + 13 + 1)');
select tp.ok((select count(*) from tp_seqs) = 5, 'the test covers all 5 sequences');
select tp.ok((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname ~ '^(fn_finance_|fn_acct_|fn_tax_opt_|tax_opt_)') = 15, 'the test covers all 15 functions');

-- 1) anon, authenticated and a role with no grants (stands in for PUBLIC): nothing at all, on any table
do $$
declare r text; x record; bad int := 0; n int := 0;
begin
  foreach r in array array['anon', 'authenticated', 'tp_nobody'] loop
    for x in select * from tp_tables loop
      n := n + 5;
      if not tp.denied(r, format('select 1 from %s limit 1', x.t)) then bad := bad + 1; raise notice 'open: % SELECT %', r, x.name; end if;
      if not tp.denied(r, format('insert into %s default values', x.t)) then bad := bad + 1; raise notice 'open: % INSERT %', r, x.name; end if;
      if not tp.denied(r, format('update %s set %I = %I where false', x.t, x.col, x.col)) then bad := bad + 1; raise notice 'open: % UPDATE %', r, x.name; end if;
      if not tp.denied(r, format('delete from %s where false', x.t)) then bad := bad + 1; raise notice 'open: % DELETE %', r, x.name; end if;
      if not tp.denied(r, format('truncate %s', x.t)) then bad := bad + 1; raise notice 'open: % TRUNCATE %', r, x.name; end if;
    end loop;
  end loop;
  perform tp.ok(bad = 0 and n = 315, format('anon, authenticated and PUBLIC are refused (42501) on SELECT, INSERT, UPDATE, DELETE and TRUNCATE of every table (%s statements)', n));
end $$;

-- 2) service_role: reads everything, inserts everywhere except the approval log, updates only the four tables that need it,
--    never DELETE, never TRUNCATE
do $$
declare
  x record; bad int := 0; n int := 0;
  upd_ok text[] := array['finance_platform_admins', 'finance_refunds', 'finance_operating_expenses', 'acct_bank_reconciliations'];
begin
  for x in select * from tp_tables loop
    n := n + 4;
    if not tp.allowed('service_role', format('select 1 from %s limit 1', x.t)) then bad := bad + 1; raise notice 'service_role cannot SELECT %', x.name; end if;
    if not tp.denied('service_role', format('delete from %s where false', x.t)) then bad := bad + 1; raise notice 'service_role can DELETE %', x.name; end if;
    if not tp.denied('service_role', format('truncate %s', x.t)) then bad := bad + 1; raise notice 'service_role can TRUNCATE %', x.name; end if;
    if x.name = any (upd_ok) then
      if not tp.allowed('service_role', format('update %s set %I = %I where false', x.t, x.col, x.col)) then bad := bad + 1; raise notice 'service_role cannot UPDATE %', x.name; end if;
    else
      if not tp.denied('service_role', format('update %s set %I = %I where false', x.t, x.col, x.col)) then bad := bad + 1; raise notice 'service_role can UPDATE %', x.name; end if;
    end if;
    if x.name = 'tax_opt_decisions' then
      -- the statement alone is not proof: RLS also answers 42501 when the table is empty of policies, so ask the ACL itself too
      if has_table_privilege('service_role', x.oid, 'INSERT')
         or not tp.denied('service_role', format('insert into %s default values', x.t)) then bad := bad + 1; raise notice 'service_role can INSERT directly into the approval log'; end if;
    end if;
    if has_table_privilege('service_role', x.oid, 'REFERENCES') or has_table_privilege('service_role', x.oid, 'TRIGGER') then
      bad := bad + 1; raise notice 'service_role holds REFERENCES or TRIGGER on %', x.name;
    end if;
  end loop;
  perform tp.ok(bad = 0, format('service_role: SELECT everywhere, UPDATE only on 4 tables, no INSERT into the approval log, no DELETE, no TRUNCATE, no REFERENCES, no TRIGGER (%s statements)', n));
end $$;

-- 3) sequences: nextval for service_role only; no setval (UPDATE); nothing for anyone else
do $$
declare s text; r text; bad int := 0;
begin
  for s in select tp_seqs.s from tp_seqs loop
    if not tp.allowed('service_role', format('select nextval(%L)', s)) then bad := bad + 1; raise notice 'service_role cannot nextval %', s; end if;
    if not tp.denied('service_role', format('select setval(%L, 1000000)', s)) then bad := bad + 1; raise notice 'service_role can setval %', s; end if;
    foreach r in array array['anon', 'authenticated', 'tp_nobody'] loop
      if not tp.denied(r, format('select nextval(%L)', s)) then bad := bad + 1; raise notice '% can nextval %', r, s; end if;
    end loop;
  end loop;
  perform tp.ok(bad = 0, 'sequences: service_role may only draw the next value; anon, authenticated and PUBLIC may not touch them');
end $$;

-- 4) functions: nobody but service_role, and service_role only on the business functions (trigger functions need no EXECUTE)
do $$
declare
  p record; bad int := 0;
  business text[] := array['tax_opt_record_decision', 'tax_opt_effective_status', 'tax_opt_verify_chain'];
  trigger_fns text[] := array['fn_finance_block_mutation', 'fn_finance_audit', 'fn_finance_expense_guard', 'fn_acct_journal_balanced', 'fn_acct_journal_has_lines',
                              'fn_acct_period_open', 'fn_acct_line_postable', 'fn_acct_bank_rec_guard'];
begin
  for p in select oid, proname::text as name from pg_proc where pronamespace = 'public'::regnamespace and proname ~ '^(fn_finance_|fn_acct_|fn_tax_opt_|tax_opt_)' loop
    if has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('tp_nobody', p.oid, 'EXECUTE') then bad := bad + 1; raise notice 'anon/authenticated/PUBLIC can EXECUTE %', p.name; end if;
    if p.name = any (business) and not has_function_privilege('service_role', p.oid, 'EXECUTE') then bad := bad + 1; raise notice 'service_role cannot EXECUTE %', p.name; end if;
    if p.name = any (trigger_fns) and has_function_privilege('service_role', p.oid, 'EXECUTE') then bad := bad + 1; raise notice 'service_role can EXECUTE trigger function %', p.name; end if;
  end loop;
  perform tp.ok(bad = 0, 'functions: closed to anon, authenticated and PUBLIC; service_role keeps only the 3 business functions among the 100000/120000 set');
end $$;
select tp.ok(tp.denied('authenticated', 'select public.tax_opt_verify_chain(''X'')') and tp.denied('anon', 'select public.tax_opt_effective_status(''a'', ''b'', ''c'')'),
             'authenticated and anon are refused (42501) when they call an approval function directly');

-- 5) the legitimate flows still work with the minimum privileges, and every trigger (including the ones whose EXECUTE was removed) still fires
insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', null) on conflict do nothing;
create temp table tp_audit0 as select count(*)::int as n from public.finance_audit_logs where entity_type like 'finance\_%';
grant select on tp_audit0 to public;
set role service_role;
insert into public.finance_ledger_entries (idempotency_key, entry_type, direction, amount_minor, currency, effective_at, provider, provider_ref)
  values ('tp-ledger-1', 'PAYMENT_VERIFIED', 'IN', 150000, 'IDR', now(), 'midtrans', 'tp-ref-1');
insert into public.finance_refunds (provider, provider_refund_id, provider_payment_id, amount_minor, currency, status) values ('midtrans', 'tp-rf-1', 'tp-pay-1', 1000, 'IDR', 'REQUESTED');
update public.finance_refunds set status = 'APPROVED' where provider_refund_id = 'tp-rf-1';
update public.finance_refunds set status = 'PROCESSED', processed_at = now() where provider_refund_id = 'tp-rf-1';
insert into public.finance_settlements (provider, provider_settlement_id, settled_at, gross_minor, fee_minor, net_minor, currency) values ('midtrans', 'tp-st-1', now(), 1000, 10, 990, 'IDR');
insert into public.finance_operating_expenses (id, expense_date, category, amount_minor, currency) values ('bbbbbbbb-0000-4000-8000-000000000001', '2026-10-01', 'hosting', 5000, 'IDR');
update public.finance_operating_expenses set is_void = true, voided_at = now() where id = 'bbbbbbbb-0000-4000-8000-000000000001';
insert into public.finance_tax_settings (effective_from) values ('2026-10-01');
insert into public.finance_platform_admins (user_id, role) values ('33333333-3333-4333-8333-333333333333', 'SUPER_ADMIN');
insert into public.acct_accounts (code, name, account_type) values ('1101', 'Kas uji', 'ASSET'), ('4101', 'Pendapatan uji', 'REVENUE');
begin;
  insert into public.acct_journals (id, source_key, entry_date, description, reference, journal_type, posted_by)
    values ('cccccccc-0000-4000-8000-000000000001', 'tp-j-1', '2026-10-01', 'uji', 'TP-1', 'NORMAL', '33333333-3333-4333-8333-333333333333');
  insert into public.acct_journal_lines (journal_id, line_no, account_code, debit_minor, credit_minor) values
    ('cccccccc-0000-4000-8000-000000000001', 1, '1101', 1000, 0), ('cccccccc-0000-4000-8000-000000000001', 2, '4101', 0, 1000);
commit;
insert into public.acct_period_events (period_key, action, actor_id) values ('2026-09', 'CLOSE', '33333333-3333-4333-8333-333333333333');
select tp.ok((select count(*) from public.acct_journal_lines) = 2, 'service_role posts a balanced journal with minimum privileges (balance and period triggers fire without EXECUTE)');
select tp.ok((select count(*) from public.finance_ledger_entries where idempotency_key = 'tp-ledger-1') = 1, 'service_role records a verified payment with minimum privileges');
select tp.ok((select status from public.finance_refunds where provider_refund_id = 'tp-rf-1') = 'PROCESSED', 'service_role moves a refund REQUESTED -> APPROVED -> PROCESSED');
select tp.ok((select is_void from public.finance_operating_expenses where id = 'bbbbbbbb-0000-4000-8000-000000000001'), 'service_role can void an expense');
reset role;
select tp.ok((select count(*) from public.finance_audit_logs where entity_type like 'finance\_%') - (select n from tp_audit0) = 9,
             'the audit trigger fired for all 9 finance changes above (ledger 1, refund 3, settlement 1, expense 2, tax settings 1, admin 1) with EXECUTE removed from service_role');
select tp.ok((select count(*) from public.finance_audit_logs where entity_type like 'acct\_%') = 6,
             'the audit trigger also fired for the 6 accounting changes (2 accounts, journal, 2 lines, period event)');

-- 6) defence in depth: even a role that HAS the privilege (the owner) is stopped by the append-only guards
select tp.ok(tp.blocked('update public.finance_ledger_entries set amount_minor = 1', '%append-only%')
         and tp.blocked('delete from public.finance_ledger_entries', '%append-only%')
         and tp.blocked('truncate public.finance_ledger_entries', '%append-only%'), 'the ledger is append-only for the owner too');
select tp.ok(tp.blocked('update public.finance_audit_logs set action = ''x''', '%append-only%')
         and tp.blocked('delete from public.finance_audit_logs', '%append-only%')
         and tp.blocked('truncate public.finance_audit_logs', '%append-only%'), 'the audit log is append-only for the owner too');
select tp.ok(tp.blocked('update public.finance_tax_settings set pkp_status = ''PKP''', '%append-only%')
         and tp.blocked('delete from public.finance_tax_settings', '%append-only%'), 'tax settings are append-only for the owner too');
select tp.ok(tp.blocked('delete from public.finance_operating_expenses', '%never deleted%')
         and tp.blocked('update public.finance_operating_expenses set amount_minor = 1', '%only voiding%'), 'expenses can only be voided, never deleted or edited');
select tp.ok(tp.blocked('update public.acct_journals set description = ''x''', '%append-only%')
         and tp.blocked('delete from public.acct_period_events', '%append-only%'), 'journals and period events are append-only for the owner too');
