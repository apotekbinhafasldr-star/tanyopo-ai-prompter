import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ConnectorPlatform } from "@/lib/connectors/types";

/**
 * CSRF protection for the OAuth authorization-code flow (product spec
 * §32). The state value is generated at /start, stored in a short-lived
 * httpOnly cookie (set by the route handler, not here — cookie writes
 * only work from a Route Handler/Server Action response), and compared
 * byte-for-byte against the `state` query param the provider echoes back
 * to /callback. A mismatch or missing cookie means the callback is
 * rejected before any token exchange is attempted.
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}

export function oauthStateCookieName(platform: ConnectorPlatform): string {
  return `promoter_oauth_state_${platform.toLowerCase()}`;
}

export const OAUTH_STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes — long enough to complete a redirect flow, short enough to limit replay.

/** Constant-time comparison — never use `===` for CSRF token comparison. */
export function statesMatch(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || !received || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
