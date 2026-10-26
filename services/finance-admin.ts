import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  authorizeFinanceAction,
  FinanceAccessError,
  type FinanceAction,
  type FinanceAdminRole,
  type PlatformAdminRecord,
} from "@/lib/finance/admin-access";

/**
 * Server-side gate for every platform finance operation.
 *
 * - Identity comes from the signed-in session (`auth.getUser()`), never from a
 *   request parameter.
 * - Authorisation comes from an active `finance_platform_admins` row, NOT from
 *   the tenant `owner` role.
 * - The service-role client is used only inside this module after the gate has
 *   passed, and is handed to the callback, never returned or serialised to the
 *   browser. Without SUPABASE_SECRET_KEY the gate fails closed.
 */

export interface FinanceAdminContext {
  readonly userId: string;
  readonly role: FinanceAdminRole;
}

// The finance tables are not in the generated Database types yet, so the
// client used for them is deliberately untyped.
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

export async function requireFinanceAdmin(action: FinanceAction): Promise<FinanceAdminContext> {
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user) {
    throw new FinanceAccessError("UNAUTHENTICATED", "Sign-in required");
  }

  const admin = createAdminClient();
  if (!admin) {
    throw new FinanceAccessError("NOT_CONFIGURED", "Finance admin is not configured");
  }

  const { data, error } = await (admin as unknown as UntypedClient)
    .from("finance_platform_admins")
    .select("user_id, role, is_active, revoked_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Fail closed: a lookup error is never treated as access.
    throw new FinanceAccessError("FORBIDDEN", "Could not verify finance admin access");
  }

  const record: PlatformAdminRecord | null = data
    ? {
        userId: String(data.user_id),
        role: String(data.role),
        isActive: data.is_active === true,
        revokedAt: typeof data.revoked_at === "string" ? data.revoked_at : null,
      }
    : null;

  return authorizeFinanceAction(user.id, record, action);
}

/** Runs `fn` with the service-role client, only after the gate has passed. */
export async function withFinanceAdmin<T>(
  action: FinanceAction,
  fn: (ctx: FinanceAdminContext, client: NonNullable<ReturnType<typeof createAdminClient>>) => Promise<T>,
): Promise<T> {
  const ctx = await requireFinanceAdmin(action);
  const client = createAdminClient();
  if (!client) {
    throw new FinanceAccessError("NOT_CONFIGURED", "Finance admin is not configured");
  }
  return fn(ctx, client);
}
