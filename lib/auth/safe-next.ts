const FALLBACK = "/dashboard";
// ASCII control characters: NUL..US and DEL. Browsers strip TAB / LF / CR when they parse a URL, so
// "/<TAB>/evil.com" is read as "//evil.com" (an off-site address) even though it starts with a single "/".
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const PROBE_ORIGIN = "http://safe-next.invalid";

/**
 * Only ever resolves to a same-origin app path. A `next` value coming from a query string or a form field is
 * untrusted input — without this check a login link could be crafted to bounce a user off to an attacker's site
 * (`//evil.com`, `https://evil.com`, `/\evil.com`, `/<TAB>/evil.com`) after they authenticate.
 *
 * Three independent layers, all of which must pass:
 *  1. shape: a string starting with a single "/", no "//" prefix, no backslash, no ASCII control character;
 *  2. the value is parsed the way a browser parses it (WHATWG URL against a probe origin) and must stay on that
 *     origin — this catches any remaining trick the string checks did not think of;
 *  3. anything that fails falls back to /dashboard.
 *
 * Shared by loginAction and by the "already signed in" notice, so both apply exactly the same rule.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return FALLBACK;
  if (!next.startsWith("/") || next.startsWith("//")) return FALLBACK;
  if (next.includes("\\") || CONTROL_CHARS.test(next)) return FALLBACK;

  let parsed: URL;
  try {
    parsed = new URL(next, PROBE_ORIGIN);
  } catch {
    return FALLBACK;
  }
  if (parsed.origin !== PROBE_ORIGIN || !parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//")) {
    return FALLBACK;
  }

  return next;
}
