-- Rollback for 20261027110000_linoe_admin_center_access.sql
-- FAIL-CLOSED: refuses if any admin row uses a role or permission this rollback would make invalid.
set local lock_timeout = '3s';

do $$
begin
  if to_regclass('public.finance_platform_admins') is null then
    return;
  end if;
  if exists (select 1 from public.finance_platform_admins where role in ('SUPER_ADMIN', 'STAFF') or cardinality(permissions) > 0) then
    raise exception 'rollback refused: finance_platform_admins holds SUPER_ADMIN/STAFF rows or permissions; revoke them first';
  end if;
end
$$;

drop trigger if exists trg_finance_admins_keep_super_admin on public.finance_platform_admins;
drop function if exists public.fn_finance_admins_keep_super_admin();
alter table public.finance_platform_admins drop constraint if exists finance_platform_admins_permissions_check;
alter table public.finance_platform_admins drop constraint if exists finance_platform_admins_role_check;
alter table public.finance_platform_admins
  add constraint finance_platform_admins_role_check check (role in ('FINANCE_ADMIN', 'FINANCE_VIEWER'));
alter table public.finance_platform_admins drop column if exists permissions;
