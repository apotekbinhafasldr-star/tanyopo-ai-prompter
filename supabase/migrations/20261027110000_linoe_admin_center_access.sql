-- LINOE Admin Center access model (Phase B) — NOT APPLIED to any environment.
--
-- DEPENDS ON 20261027100000_linoe_finance_foundation.sql (PR #61): it extends
-- public.finance_platform_admins, which that migration creates. Apply in order.
--
-- Changes (only to the new finance_platform_admins table; no pre-existing object is touched):
--   * roles: adds SUPER_ADMIN (Founder) and STAFF (explicit permissions) next to the two PR #61 roles;
--   * permissions text[]: only known permission names, and 'staff.manage' can never be stored for STAFF;
--   * safety trigger: the last active SUPER_ADMIN can never be deactivated, revoked, demoted or deleted.
--
-- No Super Admin is created here and no email address is hard-coded anywhere. The first Super Admin is
-- seeded by a separate, explicitly approved statement. See docs/ADMIN_CENTER.md.
--
-- Rollback: supabase/rollback/20261027110000_linoe_admin_center_access.down.sql
set local lock_timeout = '3s';

alter table public.finance_platform_admins
  add column if not exists permissions text[] not null default '{}'::text[];

alter table public.finance_platform_admins
  drop constraint if exists finance_platform_admins_role_check;
alter table public.finance_platform_admins
  add constraint finance_platform_admins_role_check
  check (role in ('SUPER_ADMIN', 'STAFF', 'FINANCE_ADMIN', 'FINANCE_VIEWER'));

alter table public.finance_platform_admins
  drop constraint if exists finance_platform_admins_permissions_check;
alter table public.finance_platform_admins
  add constraint finance_platform_admins_permissions_check
  check (
    permissions <@ array[
      'admin.overview', 'finance.view', 'finance.export', 'finance.expense.write',
      'finance.settlement.import', 'tax.view', 'tax.manage', 'tax.export',
      'accounting.view', 'tax.optimization.view', 'bank.manage', 'staff.view'
    ]::text[]
  );

create or replace function public.fn_finance_admins_keep_super_admin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  remaining integer;
begin
  -- Only matters when a currently active SUPER_ADMIN row is being removed or weakened.
  if old.role = 'SUPER_ADMIN' and old.is_active and old.revoked_at is null then
    if tg_op = 'DELETE'
       or new.role <> 'SUPER_ADMIN'
       or not new.is_active
       or new.revoked_at is not null then
      select count(*) into remaining
      from public.finance_platform_admins
      where role = 'SUPER_ADMIN' and is_active and revoked_at is null and user_id <> old.user_id;
      if remaining < 1 then
        raise exception 'the last active SUPER_ADMIN cannot be removed or weakened' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_admins_keep_super_admin on public.finance_platform_admins;
create trigger trg_finance_admins_keep_super_admin
  before update or delete on public.finance_platform_admins
  for each row execute function public.fn_finance_admins_keep_super_admin();

revoke all on function public.fn_finance_admins_keep_super_admin() from public, anon, authenticated;
