import { NextRequest, NextResponse } from "next/server";
import { buildDemoOptimization, parseScenario } from "@/lib/admin/demo-optimization";
import { isAdminCenterEnabled } from "@/lib/admin/flag";
import { calculationHash, rulesVersion } from "@/lib/tax-opt/approval";
import { decide, type DecisionKind, type RecommendationType } from "@/lib/tax-opt/decision";
import { runOptimization, type OptimizationInput } from "@/lib/tax-opt";
import { createDecisionStore } from "@/services/tax-optimization-approvals";
import { requireAdminPermission } from "@/services/platform-admin";

export const dynamic = "force-dynamic";

const hdr = { "Cache-Control": "no-store" };
const notFound = () => new NextResponse(null, { status: 404, headers: hdr });
const REC: readonly RecommendationType[] = ["SCHEME_SELECTION", "COST_TREATMENT", "CREDIT_CLAIM", "NOTICE_RESPONSE"];
const DEC: readonly DecisionKind[] = ["APPROVED", "REJECTED", "REVOKED"];
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : []);

/**
 * Founder decision on a final recommendation. POST only, same-origin only, flag-gated.
 * The decider is read from the server session; nothing in the body can name or change it.
 * The calculation is recomputed here and compared with what the Founder viewed.
 * Until real company data is wired in, the only data is the DEMO set and DEMO decisions are NEVER stored.
 */
export async function POST(request: NextRequest) {
  if (!isAdminCenterEnabled()) return notFound();
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return notFound();

  let principal;
  try {
    principal = await requireAdminPermission("tax.optimization.approve");
  } catch {
    return notFound();
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "INVALID", message: "Isi permintaan tidak valid." }, { status: 400, headers: hdr });
  }

  const recommendationType = REC.find((r) => r === body.recommendationType);
  const decision = DEC.find((d) => d === body.decision);
  if (!recommendationType || !decision) {
    return NextResponse.json({ code: "INVALID", message: "Jenis rekomendasi atau keputusan tidak valid." }, { status: 400, headers: hdr });
  }

  // Real data is not wired yet. DEMO data is never a basis for a stored decision.
  const loaded: OptimizationInput = buildDemoOptimization(parseScenario(str(body.scenario)));
  const input: OptimizationInput = loaded;
  if (input.demo) {
    return NextResponse.json({ code: "DEMO", message: "Data masih DEMO. Keputusan tidak disimpan." }, { status: 422, headers: hdr });
  }

  const result = runOptimization(input);
  const current = {
    calcHash: calculationHash({ input, result }),
    rulesVersion: rulesVersion(),
    figureStates: result.simulation.lines.map((l) => l.figure.state),
    openItems: result.openItems.length,
  };
  const out = await decide(
    principal,
    {
      requestId: str(body.requestId),
      recommendationType,
      taxYear: input.taxYear,
      items: strs(body.items),
      decision,
      reason: str(body.reason),
      viewed: { calcHash: str(body.viewedCalcHash), rulesVersion: str(body.viewedRulesVersion) },
      current,
      evidenceRefs: strs(body.evidenceRefs),
      accountantVerificationRef: typeof body.accountantVerificationRef === "string" ? body.accountantVerificationRef : null,
      expectedSeq: typeof body.expectedSeq === "number" ? body.expectedSeq : -1,
    },
    createDecisionStore(),
  );
  if (out.ok) return NextResponse.json({ ok: true, id: out.id }, { status: 201, headers: hdr });
  const status = out.code === "FORBIDDEN" ? 403 : out.code === "CONFLICT" || out.code === "STALE" ? 409 : out.code === "UNAVAILABLE" ? 503 : 422;
  return NextResponse.json({ code: out.code, message: out.message }, { status, headers: hdr });
}
