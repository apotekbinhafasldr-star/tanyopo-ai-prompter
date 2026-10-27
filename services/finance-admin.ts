import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  FINANCE_ACTION_PERMISSION,
  FinanceAccessError,
  type FinanceAction,
  type FinanceAdminRole,
} from "@/lib/finance/admin-access";
import { AdminAccessError } from "@/lib/admin/permissions";
import { requireAdminPermission } from "@/services/platform-admin";

/**
 * Server-side gate for every platform finance operation. Identity and the
 * admin-row lookup live in services/platform-admin.ts; this maps a finance
 * action to the permission it needs. The service-role client is handed to the
 * callback only after the gate has passed, and is never returned or serialised.
 */

export interface FinanceAdminContext {
  readonly userId: string;
  readonly role: FinanceAdminRole;
}

export async function requireFinanceAdmin(action: FinanceAction): Promise<FinanceAdminContext> {
  try {
    const principal = await requireAdminPermission(FINANCE_ACTION_PERMISSION[action]);
    return { userId: principal.userId, role: principal.role };
  } catch (e) {
    if (e instanceof AdminAccessError) throw new FinanceAccessError(e.code, e.message);
    throw e;
  }
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
