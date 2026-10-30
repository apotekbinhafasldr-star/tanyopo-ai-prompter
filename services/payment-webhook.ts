import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { canVerifyServerSide, verifyAndSettle } from "@/services/payment-verification";
import type { Database, Json } from "@/types/database";

const UNIQUE_VIOLATION = "23505";

export interface ProcessPaymentWebhookResult {
  /** Whether the HTTP layer should report success (2xx) to the
   * processor. False tells the processor to retry (its own delivery
   * failed to reach a safe conclusion here — a transient error, not a
   * rejected payment) or signals a request that couldn't be trusted at
   * all (bad signature). */
  ok: boolean;
  status: number;
  message: string;
}

/**
 * Batch B10 — webhook core (Bagian H of the brief). Provider-neutral:
 * every provider-specific concern (signature scheme, payload shape) is
 * already resolved by the PaymentProvider adapter before this function
 * ever sees the event.
 *
 * Idempotency and retry-safety live in TWO independent, complementary
 * places, deliberately not conflated:
 *   - prompter_webhook_events (append-only, "Update: never" by design,
 *     same as the existing UMKMpro integration) is a best-effort,
 *     immutable DELIVERY log — a unique-constraint violation there just
 *     means "we've already logged this exact provider delivery," which
 *     is recorded for observability and then ignored, never treated as
 *     a reason to skip activation.
 *   - fn_apply_verified_payment() is what's actually idempotent w.r.t.
 *     EFFECT: it checks the transaction's own status (PENDING vs
 *     already-PAID) inside one atomic transaction, so calling it twice
 *     for the same payment — whether from a genuine provider redelivery
 *     or from this route retrying after its own prior attempt failed
 *     partway through — never double-activates or double-extends a
 *     billing period.
 * This split is what makes "atomic failure can retry safely" (Bagian K
 * item 13) actually true: if this function crashes after logging the
 * delivery but before/during the RPC call, the next redelivery still
 * calls the RPC again rather than being silently swallowed as "already
 * seen."
 */
export async function processPaymentWebhook(
  admin: SupabaseClient<Database>,
  rawBody: string,
  signatureHeader: string | null,
): Promise<ProcessPaymentWebhookResult> {
  const provider = getPaymentProvider();

  if (!provider.isConfigured()) {
    // Fail closed — same rule as NullPaymentProvider.verifyWebhookSignature()
    // itself: an unconfigured provider can never activate anything.
    return { ok: false, status: 503, message: "Payment provider not configured." };
  }

  if (!provider.verifyWebhookSignature(rawBody, signatureHeader)) {
    return { ok: false, status: 401, message: "Invalid webhook signature." };
  }

  let event;
  try {
    event = provider.parseWebhookEvent(rawBody);
  } catch {
    return { ok: false, status: 400, message: "Could not parse webhook event." };
  }

  // Append-only delivery log. Inserted as RECEIVED first (never PROCESSED
  // up front) because the outcome of activation below isn't known yet —
  // Payment Remediation fix: this row's final `status` is now set from
  // what fn_apply_verified_payment() actually reports, not from the
  // provider's own claimed status, so "PROCESSED" only ever means
  // activation genuinely succeeded (or was already-applied), never a
  // false success recorded ahead of finding out.
  const eventPayload = {
    externalPaymentId: event.externalPaymentId,
    // Our own transaction reference (from the signed order_id): lets the B4 alert sync map an ALARM_* event to its transaction.
    orderId: event.internalTransactionId ?? null,
    status: event.status,
    amount: event.amount,
    currency: event.currency,
  } as Json;

  const { data: insertedRow, error: insertError } = await admin
    .from("prompter_webhook_events")
    .insert({
      source_system: provider.name,
      external_event_id: event.externalEventId,
      event_type: event.eventType,
      payload: eventPayload,
      status: "RECEIVED",
    })
    .select("id")
    .single();

  let eventRowId: string | null = insertedRow?.id ?? null;

  if (insertError) {
    if (insertError.code !== UNIQUE_VIOLATION) {
      return { ok: false, status: 500, message: "Failed to record webhook event." };
    }
    // Redelivery of an event we've already logged once — look the
    // existing row back up so a retried activation's real outcome still
    // gets recorded on it, instead of leaving it stuck at whatever its
    // first delivery attempt left behind.
    const { data: existingRow } = await admin
      .from("prompter_webhook_events")
      .select("id")
      .eq("source_system", provider.name)
      .eq("external_event_id", event.externalEventId)
      .maybeSingle();
    eventRowId = existingRow?.id ?? null;
  }

  const markEvent = async (status: "PROCESSED" | "FAILED" | "IGNORED", error: string | null) => {
    if (!eventRowId) return;
    await admin
      .from("prompter_webhook_events")
      .update({ status, error, processed_at: new Date().toISOString() })
      .eq("id", eventRowId);
  };

  if (canVerifyServerSide(provider)) {
    // Billing B3: this provider can be asked directly. Nothing below the signature check is taken from the webhook
    // body any more — status, amount, currency and the payment reference all come from the gateway's own answer.
    if (!event.internalTransactionId) {
      await markEvent("FAILED", "NO_INTERNAL_TRANSACTION_REFERENCE");
      return { ok: false, status: 400, message: "Webhook event has no internal transaction reference." };
    }

    // Never downgrade an event already recorded as PROCESSED (a replayed old notification must not rewrite history).
    const markVerifiedEvent = async (
      status: "PROCESSED" | "FAILED" | "IGNORED",
      error: string | null,
      extraPayload?: Record<string, Json>,
    ) => {
      if (!eventRowId) return;
      let query = admin
        .from("prompter_webhook_events")
        .update({
          status,
          error,
          processed_at: new Date().toISOString(),
          // B4.1: keep the verified event identity on the (server-written) event row so the alert sync can re-derive it.
          ...(extraPayload ? { payload: { ...(eventPayload as Record<string, Json>), ...extraPayload } as Json } : {}),
        })
        .eq("id", eventRowId);
      if (status !== "PROCESSED") query = query.neq("status", "PROCESSED");
      await query;
    };

    const outcome = await verifyAndSettle(admin, provider, event.internalTransactionId, {
      eventId: event.externalEventId,
    });

    switch (outcome.kind) {
      case "APPLIED":
        await markVerifiedEvent("PROCESSED", null);
        return {
          ok: true,
          status: 200,
          message: outcome.reason === "ALREADY_PROCESSED" ? "Already processed." : "Payment applied.",
        };

      case "NEEDS_REVIEW":
        await markVerifiedEvent("FAILED", "NEEDS_REVIEW");
        return { ok: true, status: 200, message: "Payment recorded for manual review; subscription not activated." };

      case "NOT_APPLIED": {
        await markVerifiedEvent("FAILED", outcome.reason);
        const status = outcome.reason === "TRANSACTION_NOT_FOUND" ? 400 : 200;
        return { ok: status === 200, status, message: outcome.reason };
      }

      case "ALARM":
        await markVerifiedEvent("FAILED", `ALARM_${outcome.alarm}`, { evidenceRef: outcome.evidenceRef });
        return {
          ok: true,
          status: 200,
          message: "Refund/chargeback recorded for review; subscription unchanged.",
        };

      case "NOT_PAID":
        if (event.status === "PAID" && (outcome.status === "PENDING" || outcome.status === "UNKNOWN")) {
          // The notification claims PAID but the gateway does not (yet) agree: could be gateway lag — ask for a retry,
          // activate nothing.
          await markVerifiedEvent("FAILED", "VERIFIED_STATUS_NOT_PAID");
          return { ok: false, status: 503, message: "Payment not confirmed by gateway yet." };
        }
        if (event.status === "PAID") {
          // Claimed PAID, gateway says cancelled/expired/denied: a manipulated or stale notification. Nothing activates.
          await markVerifiedEvent("FAILED", "STATUS_MISMATCH_CLAIMED_PAID");
          return { ok: true, status: 200, message: "Notification does not match the gateway status; ignored." };
        }
        await markVerifiedEvent("IGNORED", null);
        return { ok: true, status: 200, message: `Recorded ${outcome.status} event, no activation needed.` };

      case "NOT_FOUND":
        await markVerifiedEvent("FAILED", "TRANSACTION_NOT_FOUND");
        return { ok: false, status: 400, message: "Unknown transaction reference." };

      case "WRONG_PROVIDER":
        await markVerifiedEvent("FAILED", "WRONG_PROVIDER");
        return { ok: false, status: 400, message: "Transaction was not created for this provider." };

      case "UNVERIFIABLE":
        // Gateway timeout / error / inconsistent answer: fail closed and let the gateway retry.
        await markVerifiedEvent("FAILED", outcome.message);
        return { ok: false, status: 503, message: "Could not verify payment with the gateway." };

      case "RPC_ERROR":
        await markVerifiedEvent("FAILED", outcome.message);
        return { ok: false, status: 500, message: "Failed to apply verified payment." };
    }
  }

  if (event.status !== "PAID") {
    await markEvent("IGNORED", null);
    return { ok: true, status: 200, message: `Recorded ${event.status} event, no activation needed.` };
  }

  if (!event.internalTransactionId) {
    await markEvent("FAILED", "NO_INTERNAL_TRANSACTION_REFERENCE");
    return { ok: false, status: 400, message: "Webhook event has no internal transaction reference." };
  }

  const { data: rpcRows, error: rpcError } = await admin.rpc("fn_apply_verified_payment", {
    p_transaction_id: event.internalTransactionId,
    p_provider_payment_id: event.externalPaymentId,
    p_provider_event_id: event.externalEventId,
    p_verified_amount: event.amount,
    p_verified_currency: event.currency,
  });

  const activation = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as
    | { allowed: boolean; reason: string | null }
    | undefined;

  if (rpcError || !activation) {
    // Transient/unexpected failure — ask the processor to retry. The
    // transaction is still PENDING (fn_apply_verified_payment only ever
    // mutates it inside its own successful transaction), so a retry is
    // always safe, never a double-activation. Recorded as FAILED, not
    // PROCESSED — this delivery did not actually activate anything.
    await markEvent("FAILED", rpcError?.message ?? "RPC_NO_RESULT");
    return { ok: false, status: 500, message: "Failed to apply verified payment." };
  }

  if (!activation.allowed && activation.reason === "NEEDS_REVIEW") {
    // Billing B2: the payment notification could not be applied safely (late payment on a closed invoice, wrong
    // amount, plan conflict during a paid period, missing subscription). The database has ALREADY recorded it durably
    // as a REVIEW transaction (provider ids + reported amount kept as evidence) and written an audit row, so asking the
    // gateway to retry would change nothing. The event row is FAILED/NEEDS_REVIEW, never PROCESSED: the subscription was
    // NOT activated and a person (or the gateway-verified resolver, B3) must settle it. HTTP 200 here only means
    // "received and durably recorded", not "resolved".
    await markEvent("FAILED", "NEEDS_REVIEW");
    return { ok: true, status: 200, message: "Payment recorded for manual review; subscription not activated." };
  }

  if (!activation.allowed) {
    // A real, permanent mismatch (wrong amount/currency, or a
    // transaction that wasn't PENDING) — recorded server-side by the RPC
    // itself; nothing is activated. An unknown transaction id gets a 400
    // so a misconfigured integration is loud, not silently accepted;
    // everything else is a resolved 200 (we successfully processed the
    // notification — the payment itself is what didn't check out).
    await markEvent("FAILED", activation.reason ?? "PAYMENT_NOT_APPLIED");
    const status = activation.reason === "TRANSACTION_NOT_FOUND" ? 400 : 200;
    return { ok: status === 200, status, message: activation.reason ?? "Payment not applied." };
  }

  await markEvent("PROCESSED", null);

  return {
    ok: true,
    status: 200,
    message: activation.reason === "ALREADY_PROCESSED" ? "Already processed." : "Payment applied.",
  };
}
