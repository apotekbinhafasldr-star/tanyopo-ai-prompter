import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyWebhookError } from "@/lib/billing/webhook-markers";
import { SWEEP_MIN_AGE_MS } from "@/services/payment-sweeper";
import type { Database } from "@/types/database";

type Admin = SupabaseClient<Database>;

/** P0-B1 window and ceilings. Read-only: nothing here writes, and nothing returns `payload` or free text. */
export const HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000;
export const HEALTH_MAX_ROWS = 1000;
export const REPEAT_FAILURE_THRESHOLD = 3;
export const RECHECK_LIST_LIMIT = 20;

export type DokuWebhookHealth =
  | {
      ok: true;
      unknown: number;
      verificationFailed: number;
      notPaid: number;
      /** Transactions with >= 3 UNKNOWN / verification-failed deliveries in the window. */
      repeatedTransactions: number;
      oldestAt: string | null;
      /** True when the row ceiling was hit: counts are a lower bound. */
      truncated: boolean;
    }
  | { ok: false };

/** 24h health of the DOKU webhook path, derived from prompter_webhook_events. Never throws. */
export async function getDokuWebhookHealth(admin: Admin, now: number = Date.now()): Promise<DokuWebhookHealth> {
  try {
    const since = new Date(now - HEALTH_WINDOW_MS).toISOString();
    const { data, error } = await admin
      .from("prompter_webhook_events")
      .select("error, received_at, payload")
      .eq("source_system", "doku")
      .gte("received_at", since)
      .not("error", "is", null)
      .order("received_at", { ascending: true })
      .limit(HEALTH_MAX_ROWS);
    if (error || !data) return { ok: false };

    let unknown = 0;
    let verificationFailed = 0;
    let notPaid = 0;
    let oldestAt: string | null = null;
    const perOrder = new Map<string, number>();
    for (const row of data as Array<{ error: string | null; received_at: string; payload: unknown }>) {
      const kind = classifyWebhookError(row.error);
      if (!kind) continue;
      if (kind === "UNKNOWN") unknown += 1;
      else if (kind === "VERIFICATION_FAILED") verificationFailed += 1;
      else notPaid += 1;
      if (oldestAt === null || row.received_at < oldestAt) oldestAt = row.received_at;
      if (kind !== "NOT_PAID") {
        const orderId = (row.payload as { orderId?: unknown } | null)?.orderId;
        if (typeof orderId === "string") perOrder.set(orderId, (perOrder.get(orderId) ?? 0) + 1);
      }
    }
    const repeatedTransactions = [...perOrder.values()].filter((n) => n >= REPEAT_FAILURE_THRESHOLD).length;
    return { ok: true, unknown, verificationFailed, notPaid, repeatedTransactions, oldestAt, truncated: data.length >= HEALTH_MAX_ROWS };
  } catch {
    return { ok: false };
  }
}

export interface RecheckCandidate {
  id: string;
  tenant_id: string;
  amount: number;
  currency: string;
  plan: string;
  created_at: string;
}

/** DOKU transactions still PENDING after the sweep age: the ones an operator may re-verify. Never throws. */
export async function listRecheckCandidates(admin: Admin, now: number = Date.now()): Promise<RecheckCandidate[] | null> {
  try {
    const { data, error } = await admin
      .from("prompter_payment_transactions")
      .select("id, tenant_id, amount, currency, plan, created_at")
      .eq("provider", "doku")
      .eq("status", "PENDING")
      .lt("created_at", new Date(now - SWEEP_MIN_AGE_MS).toISOString())
      .order("created_at", { ascending: true })
      .limit(RECHECK_LIST_LIMIT);
    if (error || !data) return null;
    return data as RecheckCandidate[];
  } catch {
    return null;
  }
}
