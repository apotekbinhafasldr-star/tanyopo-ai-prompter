-- Integration checks across ALL four finance migrations, applied in order, on a throw-away database with SYNTHETIC data.
create schema if not exists tc;
create or replace function tc.ok(cond boolean, name text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', name; end if; raise notice 'PASS: %', name; end $$;
create or replace function tc.fails(stmt text, name text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'PASS: % (%)', name, sqlstate; return; end;
  raise exception 'FAILED (statement succeeded): %', name;
end $$;
grant usage on schema tc to public;
grant execute on all functions in schema tc to public;

-- synthetic accounts and users
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', null), ('22222222-2222-4222-8222-222222222222', null);
insert into public.acct_accounts (code, name, account_type) values ('1101', 'Kas uji', 'ASSET'), ('4101', 'Pendapatan uji', 'REVENUE'), ('6101', 'Beban uji', 'EXPENSE');

-- journal integrity (as the server role)
set role service_role;
begin;
  insert into public.acct_journals (id, source_key, entry_date, description, reference, journal_type, posted_by)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'uji-1', '2026-10-01', 'uji', 'REF-1', 'NORMAL', '11111111-1111-4111-8111-111111111111');
  insert into public.acct_journal_lines (journal_id, line_no, account_code, debit_minor, credit_minor) values
    ('aaaaaaaa-0000-4000-8000-000000000001', 1, '1101', 100000, 0), ('aaaaaaaa-0000-4000-8000-000000000001', 2, '4101', 0, 100000);
commit;
select tc.ok((select count(*) from public.acct_journals) = 1, 'a balanced journal is accepted');

select tc.fails($$ begin;
  insert into public.acct_journals (id, source_key, entry_date, description, reference, journal_type, posted_by) values ('aaaaaaaa-0000-4000-8000-000000000002','uji-2','2026-10-02','x','R2','NORMAL','11111111-1111-4111-8111-111111111111');
  insert into public.acct_journal_lines (journal_id, line_no, account_code, debit_minor, credit_minor) values ('aaaaaaaa-0000-4000-8000-000000000002',1,'1101',500,0),('aaaaaaaa-0000-4000-8000-000000000002',2,'4101',0,400);
  commit; $$, 'an unbalanced journal is rejected');
rollback;
select tc.fails($$ begin;
  insert into public.acct_journals (id, source_key, entry_date, description, reference, journal_type, posted_by) values ('aaaaaaaa-0000-4000-8000-000000000003','uji-3','2026-10-02','x','R3','NORMAL','11111111-1111-4111-8111-111111111111');
  commit; $$, 'a journal without lines is rejected');
rollback;
select tc.fails($$ begin;
  insert into public.acct_journals (id, source_key, entry_date, description, reference, journal_type, posted_by) values ('aaaaaaaa-0000-4000-8000-000000000004','uji-1','2026-10-03','dup','R4','NORMAL','11111111-1111-4111-8111-111111111111');
  insert into public.acct_journal_lines (journal_id, line_no, account_code, debit_minor, credit_minor) values ('aaaaaaaa-0000-4000-8000-000000000004',1,'1101',5,0),('aaaaaaaa-0000-4000-8000-000000000004',2,'4101',0,5);
  commit; $$, 'the same source_key cannot be recorded twice');
rollback;
select tc.fails($$ update public.acct_journals set description = 'diubah' $$, 'journals cannot be updated');
select tc.fails($$ delete from public.acct_journals $$, 'journals cannot be deleted');
select tc.fails($$ update public.acct_journal_lines set debit_minor = 1 $$, 'journal lines cannot be updated');
select tc.fails($$ delete from public.acct_journal_lines $$, 'journal lines cannot be deleted');
select tc.fails($$ truncate public.acct_journals cascade $$, 'journals cannot be truncated');

-- closed period blocks posting; reopening needs a reason and is itself an event
insert into public.acct_period_events (period_key, action, actor_id) values ('2026-09', 'CLOSE', '11111111-1111-4111-8111-111111111111');
select tc.fails($$ begin;
  insert into public.acct_journals (id, source_key, entry_date, description, reference, journal_type, posted_by) values ('aaaaaaaa-0000-4000-8000-000000000005','uji-5','2026-09-15','x','R5','NORMAL','11111111-1111-4111-8111-111111111111');
  insert into public.acct_journal_lines (journal_id, line_no, account_code, debit_minor, credit_minor) values ('aaaaaaaa-0000-4000-8000-000000000005',1,'1101',5,0),('aaaaaaaa-0000-4000-8000-000000000005',2,'4101',0,5);
  commit; $$, 'posting into a closed period is rejected');
rollback;
select tc.fails($$ insert into public.acct_period_events (period_key, action, actor_id) values ('2026-09','REOPEN','11111111-1111-4111-8111-111111111111') $$, 'reopening a period without a reason is rejected');
select tc.fails($$ update public.acct_period_events set reason = 'x' $$, 'period events cannot be updated');

-- reversal: a correction is a new journal, at most once
begin;
  insert into public.acct_journals (id, source_key, entry_date, description, reference, journal_type, reverses_id, posted_by)
    values ('aaaaaaaa-0000-4000-8000-000000000006', 'uji-rev', '2026-10-05', 'balik', 'REV-1', 'REVERSAL', 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111');
  insert into public.acct_journal_lines (journal_id, line_no, account_code, debit_minor, credit_minor) values
    ('aaaaaaaa-0000-4000-8000-000000000006', 1, '4101', 100000, 0), ('aaaaaaaa-0000-4000-8000-000000000006', 2, '1101', 0, 100000);
commit;
select tc.ok((select sum(debit_minor) - sum(credit_minor) from public.acct_journal_lines) = 0, 'ledger debits equal credits after posting and reversal');
select tc.fails($$ begin;
  insert into public.acct_journals (id, source_key, entry_date, description, reference, journal_type, reverses_id, posted_by) values ('aaaaaaaa-0000-4000-8000-000000000007','uji-rev2','2026-10-06','balik lagi','REV-2','REVERSAL','aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111');
  insert into public.acct_journal_lines (journal_id, line_no, account_code, debit_minor, credit_minor) values ('aaaaaaaa-0000-4000-8000-000000000007',1,'4101',5,0),('aaaaaaaa-0000-4000-8000-000000000007',2,'1101',0,5);
  commit; $$, 'a journal can be reversed at most once');
rollback;

-- OPENING needs evidence; no money in floating point
select tc.fails($$ insert into public.acct_journals (source_key, entry_date, description, reference, journal_type, posted_by) values ('uji-open','2026-10-01','saldo awal','O-1','OPENING','11111111-1111-4111-8111-111111111111') $$, 'an opening balance without evidence is rejected');
reset role;
select tc.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and (table_name like 'acct\_%' or table_name like 'finance\_%' or table_name like 'tax\_opt\_%') and data_type in ('real', 'double precision', 'numeric')), 'no finance column uses floating point or numeric money');

-- admin / approvals across modules
select tc.fails($$ insert into public.tax_opt_decisions (request_id, subject_key, seq, event_hash, recommendation_type, tax_year, decision, reason, decision_by, rules_version, calc_hash) values (gen_random_uuid(),'SCHEME_SELECTION:2026:PASAL_31E',1,repeat('0',64),'SCHEME_SELECTION','2026','REJECTED','alasan cukup panjang','11111111-1111-4111-8111-111111111111','taxopt-e1;law=x',repeat('a',64)) $$, 'a decision by a non-admin user is rejected');

-- every new table: RLS on, no policies, nothing for anon/authenticated/public
select tc.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and (c.relname like 'acct\_%' or c.relname like 'finance\_%' or c.relname like 'tax\_opt\_%') and not c.relrowsecurity) = 0, 'row level security is enabled on every finance, accounting and tax approval table');
select tc.ok((select count(*) from pg_policies where schemaname = 'public' and (tablename like 'acct\_%' or tablename like 'finance\_%' or tablename like 'tax\_opt\_%')) = 0, 'no RLS policy exists (default deny)');
select tc.ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC') and (table_name like 'acct\_%' or table_name like 'finance\_%' or table_name like 'tax\_opt\_%')), 'anon, authenticated and public hold no table privilege');
select tc.ok(not exists (select 1 from information_schema.role_routine_grants where routine_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC') and (routine_name like 'tax\_opt\_%' or routine_name like 'fn\_acct\_%' or routine_name like 'fn\_finance\_%')), 'no function of the finance chain is executable by anon, authenticated or public');
select tc.ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'service_role' and privilege_type in ('DELETE', 'TRUNCATE') and (table_name like 'acct\_%' or table_name like 'finance\_%' or table_name like 'tax\_opt\_%')), 'service_role holds no DELETE or TRUNCATE on any finance table');

-- audit trail
select tc.ok((select count(*) from public.finance_audit_logs) >= 0, 'audit log table is reachable');
select tc.fails($$ update public.finance_audit_logs set action = 'x' $$, 'the audit log cannot be updated');
select tc.fails($$ delete from public.finance_audit_logs $$, 'the audit log cannot be deleted');
