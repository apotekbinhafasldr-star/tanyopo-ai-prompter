import type { NextRequest } from "next/server";
import { handleOAuthCallback } from "@/lib/connectors/oauth-route-helpers";

export async function GET(request: NextRequest) {
  return handleOAuthCallback("TIKTOK", request);
}
