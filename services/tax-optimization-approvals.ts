import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { DecisionStore, RpcArgs, StoreResult } from "@/lib/tax-opt/decision";

/**
 * Storage for Founder decisions. The ONLY write path is the SECURITY DEFINER function
 * tax_opt_record_decision (migration 20261027130000); the table has no INSERT/UPDATE/DELETE grant.
 * Any error, missing key or missing table is reported as UNAVAILABLE: nothing is saved (fail closed).
 */
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

export function mapRpcError(err: { code?: string; message?: string }): StoreResult {
  const code = err.code ?? "";
  const msg = err.message ?? "";
  if (code === "42501") return { ok: false, code: "FORBIDDEN" };
  if (code === "TO409" || msg.includes("TO409")) return { ok: false, code: "CONFLICT" };
  if (code === "TO412" || msg.includes("TO412")) return { ok: false, code: "STALE" };
  if (code === "22023" || code === "23514" || code === "22P02") return { ok: false, code: "INVALID" };
  return { ok: false, code: "UNAVAILABLE" };
}

export function createDecisionStore(): DecisionStore {
  return {
    async record(args: RpcArgs): Promise<StoreResult> {
      try {
        const admin = createAdminClient();
        if (!admin) return { ok: false, code: "UNAVAILABLE" };
        const { data, error } = await (admin as unknown as { rpc: Rpc }).rpc("tax_opt_record_decision", { ...args });
        if (error) return mapRpcError(error);
        const id = typeof data === "string" ? data : null;
        return id ? { ok: true, id } : { ok: false, code: "UNAVAILABLE" };
      } catch {
        return { ok: false, code: "UNAVAILABLE" };
      }
    },
  };
}
