import type { NextRequest } from "next/server";
import { handleConnectorOauthCallback } from "@/lib/connectors/oauth-callback";
import { TIKTOK_OAUTH_STATE_COOKIE } from "@/lib/connectors/tiktok-oauth-state";

export async function GET(request: NextRequest) {
  return handleConnectorOauthCallback(request, "TIKTOK", TIKTOK_OAUTH_STATE_COOKIE);
}
