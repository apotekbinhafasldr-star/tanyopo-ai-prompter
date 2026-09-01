import type { NextRequest } from "next/server";
import { authorizeUmkmproRequest, parseJsonBody } from "@/lib/umkmpro/route-helpers";
import { apiError, apiSuccess } from "@/lib/api/response";
import { umkmproProductSyncSchema } from "@/schemas/umkmpro";
import { tenantExists, upsertProductFromUmkmpro } from "@/services/umkmpro";

/**
 * UMKMpro AI pushes a product create/update here. Upserts the live
 * `prompter_products` mirror and always writes a new append-only
 * `prompter_product_snapshots` row (product spec §48) — see
 * services/umkmpro.ts for why both exist.
 */
export async function POST(request: NextRequest) {
  const authorized = await authorizeUmkmproRequest(request, "products");
  if (authorized instanceof Response) return authorized;
  const { rawBody, admin } = authorized;

  const parsedJson = parseJsonBody(rawBody);
  if (!parsedJson.ok) {
    return apiError("INVALID_JSON", "Body permintaan bukan JSON yang valid.", 400);
  }

  const parsed = umkmproProductSyncSchema.safeParse(parsedJson.data);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Data produk tidak valid.", 400, parsed.error.flatten());
  }

  const { tenantId, product } = parsed.data;

  if (!(await tenantExists(admin, tenantId))) {
    return apiError("TENANT_NOT_FOUND", "Tenant tidak ditemukan.", 404);
  }

  try {
    const result = await upsertProductFromUmkmpro(admin, tenantId, product);

    await admin.from("prompter_audit_logs").insert({
      tenant_id: tenantId,
      actor_user_id: null,
      action: "umkmpro.product_synced",
      resource_type: "prompter_products",
      resource_id: result.productId,
      context: { source_product_id: product.sourceProductId, snapshot_id: result.snapshotId },
    });

    return apiSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal menyinkronkan produk.";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
