import type { NextRequest } from "next/server";
import { handleConnectorOauthAuthorize } from "@/lib/connectors/oauth-authorize";
import { TIKTOK_OAUTH_STATE_COOKIE } from "@/lib/connectors/tiktok-oauth-state";

export async function GET(request: NextRequest) {
  return handleConnectorOauthAuthorize(request, "TIKTOK", TIKTOK_OAUTH_STATE_COOKIE);
}
