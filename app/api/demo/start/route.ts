import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createDemoSessionToken, DEMO_SESSION_COOKIE, DEMO_SESSION_TTL_MS } from "@/lib/demo/session";

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
