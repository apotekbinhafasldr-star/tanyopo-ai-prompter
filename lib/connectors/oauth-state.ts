import { timingSafeEqual } from "node:crypto";

/**
 * Pure helpers for the OAuth `state` cookie shared by the Meta/TikTok/X
 * authorize + callback handlers. No Next.js / server-only imports so they are
 * directly unit-testable.
 *
 * Nothing here ever returns, stores or logs a `state`, cookie or code VALUE:
 * the only outputs are booleans, an allowlisted reason, and (on success) the
 * authorization code the caller already holds.
 */

/** Default lifetime of the state cookie. TikTok and X keep exactly this. */
export const DEFAULT_OAUTH_STATE_MAX_AGE_SECONDS = 300;

/**
 * Hard ceiling (15 minutes). A platform may ask for a longer cookie, but the
 * handler never issues one above this. Raising it needs explicit Founder
 * approval — change it here, deliberately, not by passing a bigger number.
 */
export const MAX_OAUTH_STATE_MAX_AGE_SECONDS = 900;

/** Falls back to the default for anything that is not a positive integer; clamps to the ceiling. */
export function resolveStateCookieMaxAge(requested?: number): number {
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested <= 0) {
    return DEFAULT_OAUTH_STATE_MAX_AGE_SECONDS;
  }
  return Math.min(requested, MAX_OAUTH_STATE_MAX_AGE_SECONDS);
}

export const STATE_REJECTION_REASONS = [
  "no_code",
  "no_state",
  "no_cookie",
  "state_mismatch",
  "tenant_mismatch",
] as const;

export type StateRejectionReason = (typeof STATE_REJECTION_REASONS)[number];

/** Which inputs were present — booleans only, never the values. */
export interface StatePresence {
  code: boolean;
  state: boolean;
  cookie: boolean;
}

export type StateCheckResult =
  | { ok: true; code: string }
  | { ok: false; reason: StateRejectionReason; present: StatePresence };

/**
 * Validates the callback against the cookie written by the authorize step.
 * Accepts exactly what the previous inline check accepted — a non-empty code,
 * a non-empty state equal to the cookie's state, and a cookie minted for this
 * same tenant — and only adds WHY a request was rejected. Reasons are reported
 * in a fixed order (the first failing check wins); `present` always carries
 * the full picture so a missing code is still visible when the cookie is also
 * missing.
 */
export function checkOauthState(input: {
  code: string | null;
  state: string | null;
  stateCookie: string | undefined;
  tenantId: string;
}): StateCheckResult {
  const { code, state, stateCookie, tenantId } = input;
  const present: StatePresence = { code: Boolean(code), state: Boolean(state), cookie: Boolean(stateCookie) };

  if (!code) return { ok: false, reason: "no_code", present };
  if (!state) return { ok: false, reason: "no_state", present };
  if (!stateCookie) return { ok: false, reason: "no_cookie", present };

  const [expectedState, expectedTenantId] = stateCookie.split(":");
  if (state !== expectedState) return { ok: false, reason: "state_mismatch", present };
  if (expectedTenantId !== tenantId) return { ok: false, reason: "tenant_mismatch", present };

  return { ok: true, code };
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636) verifier cookie — used only by connectors that declare
// `usesPkce` (X). The verifier is a secret: it lives ONLY in this httpOnly
// cookie, is never put in a URL, a redirect, a log line or an error code, and
// is deleted on the first callback (so a replayed callback has nothing to use).
// ---------------------------------------------------------------------------

/** RFC 7636 section 4.1: 43..128 characters of [A-Za-z0-9-._~]. We only mint base64url. */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

/** `x_oauth_state` -> `x_oauth_verifier`. Throws for a name that does not follow the convention. */
export function pkceVerifierCookieName(stateCookieName: string): string {
  if (!stateCookieName.endsWith("_state")) {
    throw new Error("State cookie name must end with _state.");
  }
  return `${stateCookieName.slice(0, -"_state".length)}_verifier`;
}

/**
 * Path the verifier cookie is limited to: ONLY the platform's callback route
 * (`/api/connections/x/callback`). The browser never sends it to any other
 * route of the app. A wrong path fails closed (cookie not sent -> no_verifier).
 */
export function pkceVerifierCookiePath(platform: string): string {
  return `/api/connections/${platform.toLowerCase()}/callback`;
}

/**
 * `state:tenantId:userId:verifier`. Binding the verifier to the state, the
 * tenant AND the user means a verifier minted for one authorization (or one
 * tenant, or one user) can never be used to finish another. Base64url and
 * UUIDs contain no `:`; anything else makes the cookie malformed (fail-closed).
 */
export function buildPkceVerifierCookieValue(input: {
  state: string;
  tenantId: string;
  userId: string;
  codeVerifier: string;
}): string {
  return `${input.state}:${input.tenantId}:${input.userId}:${input.codeVerifier}`;
}

export const PKCE_REJECTION_REASONS = [
  "no_verifier",
  "verifier_malformed",
  "verifier_state_mismatch",
  "verifier_tenant_mismatch",
  "verifier_user_mismatch",
] as const;

export type PkceRejectionReason = (typeof PKCE_REJECTION_REASONS)[number];

export type PkceCheckResult =
  | { ok: true; codeVerifier: string }
  | { ok: false; reason: PkceRejectionReason };

/** Constant-time string equality (length is not secret here). */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function checkPkceVerifier(input: {
  state: string;
  verifierCookie: string | undefined;
  tenantId: string;
  userId: string;
}): PkceCheckResult {
  const { state, verifierCookie, tenantId, userId } = input;
  if (!verifierCookie) return { ok: false, reason: "no_verifier" };

  const parts = verifierCookie.split(":");
  if (parts.length !== 4) return { ok: false, reason: "verifier_malformed" };
  const [boundState, boundTenantId, boundUserId, codeVerifier] = parts;
  if (!CODE_VERIFIER_PATTERN.test(codeVerifier)) return { ok: false, reason: "verifier_malformed" };
  if (!safeEqual(boundState, state)) return { ok: false, reason: "verifier_state_mismatch" };
  if (!safeEqual(boundTenantId, tenantId)) return { ok: false, reason: "verifier_tenant_mismatch" };
  if (!safeEqual(boundUserId, userId)) return { ok: false, reason: "verifier_user_mismatch" };
  return { ok: true, codeVerifier };
}
