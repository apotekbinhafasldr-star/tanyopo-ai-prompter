"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkOptionalNote, checkResolveNote, isUuid } from "@/lib/billing/payment-alerts";
import { getPaymentOperator } from "@/services/payment-operator";
import { ackPaymentAlert, resolvePaymentAlert, syncPaymentAlerts } from "@/services/payment-alerts";

/**
 * Billing B4.1 — operator actions. Each one re-checks the allowlist on the server (a page render is not authorization),
 * changes only the alert row + history, and redirects with a fixed status code (never free text from the request).
 * NONE of them can activate, refund, revoke or edit a payment, transaction or subscription.
 */
function done(code: string, ok: boolean): never {
  revalidatePath("/ops/payments");
  redirect(`/ops/payments?r=${code}&ok=${ok ? 1 : 0}`);
}

export async function ackAlertAction(formData: FormData) {
  const operator = await getPaymentOperator();
  if (!operator) redirect("/ops/payments?r=denied&ok=0");
  const alertId = formData.get("alertId");
  if (!isUuid(alertId)) done("invalid", false);
  if (!checkRateLimit(`ops-payments:${operator.userId}`, 30, 60_000).allowed) done("rate", false);
  const note = checkOptionalNote(formData.get("note"));
  if (!note.ok) done("note", false);
  const result = await ackPaymentAlert(operator.admin, alertId, operator.userId, note.note || null);
  done(result.ok ? "acked" : "failed", result.ok);
}

export async function resolveAlertAction(formData: FormData) {
  const operator = await getPaymentOperator();
  if (!operator) redirect("/ops/payments?r=denied&ok=0");
  const alertId = formData.get("alertId");
  if (!isUuid(alertId)) done("invalid", false);
  if (!checkRateLimit(`ops-payments:${operator.userId}`, 30, 60_000).allowed) done("rate", false);
  const note = checkResolveNote(formData.get("note"));
  if (!note.ok) done("note", false);
  const result = await resolvePaymentAlert(operator.admin, alertId, operator.userId, note.note);
  done(result.ok ? "resolved" : "failed", result.ok);
}

export async function syncAlertsAction() {
  const operator = await getPaymentOperator();
  if (!operator) redirect("/ops/payments?r=denied&ok=0");
  if (!checkRateLimit(`ops-payments-sync:${operator.userId}`, 6, 60_000).allowed) done("rate", false);
  const result = await syncPaymentAlerts(operator.admin);
  done(result.ok ? (result.skipped ? "sync_busy" : "synced") : "sync_failed", result.ok);
}
