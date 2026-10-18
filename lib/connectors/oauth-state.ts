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
