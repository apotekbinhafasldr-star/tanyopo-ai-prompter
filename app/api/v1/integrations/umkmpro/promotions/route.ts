import type { NextRequest } from "next/server";
import { authorizeUmkmproRequest, parseJsonBody } from "@/lib/umkmpro/route-helpers";
import { apiError, apiSuccess } from "@/lib/api/response";
import { publicEnv } from "@/lib/env";
import { umkmproPromotionHandoffSchema } from "@/schemas/umkmpro";
import { createPromotionHandoff, tenantExists } from "@/services/umkmpro";

/**
 * Backs UMKMpro AI's "🚀 PROMOSIKAN DENGAN AI" button (product spec §47).
 * Syncs the product, creates a one-time handoff row, and returns a URL to
 * `/promote?handoff=<id>` for UMKMpro to redirect its user to. Promoter's
 * own tenant-scoped RLS is what makes the handoff safe to hand to a
 * browser redirect — a visiting user simply can't see a handoff belonging
 * to a different tenant.
 */
export async function POST(request: NextRequest) {
  const authorized = await authorizeUmkmproRequest(request, "promotions");
  if (authorized instanceof Response) return authorized;
  const { rawBody, admin } = authorized;

  const parsedJson = parseJsonBody(rawBody);
  if (!parsedJson.ok) {
    return apiError("INVALID_JSON", "Body permintaan bukan JSON yang valid.", 400);
  }

  const parsed = umkmproPromotionHandoffSchema.safeParse(parsedJson.data);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Data handoff tidak valid.", 400, parsed.error.flatten());
  }

  const { tenantId } = parsed.data;

  if (!(await tenantExists(admin, tenantId))) {
    return apiError("TENANT_NOT_FOUND", "Tenant tidak ditemukan.", 404);
  }

  try {
    const result = await createPromotionHandoff(admin, tenantId, parsed.data);

    if (!result.alreadyExisted) {
      await admin.from("prompter_audit_logs").insert({
        tenant_id: tenantId,
        actor_user_id: null,
        action: "umkmpro.promotion_handoff_created",
        resource_type: "prompter_promotion_handoffs",
        resource_id: result.handoffId,
        context: { source_product_id: parsed.data.product.sourceProductId },
      });
    }

    return apiSuccess(
      {
        handoffId: result.handoffId,
        handoffUrl: `${publicEnv.appUrl}/promote?handoff=${result.handoffId}`,
      },
      { status: result.alreadyExisted ? 200 : 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal membuat promotion handoff.";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
