import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import {
  createDemoSessionToken,
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_TTL_MS,
  verifyDemoSessionToken,
} from "@/lib/demo/session";
import { checkDemoStartLimit, isNonNavigationRequest } from "@/lib/demo/start-guard";
import { getTrustedClientIp } from "@/lib/security/client-ip";

/**
 * "Coba Demo" entry point (Founder requirement #1 — Isolated Temporary Demo Session, low friction, no shared public
 * username/password).
 *
 * Issues a brand-new, per-visitor signed demo token and redirects into the demo. No Supabase auth call, no tenant
 * lookup, no database write — nothing here touches the real tenant/auth system.
 *
 * Abuse controls (docs/SOFT_LAUNCH_10_TENANTS.md, "Audit sesi demo"). All in-memory and per instance (lib/rate-limit.ts),
 * so they are a brake, not a guarantee; the real ceilings are the DB per-session AI cap and the provider spend limit.
 *  - Only navigations mint sessions: prefetch, sub-resource loads, HEAD and crawlers get 204 with no side effect and
 *    without spending quota (lib/demo/start-guard.ts).
 *  - A visitor who already holds a valid demo cookie is sent back in without minting a new session or spending quota,
 *    which also protects people behind shared carrier NAT from burning the shared IP's quota by re-clicking.
 *  - The IP comes only from `x-nf-client-connection-ip` (lib/security/client-ip.ts); `x-forwarded-for` is never trusted,
 *    so it can neither bypass the limit nor be used to lock out another visitor. No trusted IP = one shared, stricter bucket.
 *  - A global per-instance cap bounds total sessions even against an attacker with many IPs.
 * Not exported: a Next.js route file may only export route handlers and config.
 */
const NO_STORE = { "cache-control": "no-store" } as const;

function noSideEffect() {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

function redirectTo(request: NextRequest, path: string, search?: Record<string, string>) {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(search ?? {})) url.searchParams.set(key, value);
  return NextResponse.redirect(url, { headers: NO_STORE });
}

export async function HEAD() {
  return noSideEffect();
}

export async function GET(request: NextRequest) {
  if (isNonNavigationRequest(request.headers)) {
    return noSideEffect();
  }

  const secret = serverEnv.demo.sessionSecret;
  if (!secret) {
    return redirectTo(request, "/", { demo: "unavailable" });
  }

  const existing = verifyDemoSessionToken(request.cookies.get(DEMO_SESSION_COOKIE)?.value, secret);
  if (existing.ok) {
    return redirectTo(request, "/demo/dashboard");
  }

  if (!checkDemoStartLimit(getTrustedClientIp(request.headers)).allowed) {
    return redirectTo(request, "/", { demo: "busy" });
  }

  const token = createDemoSessionToken(secret);
  const response = redirectTo(request, "/demo/dashboard");

  response.cookies.set(DEMO_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(DEMO_SESSION_TTL_MS / 1000),
    path: "/",
  });

  return response;
}
