import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readBodyWithLimit } from "@/lib/billing/read-body-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPaymentWebhook } from "@/services/payment-webhook";

/**
 * Batch B10 — payment webhook core (Bagian H of the brief). Deliberately
 * thin: reads the raw body (signature verification must run against the
 * exact bytes the processor sent, never a re-serialized JSON.parse'd
 * copy) and delegates everything else to services/payment-webhook.ts,
 * which is unit-testable without an HTTP server.
 *
 * Billing B3 — the same path now also receives Midtrans notifications (Midtrans carries its signature INSIDE the
 * JSON body, so it ignores the header below). The body is size-limited before anything else, and for Midtrans the
 * service never trusts the notification's own status/amount: see services/payment-verification.ts.
 *
 * Batch B11 — header is now `x-callback-token`, matching Xendit's
 * Invoice callback verification header (a static shared-secret token
 * compared in constant time by XenditPaymentProvider.
 * verifyWebhookSignature(), not an HMAC signature). Still routes through
 * the same provider-agnostic processPaymentWebhook() below unchanged —
 * only this one header name is provider-specific, and only because
 * different providers name it differently; the verification logic
 * itself lives entirely in the adapter.
 */
/** Billing B3: a payment notification is a few hundred bytes; anything near this ceiling is not one. */
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  const rawBody = await readBodyWithLimit(request, MAX_WEBHOOK_BODY_BYTES);
  if (rawBody === null) {
    return NextResponse.json({ message: "Payload too large." }, { status: 413 });
  }
  const signatureHeader = request.headers.get("x-callback-token");

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ message: "Server not configured." }, { status: 503 });
  }

  const result = await processPaymentWebhook(admin, rawBody, signatureHeader);

  return NextResponse.json({ message: result.message }, { status: result.status });
}
