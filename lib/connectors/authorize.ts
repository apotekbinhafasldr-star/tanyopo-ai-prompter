import type { TenantRole } from "@/types/database";

/**
 * Every write this module's callers make (OAuth callback, disconnect,
 * verify) goes through the service-role client — required for the
 * zero-RLS prompter_oauth_credentials table — which bypasses RLS
 * entirely. That means prompter_connected_accounts' own database policy
 * ("Owner kelola koneksi platform", owner-only writes — see
 * supabase/migrations/20260829102304_prompter_phase3_schema.sql) is not
 * enforced by Postgres for these specific calls. This check is what
 * makes that restriction real again, at the only layer left that can.
 */
export function isAllowedToManageConnections(role: TenantRole): boolean {
  return role === "owner";
}

export const CONNECTION_MANAGEMENT_FORBIDDEN_MESSAGE =
  "Hanya pemilik akun yang dapat mengelola koneksi platform.";
