import type { NextRequest } from "next/server";
import { handleConnectorOauthAuthorize } from "@/lib/connectors/oauth-authorize";
import { META_OAUTH_STATE_COOKIE } from "@/lib/connectors/meta-oauth-state";

export async function GET(request: NextRequest) {
  return handleConnectorOauthAuthorize(request, "META", META_OAUTH_STATE_COOKIE);
}
