/** Shared between the authorize and callback route handlers — kept out of
 * route.ts files since Next.js only expects HTTP-method exports there. */
export const X_OAUTH_STATE_COOKIE = "x_oauth_state";
