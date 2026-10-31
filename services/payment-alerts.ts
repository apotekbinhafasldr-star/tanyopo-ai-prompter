import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, PaymentAlertState } from "@/types/database";
import { describeAlertActionOutcome, isSyncStale, isUuid } from "@/lib/billing/payment-alerts";

type Admin = SupabaseClient<Database>;
export type PaymentAlertRow = Database["public"]["Tables"]["prompter_payment_alerts"]["Row"];
export type PaymentAlertSyncState = Database["public"]["Tables"]["prompter_payment_alert_sync_state"]["Row"];

/**
 * Billing B4.1 — payment alert queue (server side, service_role client only).
 *
 * Nothing here activates, refunds, revokes or edits a payment, a transaction or a subscription: the database functions
 * these call can only write alert rows and their history. Authorization is the dedicated allowlist
 * (prompter_payment_operators), checked in the database as well as here.
 */

export async function isPaymentOperator(admin: Admin, userId: string): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const { data, error } = await admin.rpc("fn_is_payment_operator", { p_user_id: userId });
  return !error && data === true;
}

export async function listPaymentAlerts(
  admin: Admin,
  filter: { states?: PaymentAlertState[]; limit?: number } = {},
): Promise<PaymentAlertRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
  let query = admin.from("prompter_payment_alerts").select("*");
  if (filter.states && filter.states.length > 0) query = query.in("state", filter.states);
  const { data } = await query.order("first_seen_at", { ascending: false }).limit(limit);
  return (data ?? []) as PaymentAlertRow[];
}

export async function getSyncState(admin: Admin): Promise<PaymentAlertSyncState | null> {
  const { data } = await admin.from("prompter_payment_alert_sync_state").select("*").eq("id", 1).maybeSingle();
  return (data as PaymentAlertSyncState | null) ?? null;
}

/** B4.2: sender heartbeat + number of batches that gave up. Read-only, never throws. */
export async function getNotifyStatus(admin: Admin) {
  try {
    const [state, dead] = await Promise.all([
      admin.from("prompter_payment_alert_notify_state").select("*").eq("id", 1).maybeSingle(),
      admin.from("prompter_payment_alert_notification_batches").select("id", { count: "exact", head: true }).eq("status", "DEAD"),
    ]);
    return { state: (state.data as { last_run_at: string | null; last_claim_result: string | null; last_success_at: string | null; last_error: string | null; consecutive_failures: number } | null) ?? null, dead: dead.count ?? 0 };
  } catch {
    return { state: null, dead: 0 };
  }
}

export type SyncResult =
  | { ok: true; skipped: boolean; reviewCreated: number; alarmCreated: number; autoResolved: number }
  | { ok: false; message: string };

/**
 * Re-derives the queue from the trusted sources. Safe to call at any time and in parallel (advisory lock + conflict-safe
 * inserts). A failure rolls back inside the database and is recorded best-effort; the next call recomputes everything.
 */
export async function syncPaymentAlerts(admin: Admin): Promise<SyncResult> {
  const { data, error } = await admin.rpc("fn_sync_payment_alerts", {});
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    const message = error?.message ?? "SYNC_NO_RESULT";
    try {
      await admin.rpc("fn_note_payment_alert_sync_failure", { p_error: message });
    } catch {
      // best effort only: the alerts themselves are never lost because they are re-derived on the next run
    }
    return { ok: false, message };
  }
  return {
    ok: true,
    skipped: row.skipped,
    reviewCreated: row.review_created,
    alarmCreated: row.alarm_created,
    autoResolved: row.auto_resolved,
  };
}

/** Lazy sync used by the operator page: only when the last success is stale. Never throws. */
export async function syncIfStale(admin: Admin): Promise<void> {
  try {
    const state = await getSyncState(admin);
    if (isSyncStale(state?.last_success_at ?? null)) await syncPaymentAlerts(admin);
  } catch {
    // the page still renders what it has, with the stale / failing warning
  }
}

export async function ackPaymentAlert(admin: Admin, alertId: string, operatorId: string, note: string | null) {
  if (!isUuid(alertId) || !isUuid(operatorId)) return describeAlertActionOutcome("NOT_FOUND");
  const { data, error } = await admin.rpc("fn_ack_payment_alert", { p_alert_id: alertId, p_operator: operatorId, p_note: note });
  return describeAlertActionOutcome(error ? "ERROR" : String(data));
}

export async function resolvePaymentAlert(admin: Admin, alertId: string, operatorId: string, note: string) {
  if (!isUuid(alertId) || !isUuid(operatorId)) return describeAlertActionOutcome("NOT_FOUND");
  const { data, error } = await admin.rpc("fn_resolve_payment_alert", { p_alert_id: alertId, p_operator: operatorId, p_note: note });
  return describeAlertActionOutcome(error ? "ERROR" : String(data));
}

export type RecordAlarmOutcome = "CREATED" | "REOPENED" | "REPEAT" | "EXISTING";

/**
 * Direct create-or-reopen of a gateway-VERIFIED refund / chargeback / reversal (called from verifyAndSettle).
 * `evidenceRef` is the identity of the verified gateway state (never a webhook body): a ref the alert has not seen
 * reopens a RESOLVED alert exactly once; a known ref (replay) only bumps a counter.
 */
export async function recordPaymentAlarm(
  admin: Admin,
  transactionId: string,
  kind: "REFUND" | "CHARGEBACK" | "REVERSAL",
  evidence: Record<string, Json>,
  evidenceRef: string,
): Promise<{ ok: true; outcome: RecordAlarmOutcome } | { ok: false; message: string }> {
  const { data, error } = await admin.rpc("fn_record_payment_alarm", {
    p_transaction_id: transactionId,
    p_kind: kind,
    p_evidence: evidence,
    p_evidence_ref: evidenceRef,
  });
  if (error) return { ok: false, message: "ALARM_RECORD_FAILED" };
  if (data === "CREATED" || data === "REOPENED" || data === "REPEAT" || data === "EXISTING") return { ok: true, outcome: data };
  return { ok: false, message: `ALARM_RECORD_${String(data)}` };
}
