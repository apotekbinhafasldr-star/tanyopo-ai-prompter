import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/health/readiness";

// Readiness probe for uptime monitors (UptimeRobot etc.). Unlike /api/health (liveness, static), this
// does one read-only, time-bounded database reachability check. It returns only {status:"ok"|"degraded"}
// (200 / 503): no error text, no version, no project reference, no PII, no writes. Exempted from login
// gating by one exact-match line in proxy.ts.
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  const status = await checkReadiness();
  return NextResponse.json({ status }, { status: status === "ok" ? 200 : 503, headers: HEADERS });
}
