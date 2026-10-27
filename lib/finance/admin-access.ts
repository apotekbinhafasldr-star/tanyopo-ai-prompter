/**
 * Platform finance admin access rules (pure, no I/O).
 *
 * Finance data is PLATFORM data: it spans every tenant's payments. A tenant
 * `owner` is therefore NOT enough. Access requires an explicit, active row in
 * `finance_platform_admins`, which is only writable through a reviewed
 * migration or the service role. Everything here fails closed: a missing,
 * revoked, inactive or unknown record means no access.
 *
 * Phase B: the role/permission model now lives in lib/admin/permissions.ts
 * (SUPER_ADMIN, STAFF with explicit permissions, and the two PR #61 roles).
 * This file maps each finance action to the permission it needs.
 */

import {
  AdminAccessError,
  authorizePermission,
  permissionsOf,
  type Permission,
  type PlatformAdminRecord,
  type PlatformRole,
} from "@/lib/admin/permissions";

export type FinanceAdminRole = PlatformRole;
export type { PlatformAdminRecord };

export type FinanceAction =
  | "VIEW_DASHBOARD"
  | "EXPORT_CSV"
  | "RECORD_EXPENSE"
  | "VOID_EXPENSE"
  | "MANAGE_TAX_SETTINGS"
  | "RECORD_REFUND"
  | "IMPORT_SETTLEMENT";

export const FINANCE_ACTION_PERMISSION: Record<FinanceAction, Permission> = {
  VIEW_DASHBOARD: "finance.view",
  EXPORT_CSV: "finance.export",
  RECORD_EXPENSE: "finance.expense.write",
  VOID_EXPENSE: "finance.expense.write",
  MANAGE_TAX_SETTINGS: "tax.manage",
  RECORD_REFUND: "refund.approve",
  IMPORT_SETTLEMENT: "finance.settlement.import",
};

export class FinanceAccessError extends AdminAccessError {
  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_CONFIGURED", message: string) {
    super(code, message);
    this.name = "FinanceAccessError";
  }
}

/** Role-only check (no per-person grants). STAFF always needs its record: use authorizeFinanceAction. */
export function roleCan(role: string, action: FinanceAction): boolean {
  return permissionsOf({ role }).has(FINANCE_ACTION_PERMISSION[action]);
}

/**
 * Decides access. `userId` is the authenticated user (null = not signed in).
 * The record must belong to that same user; a record for someone else is
 * never trusted.
 */
export function authorizeFinanceAction(
  userId: string | null | undefined,
  record: PlatformAdminRecord | null | undefined,
  action: FinanceAction,
): { userId: string; role: FinanceAdminRole } {
  try {
    const principal = authorizePermission(userId, record, FINANCE_ACTION_PERMISSION[action]);
    return { userId: principal.userId, role: principal.role };
  } catch (e) {
    if (e instanceof AdminAccessError && !(e instanceof FinanceAccessError)) {
      throw new FinanceAccessError(e.code, e.message);
    }
    throw e;
  }
}
