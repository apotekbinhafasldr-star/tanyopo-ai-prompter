import type { NextRequest } from "next/server";
import { handleConnectorOauthCallback } from "@/lib/connectors/oauth-callback";
import { X_OAUTH_STATE_COOKIE } from "@/lib/connectors/x-oauth-state";

export async function GET(request: NextRequest) {
  return handleConnectorOauthCallback(request, "X", X_OAUTH_STATE_COOKIE);
}
