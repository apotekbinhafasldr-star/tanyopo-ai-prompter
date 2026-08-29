import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { ConnectorConfigError } from "@/lib/connectors/types";
import { META_OAUTH_STATE_COOKIE } from "@/lib/connectors/meta-oauth-state";

/**
 * Starts the Meta OAuth flow. Connecting an ad account is owner-gated
 * (product spec §62 — STAFF must not connect ad accounts without
 * authorization), checked here in addition to the DB-level RLS restriction
 * on prompter_connected_accounts, since the callback writes through the
 * admin client (which bypasses RLS) to reach prompter_oauth_credentials.
 */
export async function GET(request: NextRequest) {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return NextResponse.redirect(new URL("/connections?error=owner_required", request.url));
  }

  const connector = getConnector("META");
  if (!connector) {
    return NextResponse.redirect(new URL("/connections?error=not_available", request.url));
  }

  try {
    const state = randomBytes(24).toString("base64url");
    const authorizationUrl = connector.getAuthorizationUrl(state);

    const cookieStore = await cookies();
    cookieStore.set(META_OAUTH_STATE_COOKIE, `${state}:${session.tenantId}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 300,
      path: "/",
    });

    return NextResponse.redirect(authorizationUrl);
  } catch (err) {
    if (err instanceof ConnectorConfigError) {
      return NextResponse.redirect(new URL("/connections?error=not_configured", request.url));
    }
    throw err;
  }
}
