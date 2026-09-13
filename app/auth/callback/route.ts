import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges a Supabase PKCE `code` (from a password-recovery email link —
 * forgotPasswordAction is this route's only caller) for a session, then
 * redirects on to `next`. An expired/invalid/reused link fails the
 * exchange — that's handled explicitly rather than letting a broken code
 * silently land the user on a page that assumes a session.
 *
 * `next` defaults to /reset-password since forgotPasswordAction never
 * passes one — its own `redirectTo` must be the bare URL with no query to
 * match the production project's single, exact (non-wildcarded) Redirect
 * URLs entry (see features/auth/actions.ts). Signup confirmation uses a
 * different route (app/auth/confirm/route.ts) for exactly this reason —
 * it needs to send a distinct `next` per email without touching this
 * exact-match constraint.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/reset-password";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/forgot-password?error=expired`,
  );
}
