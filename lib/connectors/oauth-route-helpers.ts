import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { requireSessionContext } from "@/services/session";
import { getConnector } from "@/lib/connectors/get-connector";
import { oauthStateCookieName, OAUTH_STATE_COOKIE_MAX_AGE_SECONDS } from "@/lib/connectors/oauth-state";
import { isAllowedToManageConnections } from "@/lib/connectors/authorize";
import type { ConnectorPlatform } from "@/lib/connectors/types";

interface StateCookiePayload {
  state: string;
  codeVerifier?: string;
}

/**
 * Shared body for every /api/connections/{platform}/start route — the
 * only platform-specific piece call sites provide is which connector to
 * ask. Requires an authenticated, onboarded session (allowIncompleteOnboarding
 * so a tenant can connect a platform before finishing onboarding, matching
 * the rest of Connection Center's read access).
 *
 * Every actual write this flow leads to (handleOAuthCallback below, and
 * disconnect/verify in features/connections/actions.ts) goes through the
 * service-role client, which bypasses RLS — so prompter_connected_accounts'
 * own "Owner kelola koneksi platform" policy (owner-only writes) is not
 * enforced by the database for these calls. This role check is what makes
 * that restriction real again at the only layer that can.
 */
export async function handleOAuthStart(platform: ConnectorPlatform): Promise<NextResponse> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  if (!isAllowedToManageConnections(session.role)) {
    return NextResponse.redirect(
      new URL(`/connections?error=FORBIDDEN&platform=${platform}`, publicEnv.appUrl),
    );
  }

  const connector = getConnector(platform);
  const result = connector.buildAuthorizationUrl(session.tenantId);

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/connections?error=${result.reason}&platform=${platform}`, publicEnv.appUrl),
    );
  }

  const response = NextResponse.redirect(result.data.authorizationUrl);
  const payload: StateCookiePayload = { state: result.data.state, codeVerifier: result.data.codeVerifier };
  response.cookies.set(oauthStateCookieName(platform), JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: OAUTH_STATE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}

/**
 * Shared body for every /api/connections/{platform}/callback route. See
 * handleOAuthStart's docstring — this is the actual mutating step
 * (connector.handleCallback writes prompter_connected_accounts and
 * prompter_oauth_credentials via the service-role client), so the
 * owner-only check here is the real enforcement point.
 */
export async function handleOAuthCallback(
  platform: ConnectorPlatform,
  request: NextRequest,
): Promise<NextResponse> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  if (!isAllowedToManageConnections(session.role)) {
    return NextResponse.redirect(
      new URL(`/connections?error=FORBIDDEN&platform=${platform}`, publicEnv.appUrl),
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  const cookieName = oauthStateCookieName(platform);
  const rawCookie = request.cookies.get(cookieName)?.value;
  let expectedState: string | undefined;
  let codeVerifier: string | undefined;
  if (rawCookie) {
    try {
      const parsed = JSON.parse(rawCookie) as StateCookiePayload;
      expectedState = parsed.state;
      codeVerifier = parsed.codeVerifier;
    } catch {
      // Malformed cookie — treated the same as a missing one below.
    }
  }

  const redirectTo = (query: string) => NextResponse.redirect(new URL(`/connections?${query}`, publicEnv.appUrl));

  if (providerError) {
    return redirectTo(`error=provider_denied&platform=${platform}`);
  }
  if (!code || !state || !expectedState) {
    return redirectTo(`error=missing_params&platform=${platform}`);
  }

  const connector = getConnector(platform);
  const result = await connector.handleCallback({
    tenantId: session.tenantId,
    code,
    state,
    expectedState,
    codeVerifier,
  });

  const response = result.ok
    ? redirectTo(`connected=${platform}`)
    : redirectTo(`error=${result.reason}&platform=${platform}`);
  response.cookies.delete(cookieName);
  return response;
}
