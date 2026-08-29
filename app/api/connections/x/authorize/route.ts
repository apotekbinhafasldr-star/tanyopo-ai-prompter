import type { NextRequest } from "next/server";
import { handleConnectorOauthAuthorize } from "@/lib/connectors/oauth-authorize";
import { X_OAUTH_STATE_COOKIE } from "@/lib/connectors/x-oauth-state";

export async function GET(request: NextRequest) {
  return handleConnectorOauthAuthorize(request, "X", X_OAUTH_STATE_COOKIE);
}
