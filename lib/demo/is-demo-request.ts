import "server-only";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";
import { DEMO_SESSION_COOKIE, verifyDemoSessionToken, type DemoSessionPayload } from "@/lib/demo/session";

/**
 * Server-only helper for the `/demo/*` route tree. Never resolves a real
 * Supabase session, never queries `tenants`/`user_profiles`/any
 * `prompter_*` table — a demo page's only source of identity is this
 * signed, tenant-less cookie.
 */
export async function getDemoSession(): Promise<DemoSessionPayload | null> {
  if (!serverEnv.demo.sessionSecret) {
    return null;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(DEMO_SESSION_COOKIE)?.value;
  const result = verifyDemoSessionToken(token, serverEnv.demo.sessionSecret);
  return result.ok ? result.session : null;
}

/** Redirects to /demo (which re-issues a fresh session) when there is no valid one. */
export async function requireDemoSession(): Promise<DemoSessionPayload> {
  const session = await getDemoSession();
  if (!session) {
    redirect("/demo");
  }
  return session;
}
