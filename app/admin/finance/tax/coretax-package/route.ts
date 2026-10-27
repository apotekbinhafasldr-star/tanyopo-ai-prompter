import { NextRequest, NextResponse } from "next/server";
import { buildDemoAccounting, buildDemoFiscal, DEMO_TODAY, DEMO_YEAR } from "@/lib/admin/demo-accounting";
import { isAdminCenterEnabled } from "@/lib/admin/flag";
import { UNVERIFIED_TAX_CONFIG, turnoverRecap } from "@/lib/finance";
import { buildDemoOptimization } from "@/lib/admin/demo-optimization";
import { runOptimization } from "@/lib/tax-opt";
import { buildCoretaxPackage } from "@/lib/coretax/package";
import { recordAdminAudit } from "@/services/admin-audit";
import { requireAdminPermission } from "@/services/platform-admin";

export const dynamic = "force-dynamic";

const notFound = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * POST only (a link prefetch or preview must never prepare a package). Same-origin only.
 * Authority is re-checked here on the server: the page hiding the button is not a control.
 * Only builds a support package: it never logs in to Coretax, files an SPT or pays tax.
 */
export async function POST(request: NextRequest) {
  if (!isAdminCenterEnabled()) return notFound();

  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return notFound();

  let principal;
  try {
    principal = await requireAdminPermission("tax.export");
    await requireAdminPermission("accounting.view");
  } catch {
    return notFound();
  }

  // Until the finance migration is approved and applied, the only data available is the DEMO set.
  const demo = true;
  const data = buildDemoAccounting();
  const generatedAt = new Date().toISOString();

  const audited = await recordAdminAudit({
    actorId: principal.userId,
    action: "coretax_package.prepare",
    entityType: "coretax_package",
    entityId: DEMO_YEAR,
    details: { demo, year: DEMO_YEAR },
  });
  // Real-data exports fail closed if the audit write fails. DEMO carries no real data.
  if (!audited && !demo) {
    return NextResponse.json({ error: "Audit log unavailable; export blocked" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const result = buildCoretaxPackage({
    ledger: data.ledger,
    range: { from: `${DEMO_YEAR}-01-01`, to: DEMO_TODAY },
    year: DEMO_YEAR,
    turnover: turnoverRecap(data.snapshot, DEMO_YEAR, UNVERIFIED_TAX_CONFIG),
    fiscal: buildDemoFiscal(data.ledger),
    taxPayments: [],
    generatedAt,
    generatedBy: principal.userId,
    demo,
    entityName: "PT Tanyopo Future Technology",
    optimization: runOptimization(buildDemoOptimization("nyata")),
  });

  return new NextResponse(Buffer.from(result.zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Package-Status": "DRAFT",
    },
  });
}
