-- Rollback for 20261027120000_linoe_accounting_ledger.sql
-- FAIL-CLOSED: accounting records are never dropped while they hold data.
set local lock_timeout = '3s';

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'acct_journals', 'acct_journal_lines', 'acct_period_events', 'acct_bank_statement_lines', 'acct_bank_matches',
    'acct_bank_reconciliations', 'acct_open_items', 'acct_open_item_payments', 'acct_corporate_tax_settings',
    'acct_fiscal_adjustments', 'acct_other_activities', 'acct_tax_payments'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'rollback refused: public.% holds % rows; export and review them first', t, n;
      end if;
    end if;
  end loop;
end
$$;

drop table if exists public.acct_open_item_payments;
drop table if exists public.acct_open_items;
drop table if exists public.acct_bank_matches;
drop table if exists public.acct_bank_reconciliations;
drop table if exists public.acct_bank_statement_lines;
drop table if exists public.acct_journal_lines;
drop table if exists public.acct_journals;
drop table if exists public.acct_period_events;
drop table if exists public.acct_fiscal_adjustments;
drop table if exists public.acct_other_activities;
drop table if exists public.acct_corporate_tax_settings;
drop table if exists public.acct_tax_payments;
drop table if exists public.acct_accounts;
drop function if exists public.fn_acct_bank_rec_guard();
drop function if exists public.fn_acct_line_postable();
drop function if exists public.fn_acct_period_open();
drop function if exists public.fn_acct_journal_has_lines();
drop function if exists public.fn_acct_journal_balanced();
