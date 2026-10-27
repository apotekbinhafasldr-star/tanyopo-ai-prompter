/**
 * Platform finance admin access rules (pure, no I/O).
 *
 * Finance data is PLATFORM data: it spans every tenant's payments. A tenant
 * `owner` is therefore NOT enough. Access requires an explicit, active row in
 * `finance_platform_admins`, which is only writable through a reviewed
 * migration or the service role. Everything here fails closed: a missing,
 * revoked, inactive or unknown record means no access.
 */

export type FinanceAdminRole = "FINANCE_ADMIN" | "FINANCE_VIEWER";

export type FinanceAction =
  | "VIEW_DASHBOARD"
  | "EXPORT_CSV"
  | "RECORD_EXPENSE"
  | "VOID_EXPENSE"
  | "MANAGE_TAX_SETTINGS"
  | "RECORD_REFUND"
  | "IMPORT_SETTLEMENT";

export interface PlatformAdminRecord {
  readonly userId: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly revokedAt: string | null;
}

export class FinanceAccessError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_CONFIGURED";
  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_CONFIGURED", message: string) {
    super(message);
    this.name = "FinanceAccessError";
    this.code = code;
  }
}

const PERMISSIONS: Record<FinanceAdminRole, ReadonlySet<FinanceAction>> = {
  FINANCE_ADMIN: new Set<FinanceAction>([
    "VIEW_DASHBOARD",
    "EXPORT_CSV",
    "RECORD_EXPENSE",
    "VOID_EXPENSE",
    "MANAGE_TAX_SETTINGS",
    "RECORD_REFUND",
    "IMPORT_SETTLEMENT",
  ]),
  FINANCE_VIEWER: new Set<FinanceAction>(["VIEW_DASHBOARD", "EXPORT_CSV"]),
};

function isKnownRole(role: string): role is FinanceAdminRole {
  return role === "FINANCE_ADMIN" || role === "FINANCE_VIEWER";
}

export function roleCan(role: string, action: FinanceAction): boolean {
  return isKnownRole(role) && PERMISSIONS[role].has(action);
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
  if (!userId) {
    throw new FinanceAccessError("UNAUTHENTICATED", "Sign-in required");
  }
  if (!record || record.userId !== userId || !record.isActive || record.revokedAt) {
    throw new FinanceAccessError("FORBIDDEN", "Not a platform finance admin");
  }
  if (!isKnownRole(record.role) || !roleCan(record.role, action)) {
    throw new FinanceAccessError("FORBIDDEN", "Role is not allowed to perform this action");
  }
  return { userId, role: record.role };
}
