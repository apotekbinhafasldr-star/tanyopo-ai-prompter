/**
 * C3 — which origin a checkout may send the payer back to. The raw `Origin` header is NEVER trusted by itself: it is
 * used only when it is, character for character, one of the origins this deployment is known to be served from.
 * Anything else (another host, http://, a path, a userinfo trick, garbage) falls back to the configured app URL.
 *
 * Allowed origins: the configured public app URL, any extra origins listed in CHECKOUT_ALLOWED_ORIGINS
 * (comma-separated, https only) and the deployment URLs Netlify itself injects (DEPLOY_PRIME_URL / DEPLOY_URL), which is
 * what keeps Deploy Previews working (Batch B11 hotfix) without trusting a header. Pure function: no env access.
 */
export interface CheckoutOriginConfig {
  appUrl: string;
  extraOrigins?: string | undefined;
  deployUrls?: Array<string | undefined>;
}

/** Normalises a URL string to an https origin, or null when it is not a plain https origin. */
function httpsOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function allowedCheckoutOrigins(config: CheckoutOriginConfig): Set<string> {
  const allowed = new Set<string>();
  const app = httpsOrigin(config.appUrl);
  if (app) allowed.add(app);
  for (const item of (config.extraOrigins ?? "").split(",")) {
    const origin = httpsOrigin(item);
    if (origin) allowed.add(origin);
  }
  for (const item of config.deployUrls ?? []) {
    const origin = httpsOrigin(item);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

/** Returns the header origin only when it is allowlisted and already in canonical form; otherwise the app URL. */
export function resolveCheckoutOriginFromHeader(headerOrigin: string | null, config: CheckoutOriginConfig): string {
  const candidate = httpsOrigin(headerOrigin);
  if (candidate && headerOrigin === candidate && allowedCheckoutOrigins(config).has(candidate)) {
    return candidate;
  }
  return config.appUrl.replace(/\/+$/, "");
}
