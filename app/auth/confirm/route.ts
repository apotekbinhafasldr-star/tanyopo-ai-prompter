import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles Supabase's token_hash-based OTP verification link — used for
 * signup email confirmation specifically because it lets the "Confirm
 * signup" template (Supabase Dashboard → Authentication → Email
 * Templates) embed its own `type` and `next` directly:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/onboarding
 *
 * That link goes straight to this app's own domain and never passes
 * through Supabase's own redirect step, so it isn't subject to the
 * Redirect URLs allow-list's exact-match check — unlike the PKCE
 * `/auth/callback` route (used for password recovery), where the
 * production project's single, non-wildcarded allow-list entry means any
 * redirectTo carrying a query string would silently fail to match and
 * fall back to the Site URL instead.
 *
 * This route does nothing until that email template is updated — until
 * then, signup confirmation still uses Supabase's default
 * {{ .ConfirmationURL }} link, which never reaches this path.
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  return next;
}

export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // An expired/invalid/reused token fails verifyOtp — sent to /login
  // rather than a page that assumes a session or a recovery-flavored
  // "request a new link" form that doesn't apply to a failed signup
  // confirmation.
  return NextResponse.redirect(`${origin}/login`);
}
