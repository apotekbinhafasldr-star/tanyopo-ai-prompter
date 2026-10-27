-- Rollback for 20261027130000_linoe_tax_optimization_approvals.sql
-- FAIL-CLOSED: decisions are an audit record. Refuses if any decision exists (nothing is ever deleted silently).
set local lock_timeout = '3s';

do $$
begin
  if to_regclass('public.tax_opt_decisions') is not null and exists (select 1 from public.tax_opt_decisions) then
    raise exception 'rollback refused: public.tax_opt_decisions holds recorded decisions; export and archive them first';
  end if;
end
$$;

drop trigger if exists trg_finance_admins_no_escalation on public.finance_platform_admins;
drop function if exists public.fn_finance_admins_no_escalation();

drop function if exists public.tax_opt_verify_chain(text);
drop function if exists public.tax_opt_effective_status(text, text, text);
drop function if exists public.tax_opt_record_decision(uuid, uuid, text, text, text, text, text, text, text, text, text, text[], integer, text[], text, integer);

drop table if exists public.tax_opt_decisions;
drop function if exists public.fn_tax_opt_decision_guard();
drop function if exists public.fn_tax_opt_refs_ok(text[]);
