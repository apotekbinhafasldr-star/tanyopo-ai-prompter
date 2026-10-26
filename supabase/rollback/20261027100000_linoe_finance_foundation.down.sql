-- Rollback for 20261027100000_linoe_finance_foundation.sql
-- FAIL-CLOSED: refuses to drop anything if ANY finance table holds rows, because those rows are
-- financial records and the audit log is immutable. Export and archive them first, then decide.
set local lock_timeout = '3s';

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'finance_audit_logs', 'finance_platform_admins', 'finance_ledger_entries', 'finance_refunds',
    'finance_settlements', 'finance_operating_expenses', 'finance_tax_settings'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'rollback refused: public.% holds % row(s)', t, n;
      end if;
    end if;
  end loop;
end
$$;

drop table if exists public.finance_tax_settings;
drop table if exists public.finance_operating_expenses;
drop table if exists public.finance_settlements;
drop table if exists public.finance_refunds;
drop table if exists public.finance_ledger_entries;
drop table if exists public.finance_platform_admins;
drop table if exists public.finance_audit_logs;
drop function if exists public.fn_finance_expense_guard();
drop function if exists public.fn_finance_audit();
drop function if exists public.fn_finance_block_mutation();
