import "server-only";

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { ConnectorConfigError } from "@/lib/connectors/types";
import type { ConnectorPlatform } from "@/types/database";

/**
 * Shared "start OAuth" handler for every ad-platform connector
 * (Meta/TikTok/X — product spec §62). Connecting an ad account is
 * owner-gated (checked here, and independently enforced by RLS on
 * prompter_connected_accounts, since the callback writes through the
 * admin client which bypasses RLS). Extracted once three platforms
 * needed the identical flow rather than duplicating it per platform.
 */
export async function handleConnectorOauthAuthorize(
  request: NextRequest,
  platform: ConnectorPlatform,
  stateCookieName: string,
): Promise<NextResponse> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return NextResponse.redirect(new URL("/connections?error=owner_required", request.url));
  }

  const connector = getConnector(platform);
  if (!connector) {
    return NextResponse.redirect(new URL("/connections?error=not_available", request.url));
  }

  try {
    const state = randomBytes(24).toString("base64url");
    const authorizationUrl = connector.getAuthorizationUrl(state);

    const cookieStore = await cookies();
    cookieStore.set(stateCookieName, `${state}:${session.tenantId}`, {
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
