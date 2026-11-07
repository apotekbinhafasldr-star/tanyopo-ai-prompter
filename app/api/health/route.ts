import { NextResponse } from "next/server";

// Liveness probe for uptime monitors (UptimeRobot etc.). Deliberately static and
// dependency-free: no env, no database, no version, no auth. It answers "is the
// app process serving requests", nothing more. Exempted from login gating in proxy.ts.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
