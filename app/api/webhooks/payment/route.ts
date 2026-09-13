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
 * `x-payment-signature` is a placeholder header name — no real
 * processor is integrated yet (NullPaymentProvider.isConfigured() is
 * always false today, so this route always responds 503 in practice).
 * A real adapter (Midtrans/Xendit/...) will very likely use a different
 * header (or, for some providers, a token embedded in the body itself)
 * — update this one line when that adapter is built, nothing else in
 * this route or in services/payment-webhook.ts needs to change.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-payment-signature");

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ message: "Server not configured." }, { status: 503 });
  }

  const result = await processPaymentWebhook(admin, rawBody, signatureHeader);

  return NextResponse.json({ message: result.message }, { status: result.status });
}
