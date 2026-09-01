import { NextResponse } from "next/server";
import { webhookEventSchema } from "@/schemas/umkmpro";
import { authorizeUmkmproRequest } from "@/lib/umkmpro/route-helpers";
import { verifyWebhookSignature } from "@/lib/umkmpro/auth";
import { recordWebhookEvent, markWebhookEventProcessed } from "@/lib/umkmpro/handoff";
import type { Json } from "@/types/database";

/**
 * Generic webhook receiver (product spec §56-57). Two layers of
 * verification before anything is trusted: the shared bearer token
 * (authorizeUmkmproRequest, same as every other umkmpro/* route) and an
 * HMAC-SHA256 signature over the *raw* request body — read before JSON
 * parsing, since parsing-then-reserializing would not reproduce the
 * exact bytes UMKMpro signed. Replay protection comes from
 * recordWebhookEvent()'s unique-constraint-backed idempotency: a
 * redelivered event id always returns 200 without reprocessing.
 */
export async function POST(request: Request) {
  const auth = authorizeUmkmproRequest(request);
  if (!auth.ok) return auth.response;

  const rawBody = await request.text();
  const signature = request.headers.get("x-umkmpro-signature");
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  const body = (() => {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  })();
  const parsed = webhookEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues }, { status: 400 });
  }

  const { admin } = auth.context;
  const receipt = await recordWebhookEvent(admin, {
    tenantId: parsed.data.tenantId ?? null,
    externalEventId: parsed.data.eventId,
    eventType: parsed.data.eventType,
    // The payload's shape is whatever UMKMpro sends — arbitrary,
    // already-parsed JSON, so it is structurally a Json value.
    payload: (parsed.data.payload ?? {}) as Json,
  });

  if (!receipt.ok) return NextResponse.json({ error: "INTERNAL_ERROR", message: receipt.error }, { status: 500 });
  if (receipt.alreadyProcessed) {
    return NextResponse.json({ status: "ALREADY_PROCESSED", eventId: receipt.data.eventId }, { status: 200 });
  }

  // No event-specific processing logic exists yet beyond the receipt
  // itself (out-of-stock/product-update handling reuses /products above
  // when UMKMpro chooses to call it) — mark received events PROCESSED
  // as a no-op rather than leaving them stuck at RECEIVED forever.
  await markWebhookEventProcessed(admin, receipt.data.eventId, { status: "PROCESSED" });

  return NextResponse.json({ status: "RECEIVED", eventId: receipt.data.eventId }, { status: 200 });
}
