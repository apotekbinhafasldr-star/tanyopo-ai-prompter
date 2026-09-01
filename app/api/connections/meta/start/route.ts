import { handleOAuthStart } from "@/lib/connectors/oauth-route-helpers";

export async function GET() {
  return handleOAuthStart("META");
}
