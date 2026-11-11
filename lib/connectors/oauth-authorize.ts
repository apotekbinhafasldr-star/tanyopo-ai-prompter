import "server-only";

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { ConnectorConfigError } from "@/lib/connectors/types";
import { isTokenCipherConfigured } from "@/lib/crypto/token-cipher";
import {
  buildPkceVerifierCookieValue,
  pkceVerifierCookieName,
  resolveStateCookieMaxAge,
} from "@/lib/connectors/oauth-state";
import { isPkceConnector } from "@/lib/connectors/pkce-connector";
import { generatePkcePair, type XPkcePair } from "@/lib/connectors/x-pkce";
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
  options: { stateCookieMaxAgeSeconds?: number } = {},
): Promise<NextResponse> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return NextResponse.redirect(new URL("/connections?error=owner_required", request.url));
  }

  const connector = getConnector(platform);
  if (!connector) {
    return NextResponse.redirect(new URL("/connections?error=not_available", request.url));
  }

  // Fail before sending the owner to the platform: if tokens cannot be
  // encrypted at rest, the one-time authorization code would be consumed
  // by the callback with nowhere safe to store the result.
  if (!isTokenCipherConfigured()) {
    return NextResponse.redirect(new URL("/connections?error=encryption_not_configured", request.url));
  }

  try {
    const state = randomBytes(24).toString("base64url");

    let authorizationUrl: string;
    let pkce: XPkcePair | null = null;
    if (isPkceConnector(connector)) {
      // PKCE connector (X). Fail-closed: isConfigured() includes the wiring
      // flag, so while the flag is off nothing is generated, stored or sent.
      if (!connector.isConfigured()) {
        return NextResponse.redirect(new URL("/connections?error=not_configured", request.url));
      }
      pkce = generatePkcePair();
      // Only the S256 challenge goes into the URL; the verifier never does.
      authorizationUrl = connector.getAuthorizationUrlWithPkce(state, pkce.codeChallenge);
    } else {
      authorizationUrl = connector.getAuthorizationUrl(state);
    }

    const cookieStore = await cookies();
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      // 300 s unless the platform asks for longer (Meta: 900 s); never above
      // the ceiling in oauth-state.ts.
      maxAge: resolveStateCookieMaxAge(options.stateCookieMaxAgeSeconds),
      path: "/",
    };
    cookieStore.set(stateCookieName, `${state}:${session.tenantId}`, cookieOptions);
    if (pkce) {
      // Same lifetime and attributes as the state cookie; bound to state + tenant.
      cookieStore.set(
        pkceVerifierCookieName(stateCookieName),
        buildPkceVerifierCookieValue({ state, tenantId: session.tenantId, codeVerifier: pkce.codeVerifier }),
        cookieOptions,
      );
    }

    return NextResponse.redirect(authorizationUrl);
  } catch (err) {
    if (err instanceof ConnectorConfigError) {
      return NextResponse.redirect(new URL("/connections?error=not_configured", request.url));
    }
    throw err;
  }
}
