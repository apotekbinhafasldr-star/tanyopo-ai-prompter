/**
 * Only ever resolves to a same-origin app path. A `next` value coming from a query string or a form field is
 * untrusted input — without this check a login link could be crafted to bounce a user off to an attacker's site
 * (`//evil.com`, `https://evil.com`) after they authenticate.
 *
 * Shared by loginAction and by the "already signed in" notice, so both apply exactly the same rule.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/dashboard";
  }
  return next;
}
