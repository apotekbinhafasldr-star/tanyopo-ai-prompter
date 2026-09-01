import { NextResponse } from "next/server";
import { conversionSchema } from "@/schemas/umkmpro";
import { authorizeUmkmproRequest, tenantExists } from "@/lib/umkmpro/route-helpers";
import { recordConversion } from "@/lib/umkmpro/handoff";

/**
 * UMKMpro pushes real sales/lead events here (e.g. a POS transaction
 * that originated from a Promoter-driven campaign). Idempotent on
 * (tenant_id, source, external_event_id) — a redelivered event is a
 * safe no-op, not a duplicate row.
 */
export async function POST(request: Request) {
  const auth = authorizeUmkmproRequest(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = conversionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues }, { status: 400 });
  }

  const { admin } = auth.context;
  if (!(await tenantExists(admin, parsed.data.tenantId))) {
    return NextResponse.json({ error: "TENANT_NOT_FOUND" }, { status: 404 });
  }

  const result = await recordConversion(admin, parsed.data);
  if (!result.ok) return NextResponse.json({ error: "INTERNAL_ERROR", message: result.error }, { status: 500 });

  return NextResponse.json({ alreadyProcessed: result.data.alreadyProcessed }, { status: 200 });
}
