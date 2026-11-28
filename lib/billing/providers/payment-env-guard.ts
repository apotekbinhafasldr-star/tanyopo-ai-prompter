/**
 * D3 — two-way payment environment ↔ database guard (pure, no I/O, no logging, nothing secret in any result).
 *
 * Reuses the identity rules of the DOKU sandbox guard (doku-sandbox-db-guard.ts) and adds the mirror image for live:
 *   - sandbox mode: the database must be a non-production project that is explicitly allow-listed (all DOKU rules).
 *   - live mode: the database must BE a known production project and must NOT appear in the sandbox allow-list.
 * Either way a legacy JWT service key must carry the same project ref as the URL. Anything unprovable is a refusal.
 *
 * Limit (not hidden): this proves WHICH project the server is connected to, not that its content is a throw-away copy.
 */

import {
  PRODUCTION_SUPABASE_REFS,
  evaluateSandboxDbGuard,
  projectRefFromSupabaseUrl,
  refClaimOfJwt,
} from "@/lib/billing/providers/doku-sandbox-db-guard";
import type { PaymentEnv } from "@/lib/billing/payment-env-stamp";

export type PaymentEnvGuardReason =
  | "DB_IDENTITY_UNPROVABLE"
  | "DB_IS_PRODUCTION"
  | "DB_NOT_ALLOWLISTED"
  | "ALLOWLIST_HAS_PRODUCTION"
  | "KEY_PROJECT_MISMATCH"
  | "LIVE_DB_NOT_PRODUCTION"
  | "LIVE_REF_IN_SANDBOX_LIST"
  | "MODE_UNKNOWN";

export type PaymentEnvGuardResult = { ok: true; env: PaymentEnv; ref: string } | { ok: false; reason: PaymentEnvGuardReason };

const SANDBOX_REASONS: readonly PaymentEnvGuardReason[] = [
  "DB_IDENTITY_UNPROVABLE",
  "DB_IS_PRODUCTION",
  "DB_NOT_ALLOWLISTED",
  "ALLOWLIST_HAS_PRODUCTION",
  "KEY_PROJECT_MISMATCH",
];

export function evaluatePaymentEnvironment(input: {
  mode: string;
  supabaseUrl: string | undefined;
  sandboxRefs: string | undefined;
  serviceKey?: string | undefined;
}): PaymentEnvGuardResult {
  if (input.mode === "sandbox") {
    const result = evaluateSandboxDbGuard({
      supabaseUrl: input.supabaseUrl,
      allowedRefs: input.sandboxRefs,
      serviceKey: input.serviceKey,
    });
    if (result.ok) return { ok: true, env: "sandbox", ref: result.ref };
    // Only the closed set is ever returned; an unexpected string fails closed as "identity unprovable".
    const reason = SANDBOX_REASONS.find((r) => r === result.reason) ?? "DB_IDENTITY_UNPROVABLE";
    return { ok: false, reason };
  }

  if (input.mode === "live") {
    const ref = projectRefFromSupabaseUrl(input.supabaseUrl);
    if (!ref) return { ok: false, reason: "DB_IDENTITY_UNPROVABLE" };
    if (!PRODUCTION_SUPABASE_REFS.includes(ref)) return { ok: false, reason: "LIVE_DB_NOT_PRODUCTION" };
    const sandboxList = (input.sandboxRefs ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
    if (sandboxList.includes(ref)) return { ok: false, reason: "LIVE_REF_IN_SANDBOX_LIST" };
    const claim = refClaimOfJwt(input.serviceKey);
    if (claim !== "NOT_JWT" && claim !== ref) return { ok: false, reason: "KEY_PROJECT_MISMATCH" };
    return { ok: true, env: "live", ref };
  }

  return { ok: false, reason: "MODE_UNKNOWN" };
}
