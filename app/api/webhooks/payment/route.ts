import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPaymentWebhook } from "@/services/payment-webhook";

/**
 * Batch B10 — payment webhook core (Bagian H of the brief). Deliberately
 * thin: reads the raw body (signature verification must run against the
 * exact bytes the processor sent, never a re-serialized JSON.parse'd
 * copy) and delegates everything else to services/payment-webhook.ts,
 * which is unit-testable without an HTTP server.
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
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-callback-token");

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ message: "Server not configured." }, { status: 503 });
  }

  const result = await processPaymentWebhook(admin, rawBody, signatureHeader);

  return NextResponse.json({ message: result.message }, { status: result.status });
}
