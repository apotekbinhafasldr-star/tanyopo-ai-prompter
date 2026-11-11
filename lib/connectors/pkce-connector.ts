import type { ConnectorTokenResult, PlatformConnector } from "@/lib/connectors/types";

/**
 * A connector whose OAuth needs PKCE (RFC 7636): X. Kept as a separate,
 * additive interface so `PlatformConnector` and every non-PKCE connector
 * (Meta/TikTok) stay untouched. The shared handlers branch on
 * `isPkceConnector`; a connector without `usesPkce` takes the old path
 * byte for byte.
 */
export interface PkceConnector extends PlatformConnector {
  readonly usesPkce: true;
  getAuthorizationUrlWithPkce(state: string, codeChallenge: string): string;
  exchangeCodeForTokenWithPkce(code: string, codeVerifier: string): Promise<ConnectorTokenResult>;
}

export function isPkceConnector(connector: PlatformConnector): connector is PkceConnector {
  const candidate = connector as Partial<PkceConnector>;
  return (
    candidate.usesPkce === true &&
    typeof candidate.getAuthorizationUrlWithPkce === "function" &&
    typeof candidate.exchangeCodeForTokenWithPkce === "function"
  );
}
