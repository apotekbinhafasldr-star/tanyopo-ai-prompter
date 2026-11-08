import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProvider } from "@/lib/billing/payment-provider";
import { canVerifyServerSide, verifyAndSettle } from "@/services/payment-verification";
import type { Database } from "@/types/database";

/** C2 — a PENDING invoice younger than this is left to the webhook / the payer's own return trip. */
export const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;
/** Hard ceiling of transactions examined per run (each one is one gateway Get Status call). */
export const SWEEP_MAX_PER_RUN = 25;
/** Stop starting new gateway calls after this long, so a run always ends inside a serverless time limit. */
export const SWEEP_TIME_BUDGET_MS = 20_000;

export type SweepResult =
  | { status: "not_configured" }
  | { status: "error"; code: "LIST_FAILED" }
  | {
      status: "ok";
      examined: number;
      applied: number;
      closed: number;
      still_pending: number;
      needs_attention: number;
      stopped_early: boolean;
    };

/**
 * C2 — scheduled sweeper for PENDING Midtrans transactions whose webhook was lost or whose payer never came back.
 * It creates nothing and decides nothing itself: for each candidate it calls the EXISTING verifyAndSettle(), which asks
 * the gateway directly and activates/closes only from that answer (idempotent per transaction in the database, so a
 * run overlapping a webhook or another run cannot double-apply). Fail-closed: an unconfigured or non-verifiable
 * provider returns "not_configured" without touching the database.
 */
export async function sweepPendingPayments(
  admin: SupabaseClient<Database>,
  provider: PaymentProvider,
  options: { now?: () => number; limit?: number; minAgeMs?: number } = {},
): Promise<SweepResult> {
  if (!provider.isConfigured() || !canVerifyServerSide(provider)) {
    return { status: "not_configured" };
  }

  const now = options.now ?? Date.now;
  const limit = Math.max(1, Math.min(SWEEP_MAX_PER_RUN, Math.trunc(options.limit ?? SWEEP_MAX_PER_RUN)));
  const minAgeMs = Math.max(SWEEP_MIN_AGE_MS, options.minAgeMs ?? SWEEP_MIN_AGE_MS);
  const startedAt = now();
  const cutoff = new Date(startedAt - minAgeMs).toISOString();

  const { data, error } = await admin
    .from("prompter_payment_transactions")
    .select("id")
    .eq("provider", provider.name)
    .eq("status", "PENDING")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !data) return { status: "error", code: "LIST_FAILED" };

  const result = { examined: 0, applied: 0, closed: 0, still_pending: 0, needs_attention: 0, stopped_early: false };
  for (const row of data) {
    if (now() - startedAt >= SWEEP_TIME_BUDGET_MS) {
      result.stopped_early = true;
      break;
    }
    result.examined += 1;
    const outcome = await verifyAndSettle(admin, provider, row.id, { eventId: null });
    switch (outcome.kind) {
      case "APPLIED":
        result.applied += 1;
        break;
      case "NOT_PAID":
        if (outcome.closed) result.closed += 1;
        else result.still_pending += 1;
        break;
      case "UNVERIFIABLE":
        result.still_pending += 1;
        break;
      default:
        // NEEDS_REVIEW, ALARM, NOT_APPLIED, RPC_ERROR, NOT_FOUND, WRONG_PROVIDER: a human looks at these in /ops/payments.
        result.needs_attention += 1;
    }
  }
  return { status: "ok", ...result };
}
