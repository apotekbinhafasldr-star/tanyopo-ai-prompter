import { NextResponse } from "next/server";
import { productSyncSchema } from "@/schemas/umkmpro";
import { authorizeUmkmproRequest, tenantExists } from "@/lib/umkmpro/route-helpers";
import { recordProductSnapshot } from "@/lib/umkmpro/handoff";

/**
 * Product handoff (product spec §48): UMKMpro pushes its own product
 * state here; Promoter never reads UMKMpro's products table directly
 * (docs/INTEGRATIONS.md — the two apps share a Postgres instance but not
 * each other's application logic). Every call records a new,
 * append-only snapshot and mirrors it into the live prompter_products
 * row via source_system/source_product_id upsert.
 */
export async function POST(request: Request) {
  const auth = authorizeUmkmproRequest(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = productSyncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues }, { status: 400 });
  }

  const { admin } = auth.context;
  if (!(await tenantExists(admin, parsed.data.tenantId))) {
    return NextResponse.json({ error: "TENANT_NOT_FOUND" }, { status: 404 });
  }

  const result = await recordProductSnapshot(admin, {
    tenantId: parsed.data.tenantId,
    sourceProductId: parsed.data.sourceProductId,
    name: parsed.data.name,
    description: parsed.data.description,
    price: parsed.data.price,
    currency: parsed.data.currency,
    stock: parsed.data.stock,
    hpp: parsed.data.hpp,
    category: parsed.data.category,
    images: parsed.data.images,
    sourceUpdatedAt: parsed.data.sourceUpdatedAt,
  });

  if (!result.ok) return NextResponse.json({ error: "INTERNAL_ERROR", message: result.error }, { status: 500 });
  return NextResponse.json({ snapshotId: result.data.snapshotId, productId: result.data.productId }, { status: 201 });
}
