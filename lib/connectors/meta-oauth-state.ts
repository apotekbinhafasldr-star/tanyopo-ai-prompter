/** Shared between the authorize and callback route handlers — kept out of
 * route.ts files since Next.js only expects HTTP-method exports there. */
export const META_OAUTH_STATE_COOKIE = "meta_oauth_state";
