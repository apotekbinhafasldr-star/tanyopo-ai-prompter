/** Shared between the authorize and callback route handlers — kept out of
 * route.ts files since Next.js only expects HTTP-method exports there. */
export const META_OAUTH_STATE_COOKIE = "meta_oauth_state";

/**
 * Meta only: Facebook Login for Business on a phone (page selection, business
 * asset approval, confirmation screen) routinely takes longer than the 5
 * minutes the other connectors use. 15 minutes is also the ceiling the shared
 * handler enforces (lib/connectors/oauth-state.ts); do not raise it without
 * Founder approval.
 */
export const META_OAUTH_STATE_MAX_AGE_SECONDS = 900;
