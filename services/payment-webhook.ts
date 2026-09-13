import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
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

  // Best-effort, append-only delivery log — a duplicate/replayed
  // delivery of an event we've already logged is expected and harmless
  // (the unique constraint on (source_system, external_event_id) is
  // what makes this safe), so its error is deliberately swallowed here
  // rather than short-circuiting activation below.
  const { error: insertError } = await admin.from("prompter_webhook_events").insert({
    source_system: provider.name,
    external_event_id: event.externalEventId,
    event_type: event.eventType,
    payload: {
      externalPaymentId: event.externalPaymentId,
      status: event.status,
      amount: event.amount,
      currency: event.currency,
    } as Json,
    status: event.status === "PAID" ? "PROCESSED" : "IGNORED",
    processed_at: new Date().toISOString(),
  });

  if (insertError && insertError.code !== UNIQUE_VIOLATION) {
    return { ok: false, status: 500, message: "Failed to record webhook event." };
  }

  if (event.status !== "PAID") {
    return { ok: true, status: 200, message: `Recorded ${event.status} event, no activation needed.` };
  }

  if (!event.internalTransactionId) {
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
    // always safe, never a double-activation.
    return { ok: false, status: 500, message: "Failed to apply verified payment." };
  }

  if (!activation.allowed) {
    // A real, permanent mismatch (wrong amount/currency, or a
    // transaction that wasn't PENDING) — recorded server-side by the RPC
    // itself; nothing is activated. An unknown transaction id gets a 400
    // so a misconfigured integration is loud, not silently accepted;
    // everything else is a resolved 200 (we successfully processed the
    // notification — the payment itself is what didn't check out).
    const status = activation.reason === "TRANSACTION_NOT_FOUND" ? 400 : 200;
    return { ok: status === 200, status, message: activation.reason ?? "Payment not applied." };
  }

  return {
    ok: true,
    status: 200,
    message: activation.reason === "ALREADY_PROCESSED" ? "Already processed." : "Payment applied.",
  };
}
