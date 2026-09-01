import type { NextRequest } from "next/server";
import { handleConnectorOauthCallback } from "@/lib/connectors/oauth-callback";
import { META_OAUTH_STATE_COOKIE } from "@/lib/connectors/meta-oauth-state";

export async function GET(request: NextRequest) {
  return handleConnectorOauthCallback(request, "META", META_OAUTH_STATE_COOKIE);
}
