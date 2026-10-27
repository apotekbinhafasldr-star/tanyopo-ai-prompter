import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Writes one row to finance_audit_logs (immutable, PR #61). Returns false instead of throwing,
 * so the caller decides: real-data exports FAIL CLOSED when this returns false; DEMO exports
 * carry no real data, so they proceed and say so.
 */
type AuditClient = {
  from: (table: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> };
};

export async function recordAdminAudit(entry: {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const admin = createAdminClient();
    if (!admin) return false;
    const { error } = await (admin as unknown as AuditClient).from("finance_audit_logs").insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      details: entry.details ?? {},
    });
    return !error;
  } catch {
    return false;
  }
}
