import { NextResponse, type NextRequest } from "next/server";
import { handleConnectorOauthAuthorize } from "@/lib/connectors/oauth-authorize";
import { getConnector } from "@/lib/connectors/get-connector";
import { canStartOauth } from "@/lib/connectors/connection-readiness";
import { TIKTOK_OAUTH_STATE_COOKIE } from "@/lib/connectors/tiktok-oauth-state";

export async function GET(request: NextRequest) {
  // Fail-closed, same rule as the Connections page: the UI hides the button for
  // TikTok, so a direct visit to this URL must not start OAuth either until the
  // provider gate in lib/connectors/connection-readiness.ts is opened.
  const connector = getConnector("TIKTOK");
  if (!connector) {
    return NextResponse.redirect(new URL("/connections?error=not_available", request.url));
  }
  const configured = connector.isConfigured();
  if (!configured) {
    return NextResponse.redirect(new URL("/connections?error=not_configured", request.url));
  }
  if (!canStartOauth("TIKTOK", { connectorExists: true, configured })) {
    return NextResponse.redirect(new URL("/connections?error=provider_pending", request.url));
  }
  return handleConnectorOauthAuthorize(request, "TIKTOK", TIKTOK_OAUTH_STATE_COOKIE);
}
