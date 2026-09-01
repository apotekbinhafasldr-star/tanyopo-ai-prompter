import type { NextRequest } from "next/server";
import { authorizeUmkmproRequest, parseJsonBody } from "@/lib/umkmpro/route-helpers";
import { apiError, apiSuccess } from "@/lib/api/response";
import { umkmproWebhookEventSchema } from "@/schemas/umkmpro";
import { recordWebhookEvent, tenantExists } from "@/services/umkmpro";

/**
 * Generic, idempotent webhook receipt log (product spec §56-57). This
 * endpoint's job is honest bookkeeping, not a dispatch pipeline: every
 * delivery is recorded exactly once (redelivery-safe via the unique
 * constraint on `(source_system, external_event_id)`), a `tenantId` that
 * doesn't resolve to a real tenant is recorded as `IGNORED` rather than
 * silently dropped or attached to the wrong tenant, and no downstream
 * processing (e.g. re-deriving a product sync from an arbitrary payload
 * shape) is invented here — that's out of scope until a concrete event
 * type needs it.
 */
export async function POST(request: NextRequest) {
  const authorized = await authorizeUmkmproRequest(request, "webhooks");
  if (authorized instanceof Response) return authorized;
  const { rawBody, admin } = authorized;

  const parsedJson = parseJsonBody(rawBody);
  if (!parsedJson.ok) {
    return apiError("INVALID_JSON", "Body permintaan bukan JSON yang valid.", 400);
  }

  const parsed = umkmproWebhookEventSchema.safeParse(parsedJson.data);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Data webhook tidak valid.", 400, parsed.error.flatten());
  }

  const { tenantId, externalEventId, eventType, payload } = parsed.data;

  const tenantResolved = tenantId ? await tenantExists(admin, tenantId) : true;

  try {
    const result = await recordWebhookEvent(admin, {
      tenantId: tenantResolved ? tenantId : undefined,
      externalEventId,
      eventType,
      payload,
      status: tenantResolved ? "PROCESSED" : "IGNORED",
      error: tenantResolved ? null : "tenant_id tidak ditemukan",
    });

    return apiSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mencatat webhook event.";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
