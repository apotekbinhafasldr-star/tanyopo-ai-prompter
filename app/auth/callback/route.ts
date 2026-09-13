import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges a Supabase PKCE `code` for a session, then redirects on to
 * `next`. An expired/invalid/reused link fails the exchange — that's
 * handled explicitly rather than letting a broken code silently land the
 * user on a page that assumes a session.
 *
 * Two callers, both in features/auth/actions.ts:
 * - forgotPasswordAction never passes `next` (its own `redirectTo` must be
 *   the bare allow-listed URL with no query, or it fails Supabase's
 *   exact-match check against the Redirect URLs allow list) — this route's
 *   default of /reset-password covers that case.
 * - registerAction explicitly sends `?next=/onboarding`, so a freshly
 *   confirmed signup lands in onboarding rather than a password-recovery
 *   screen meant for the other caller. (Requires the Supabase project's
 *   Redirect URLs entry for this route to allow a trailing `**` wildcard,
 *   e.g. `.../auth/callback**`, so the query string still matches.)
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
