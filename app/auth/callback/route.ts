import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges a Supabase PKCE `code` (from a password-recovery email link
 * today; general-purpose so a future signup-confirmation redirect can reuse
 * it) for a session, then redirects on to `next`. An expired/invalid/reused
 * link fails the exchange — that's handled explicitly rather than letting a
 * broken code silently land the user on a page that assumes a session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

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
