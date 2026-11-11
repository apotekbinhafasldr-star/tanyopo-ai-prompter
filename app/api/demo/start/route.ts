import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createDemoSessionToken, DEMO_SESSION_COOKIE, DEMO_SESSION_TTL_MS } from "@/lib/demo/session";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Soft-launch hardening (docs/SOFT_LAUNCH_10_TENANTS.md, P0-1). Every demo session gets its own hard cap of real AI
 * calls (lib/demo/ai-usage.ts), but sessions themselves were free to mint, so the AI cost ceiling was only per
 * session, not per visitor. This best-effort per-IP limit on session creation bounds that. It is in-memory (see
 * lib/rate-limit.ts: per instance, resets on deploy), so it is a brake, not a guarantee; the provider-side spend cap
 * remains the real ceiling. Not exported: a Next.js route file may only export route handlers and config.
 */
const DEMO_START_RATE_LIMIT = 10;
const DEMO_START_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * "Coba Demo" entry point (Founder requirement #1 — Isolated Temporary
 * Demo Session, low friction, no shared public username/password).
 *
 * Issues a brand-new, per-visitor signed demo token and redirects into
 * the demo. No Supabase auth call, no tenant lookup, no database write —
 * this route cannot fail because of anything in the real tenant/auth
 * system, and has nothing to roll back if it does fail.
 */
export async function GET(request: NextRequest) {
  if (!serverEnv.demo.sessionSecret) {
    const url = new URL("/", request.url);
    url.searchParams.set("demo", "unavailable");
    return NextResponse.redirect(url);
  }

  const clientIp = getClientIp(request.headers);
  if (!checkRateLimit(`demo-start:${clientIp}`, DEMO_START_RATE_LIMIT, DEMO_START_RATE_LIMIT_WINDOW_MS).allowed) {
    const url = new URL("/", request.url);
    url.searchParams.set("demo", "busy");
    return NextResponse.redirect(url);
  }

  const token = createDemoSessionToken(serverEnv.demo.sessionSecret);
  const response = NextResponse.redirect(new URL("/demo/dashboard", request.url));

  response.cookies.set(DEMO_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(DEMO_SESSION_TTL_MS / 1000),
    path: "/",
  });

  return response;
}
