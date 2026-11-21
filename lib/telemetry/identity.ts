import { createHmac } from "node:crypto";

/** Value used when an event has no tenant (e.g. an error before a tenant is known). */
export const SYSTEM_TENANT_HASH = "system";

/**
 * Pseudonymous tenant identifier: HMAC-SHA256(tenant_id, salt), first 32 hex
 * chars. The raw tenant id never leaves the server. The salt is LINOE-specific
 * and server-only, so the hash cannot be correlated with other products that
 * share the same Supabase project. Rotating the salt breaks continuity.
 */
export function tenantHash(tenantId: string | null | undefined, salt: string): string {
  if (!tenantId) return SYSTEM_TENANT_HASH;
  return createHmac("sha256", salt).update(tenantId, "utf8").digest("hex").slice(0, 32);
}
