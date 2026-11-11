/**
 * Google Search Console readiness (meta-tag verification method).
 *
 * The file-based method (google<token>.html) would need a proxy.ts allowlist entry and is NOT used. The meta tag
 * is rendered through Next's `metadata.verification.google` only when the owner sets
 * NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION to the `content` value that Search Console shows. Nothing is rendered when
 * it is unset or malformed, so no placeholder token is ever published.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export function googleSiteVerification(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  return raw && TOKEN_RE.test(raw) ? raw : undefined;
}
