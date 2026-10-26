/**
 * Canonical public origin for SEO surfaces (robots.txt, sitemap.xml).
 *
 * Never returns localhost: `NEXT_PUBLIC_APP_URL` defaults to http://localhost:3000 elsewhere in the app
 * (lib/env.ts), which would leak into a production sitemap. Order of preference:
 *   1. NEXT_PUBLIC_APP_URL  (the app's configured public URL), if it is a valid public https origin
 *   2. URL                  (set by Netlify to the site's primary address at build/run time), same rule
 *   3. PRODUCTION_ORIGIN    (the production site address, last resort)
 * Only the origin is used; any path, query or hash on the configured value is dropped.
 */
export const PRODUCTION_ORIGIN = "https://tanyopo-ai-prompter.netlify.app";

function toPublicHttpsOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]" || host.endsWith(".local")) {
    return null;
  }
  return url.origin;
}

export function getSiteOrigin(env: Record<string, string | undefined> = process.env): string {
  return toPublicHttpsOrigin(env.NEXT_PUBLIC_APP_URL) ?? toPublicHttpsOrigin(env.URL) ?? PRODUCTION_ORIGIN;
}
