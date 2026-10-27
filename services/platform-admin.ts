import "server-only";

import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  AdminAccessError,
  authorizePermission,
  type AdminPrincipal,
  type Permission,
  type PlatformAdminRecord,
} from "@/lib/admin/permissions";
import { isAdminCenterEnabled } from "@/lib/admin/flag";

/**
 * Server-side identity + authorisation for every internal (platform) admin
 * surface: the Admin Center pages and the finance services.
 *
 * - Identity comes from the signed-in session (`auth.getUser()`), never from a
 *   request parameter, a cookie we set, or an email address.
 * - Authority comes from an active `finance_platform_admins` row (PR #61), NOT
 *   from the tenant `owner` role.
 * - The service-role client is used only here, to read that one row. It is
 *   never returned, serialised or passed to a Client Component.
 * - Everything fails closed: no key, no table, lookup error, no row => no access.
 */

// The admin tables are not in the generated Database types yet, so the client
// used for them is deliberately untyped.
type UntypedClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export async function requireAdminPermission(permission: Permission): Promise<AdminPrincipal> {
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user) {
    throw new AdminAccessError("UNAUTHENTICATED", "Sign-in required");
  }

  const admin = createAdminClient();
  if (!admin) {
    throw new AdminAccessError("NOT_CONFIGURED", "Admin center is not configured");
  }

  const { data, error } = await (admin as unknown as UntypedClient)
    .from("finance_platform_admins")
    .select("user_id, role, is_active, revoked_at, permissions")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Fail closed: a lookup error (including "table does not exist" before the
    // migration is applied) is never treated as access.
    throw new AdminAccessError("FORBIDDEN", "Could not verify admin access");
  }

  const record: PlatformAdminRecord | null = data
    ? {
        userId: String(data.user_id),
        role: String(data.role),
        isActive: data.is_active === true,
        revokedAt: typeof data.revoked_at === "string" ? data.revoked_at : null,
        permissions: Array.isArray(data.permissions) ? data.permissions.map(String) : [],
      }
    : null;

  return authorizePermission(user.id, record, permission);
}

/**
 * Gate for Admin Center pages. A customer, a signed-out visitor, an unprivileged
 * employee and a misconfigured environment all get the same 404, so the
 * existence of the Admin Center is not revealed. (proxy.ts already redirects
 * signed-out visitors to /login before this runs.)
 */
export async function requireAdminPage(permission: Permission): Promise<AdminPrincipal> {
  if (!isAdminCenterEnabled()) notFound();
  try {
    return await requireAdminPermission(permission);
  } catch {
    notFound();
  }
}

/**
 * Whether to show the "Admin Perusahaan" button. Never throws, and does no
 * database work at all while the Admin Center is switched off. This is a
 * visibility hint only: every page re-checks on the server.
 */
export async function canSeeAdminCenterLink(): Promise<boolean> {
  if (!isAdminCenterEnabled()) return false;
  try {
    await requireAdminPermission("admin.overview");
    return true;
  } catch {
    return false;
  }
}
