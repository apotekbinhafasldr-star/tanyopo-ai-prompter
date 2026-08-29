import type { NextRequest } from "next/server";
import { authorizeUmkmproRequest, parseJsonBody } from "@/lib/umkmpro/route-helpers";
import { apiError, apiSuccess } from "@/lib/api/response";
import { umkmproConversionSchema } from "@/schemas/umkmpro";
import { recordConversionFromUmkmpro, tenantExists } from "@/services/umkmpro";

/**
 * UMKMpro AI pushes a real order/conversion event here (e.g. a sale that
 * closed in its POS, attributable back to a campaign). Upserted into the
 * same `prompter_conversions` table Phase 2's manual conversion logging
 * writes to, distinguished by `source = 'umkmpro'` and a real
 * `external_event_id` — see docs/DATABASE.md for the idempotency design.
 */
export async function POST(request: NextRequest) {
  const authorized = await authorizeUmkmproRequest(request, "conversions");
  if (authorized instanceof Response) return authorized;
  const { rawBody, admin } = authorized;

  const parsedJson = parseJsonBody(rawBody);
  if (!parsedJson.ok) {
    return apiError("INVALID_JSON", "Body permintaan bukan JSON yang valid.", 400);
  }

  const parsed = umkmproConversionSchema.safeParse(parsedJson.data);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Data konversi tidak valid.", 400, parsed.error.flatten());
  }

  const { tenantId } = parsed.data;

  if (!(await tenantExists(admin, tenantId))) {
    return apiError("TENANT_NOT_FOUND", "Tenant tidak ditemukan.", 404);
  }

  try {
    const result = await recordConversionFromUmkmpro(admin, tenantId, parsed.data);

    await admin.from("prompter_audit_logs").insert({
      tenant_id: tenantId,
      actor_user_id: null,
      action: "umkmpro.conversion_recorded",
      resource_type: "prompter_conversions",
      resource_id: result.conversionId,
      context: { external_event_id: parsed.data.externalEventId, event_type: parsed.data.eventType },
    });

    return apiSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal menyimpan data konversi.";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
