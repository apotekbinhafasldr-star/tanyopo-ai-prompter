import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/", "/login", "/register"];
const AUTH_ONLY_PATHS = ["/login", "/register"];

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/v1/integrations") || // signed service auth, not cookie auth
    pathname === "/favicon.ico" ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/.test(pathname)
  );
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
