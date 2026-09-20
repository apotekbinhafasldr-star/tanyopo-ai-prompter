import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv, serverEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password"];
const AUTH_ONLY_PATHS = ["/login", "/register"];

export function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/v1/integrations") || // signed service auth, not cookie auth
    // Batch B11 hotfix — Xendit's callback is a server-to-server POST with
    // no Supabase session cookie; without this it was being bounced to
    // /login before app/api/webhooks/payment/route.ts ever ran. Its own
    // security is the x-callback-token verification inside that route
    // (unchanged) — same "signed service auth, not cookie auth" shape as
    // /api/v1/integrations above.
    pathname === "/api/webhooks/payment" ||
    pathname === "/favicon.ico" ||
    // Both handle their own auth (exchange a Supabase recovery/PKCE code,
    // or verify a token_hash) for a session — the request arrives with no
    // session cookie yet, so cookie gating below would otherwise bounce it
    // to /login before it can run. (B12 hotfix: /auth/confirm was added in
    // PR #7 but missed here, so a real signup-confirmation click was being
    // redirected to /login before app/auth/confirm/route.ts ever ran.)
    pathname === "/auth/callback" ||
    pathname === "/auth/confirm" ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/.test(pathname)
  );
}

/**
 * Batch B11 hotfix — app-level replacement for Netlify's non-production
 * Team Login (SSO) protection, which was found to gate every request at
 * the edge with no per-path exception mechanism (Netlify's own docs:
 * "private projects can't receive third-party webhooks"), permanently
 * blocking Xendit's callback from ever reaching this app. This runs only
 * for paths that reach past isPublicAsset() above, so
 * /api/webhooks/payment is never subject to it.
 *
 * A no-op (always returns true) unless BOTH env vars are set — they are
 * deliberately configured only on the Netlify "Deploy Preview" context,
 * never production, so this gate never activates there.
 */
export function hasValidBasicAuth(request: NextRequest): boolean {
  const { basicAuthUser, basicAuthPassword } = serverEnv.preview;
  if (!basicAuthUser || !basicAuthPassword) {
    return true;
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return false;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return false;
  }

  const suppliedUser = Buffer.from(decoded.slice(0, separatorIndex));
  const suppliedPassword = Buffer.from(decoded.slice(separatorIndex + 1));
  const expectedUser = Buffer.from(basicAuthUser);
  const expectedPassword = Buffer.from(basicAuthPassword);

  // Length-guard before timingSafeEqual (throws on mismatched length
  // otherwise) — same constant-time-comparison shape used by
  // lib/umkmpro/signature.ts and the Xendit adapter's webhook verification.
  const userMatches = suppliedUser.length === expectedUser.length && timingSafeEqual(suppliedUser, expectedUser);
  const passwordMatches =
    suppliedPassword.length === expectedPassword.length && timingSafeEqual(suppliedPassword, expectedPassword);

  return userMatches && passwordMatches;
}

/**
 * Refreshes the Supabase session cookie on every request and gates access
 * to authenticated areas of the app. Next.js 16 renamed `middleware.ts` to
 * `proxy.ts`; this file runs on the `nodejs` runtime (the only option in 16).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  if (!hasValidBasicAuth(request)) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="LINOE Preview"' },
    });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const isAuthOnlyPath = AUTH_ONLY_PATHS.includes(pathname);

  if (!user && !isPublicPath) {
    const redirectUrl = new URL("/login", request.url);
    // Preserve the query string too, not just the path — a UMKMpro handoff
    // redirect (e.g. /promote?handoff=<id>) would otherwise lose the
    // handoff id for a visitor who isn't logged into Promoter yet.
    redirectUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthOnlyPath) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
