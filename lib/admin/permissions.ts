/**
 * LINOE Admin Center permission model (pure, no I/O).
 *
 * Authority is NEVER derived from an email address or from the tenant `owner`
 * role. It comes only from an active row in `finance_platform_admins` (PR #61),
 * extended here with `permissions`:
 *
 *   SUPER_ADMIN    Founder. Holds every permission, including staff management.
 *   STAFF          Only the permissions explicitly granted to that person.
 *   FINANCE_ADMIN  Legacy PR #61 role, fixed finance permission set.
 *   FINANCE_VIEWER Legacy PR #61 role, read-only finance + tax.
 *
 * Everything fails closed: an unknown role, an unknown permission string, an
 * inactive or revoked record means no access.
 */

export const PERMISSIONS = [
  "admin.overview",
  "finance.view",
  "finance.export",
  "finance.expense.write",
  "finance.settlement.import",
  "tax.view",
  "tax.manage",
  "refund.approve",
  "bank.manage",
  "staff.view",
  "staff.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that move money or change who may: need an explicit grant from a Super Admin. */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  "refund.approve",
  "bank.manage",
  "tax.manage",
  "finance.settlement.import",
  "staff.manage",
];

/** Can be granted to STAFF. `staff.manage` never can: it is Super Admin only. */
export const GRANTABLE_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((p) => p !== "staff.manage");

export type PlatformRole = "SUPER_ADMIN" | "STAFF" | "FINANCE_ADMIN" | "FINANCE_VIEWER";

export const PLATFORM_ROLES: readonly PlatformRole[] = ["SUPER_ADMIN", "STAFF", "FINANCE_ADMIN", "FINANCE_VIEWER"];

const LEGACY_ROLE_PERMISSIONS: Record<"FINANCE_ADMIN" | "FINANCE_VIEWER", readonly Permission[]> = {
  FINANCE_ADMIN: [
    "admin.overview",
    "finance.view",
    "finance.export",
    "finance.expense.write",
    "finance.settlement.import",
    "tax.view",
    "tax.manage",
    "refund.approve",
  ],
  FINANCE_VIEWER: ["admin.overview", "finance.view", "finance.export", "tax.view"],
};

export interface PlatformAdminRecord {
  readonly userId: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly revokedAt: string | null;
  /** Granted permissions (STAFF only). Unknown strings are ignored, never trusted. */
  readonly permissions?: readonly string[];
}

export interface AdminPrincipal {
  readonly userId: string;
  readonly role: PlatformRole;
  readonly permissions: ReadonlySet<Permission>;
}

export class AdminAccessError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_CONFIGURED";
  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_CONFIGURED", message: string) {
    super(message);
    this.name = "AdminAccessError";
    this.code = code;
  }
}

const KNOWN = new Set<string>(PERMISSIONS);
const GRANTABLE = new Set<string>(GRANTABLE_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return KNOWN.has(value);
}

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

/** Permissions a record effectively holds. Empty for anything not clearly valid. */
export function permissionsOf(record: Pick<PlatformAdminRecord, "role" | "permissions">): ReadonlySet<Permission> {
  switch (record.role) {
    case "SUPER_ADMIN":
      return new Set<Permission>(PERMISSIONS);
    case "FINANCE_ADMIN":
    case "FINANCE_VIEWER":
      return new Set<Permission>(LEGACY_ROLE_PERMISSIONS[record.role]);
    case "STAFF": {
      // Only grantable, known strings count; "staff.manage" in a STAFF row is ignored.
      const granted = (record.permissions ?? []).filter((p) => GRANTABLE.has(p)) as Permission[];
      return new Set<Permission>(granted.length > 0 ? [...granted, "admin.overview"] : []);
    }
    default:
      return new Set<Permission>();
  }
}

/** Builds the principal for a signed-in user, or throws. `userId` must come from the session. */
export function authorizePermission(
  userId: string | null | undefined,
  record: PlatformAdminRecord | null | undefined,
  permission: Permission,
): AdminPrincipal {
  if (!userId) {
    throw new AdminAccessError("UNAUTHENTICATED", "Sign-in required");
  }
  if (!record || record.userId !== userId || !record.isActive || record.revokedAt) {
    throw new AdminAccessError("FORBIDDEN", "Not a platform admin");
  }
  if (!isPlatformRole(record.role)) {
    throw new AdminAccessError("FORBIDDEN", "Unknown admin role");
  }
  const permissions = permissionsOf(record);
  if (!permissions.has(permission)) {
    throw new AdminAccessError("FORBIDDEN", "Not allowed to perform this action");
  }
  return { userId, role: record.role, permissions };
}

export function can(principal: AdminPrincipal | null | undefined, permission: Permission): boolean {
  return Boolean(principal && principal.permissions.has(permission));
}

// ---------------------------------------------------------------------------
// Staff access changes. Phase B ships the RULES and the read-only screen; the
// write path is enabled only after the migration is approved and applied.
// ---------------------------------------------------------------------------

export interface StaffTarget {
  readonly userId: string;
  readonly role: PlatformRole;
  readonly isActive: boolean;
}

export interface StaffChange {
  readonly role: PlatformRole;
  readonly permissions: readonly string[];
  readonly isActive: boolean;
}

export type StaffChangeDecision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const deny = (reason: string): StaffChangeDecision => ({ ok: false, reason });

export function evaluateStaffChange(
  actor: AdminPrincipal,
  target: StaffTarget | null,
  change: StaffChange,
  activeSuperAdmins: number,
): StaffChangeDecision {
  if (!actor.permissions.has("staff.manage")) {
    return deny("Hanya Super Admin yang dapat mengatur akses staf");
  }
  if (target && target.userId === actor.userId) {
    return deny("Tidak dapat mengubah akses diri sendiri");
  }
  if (target && target.role === "SUPER_ADMIN") {
    return deny("Akun Super Admin tidak dapat diubah dari aplikasi");
  }
  if (change.role === "SUPER_ADMIN") {
    return deny("Super Admin baru hanya dapat dibuat lewat proses terkontrol yang disetujui Founder");
  }
  if (change.role !== "STAFF") {
    return deny("Peran baru harus STAFF");
  }
  for (const p of change.permissions) {
    if (!isPermission(p)) return deny(`Izin tidak dikenal: ${p}`);
    if (!GRANTABLE.has(p)) return deny(`Izin tidak dapat diberikan kepada staf: ${p}`);
  }
  if (activeSuperAdmins < 1) {
    return deny("Harus ada minimal satu Super Admin aktif");
  }
  return { ok: true };
}
