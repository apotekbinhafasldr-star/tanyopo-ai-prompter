import { NextResponse } from "next/server";
import { promotionHandoffSchema } from "@/schemas/umkmpro";
import { authorizeUmkmproRequest, tenantExists } from "@/lib/umkmpro/route-helpers";
import { createPromotionHandoff } from "@/lib/umkmpro/handoff";

/**
 * The "Promosikan dengan AI" handoff (product spec §47): UMKMpro calls
 * this after the user clicks that action on one of their products, then
 * redirects the user's browser to the URL this returns. Promoter's own
 * tenant-scoped RLS on prompter_promotion_handoffs is what stops a user
 * from ever seeing a handoff belonging to a different tenant — there is
 * no separate "validate organization" step needed beyond that.
 */
export async function POST(request: Request) {
  const auth = authorizeUmkmproRequest(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = promotionHandoffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues }, { status: 400 });
  }

  const { admin } = auth.context;
  const { tenantId, sourceProductId, externalUserReference, idempotencyKey } = parsed.data;

  if (!(await tenantExists(admin, tenantId))) {
    return NextResponse.json({ error: "TENANT_NOT_FOUND" }, { status: 404 });
  }

  // Resolve the most recent snapshot for this product so the handoff
  // links to it — a handoff for a product never sync'd via /products
  // first is rejected rather than created with a dangling reference.
  const { data: snapshot } = await admin
    .from("prompter_product_snapshots")
    .select("id, linked_product_id")
    .eq("tenant_id", tenantId)
    .eq("source_system", "umkmpro")
    .eq("source_product_id", sourceProductId)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!snapshot) {
    return NextResponse.json(
      { error: "PRODUCT_NOT_SYNCED", message: "Sinkronkan produk lewat /products terlebih dahulu." },
      { status: 409 },
    );
  }

  const result = await createPromotionHandoff(admin, {
    tenantId,
    snapshotId: snapshot.id,
    productId: snapshot.linked_product_id,
    externalUserReference,
    idempotencyKey,
  });

  if (!result.ok) return NextResponse.json({ error: "INTERNAL_ERROR", message: result.error }, { status: 500 });

  return NextResponse.json(
    {
      handoffId: result.data.handoffId,
      alreadyProcessed: result.alreadyProcessed ?? false,
      redirectPath: `/promote?handoff=${result.data.handoffId}`,
    },
    { status: result.alreadyProcessed ? 200 : 201 },
  );
}
