/**
 * DOKU sandbox ↔ database guard (pure, no I/O, no secrets logged).
 *
 * Problem: the DOKU adapter only talks to the DOKU SANDBOX. If it were switched on in a deploy whose Supabase client points
 * at the shared PRODUCTION project (umkmpro-ai, shared with PUBLOE/UMKMpro), a sandbox "payment" (fake money) would
 * activate a real subscription there. An environment name or a deploy label proves nothing about that, so this guard looks at the
 * database identity itself, fail-closed.
 *
 * What is derived (server-side, from the same URL `createAdminClient()` actually connects to):
 *   - the Supabase project ref = the first label of `https://<ref>.supabase.co`. The admin client's target IS that host, so
 *     this cannot diverge from the database that would be written; no label, flag or deploy name is trusted.
 *   - when the service-role key is a legacy JWT, its signed `ref` claim must equal the URL's ref (a mismatch means a
 *     mis-wired deploy). New-style `sb_secret_…` keys carry no ref; the check is then skipped (it never relaxes the rest).
 *
 * The adapter is allowed ONLY when ALL hold:
 *   1. the URL is a standard `https://<20-char ref>.supabase.co` host (custom domains / localhost / placeholders ⇒ identity
 *      unprovable ⇒ OFF),
 *   2. the ref is NOT a known production project (hard-coded deny-list below),
 *   3. the ref is explicitly opted in through the sandbox allow-list setting read in lib/env.ts (empty ⇒ OFF).
 *
 * Limit (documented, not hidden): this proves WHICH project the server is connected to, not that the database content is
 * a throw-away copy. A database-side attestation (a marker row/function) would be stronger but needs a migration, which
 * is outside this PR (see docs/BILLING_DOKU_SANDBOX_ADAPTER.md, blocker B-DB).
 */

/** Known production Supabase project refs. A ref listed here can NEVER run DOKU sandbox payments, even if allow-listed. */
export const PRODUCTION_SUPABASE_REFS: readonly string[] = ["wjjyqovhmwenbcvbnkgx"]; // umkmpro-ai (shared with PUBLOE/UMKMpro)

const PROJECT_HOST_PATTERN = /^([a-z0-9]{20})\.supabase\.co$/;
const REF_PATTERN = /^[a-z0-9]{20}$/;

export type SandboxDbGuardResult = { ok: true; ref: string } | { ok: false; reason: string };

/** Project ref of a standard Supabase URL, or null when it cannot be proven (anything but https://<ref>.supabase.co[/]). */
export function projectRefFromSupabaseUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const match = PROJECT_HOST_PATTERN.exec(url.hostname.toLowerCase());
  return match ? match[1] : null;
}

/** `ref` claim of a legacy JWT service key (payload only, signature is Supabase's to check). null if not a JWT / no claim. */
function refClaimOfJwt(key: string | undefined): string | null | "NOT_JWT" {
  if (!key) return "NOT_JWT";
  const parts = key.split(".");
  if (parts.length !== 3) return "NOT_JWT";
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload === "object" && payload !== null && "ref" in payload) {
      const ref = (payload as { ref?: unknown }).ref;
      return typeof ref === "string" ? ref.toLowerCase() : null;
    }
    return null;
  } catch {
    return "NOT_JWT";
  }
}

export function evaluateSandboxDbGuard(input: {
  supabaseUrl: string | undefined;
  allowedRefs: string | undefined;
  serviceKey?: string | undefined;
}): SandboxDbGuardResult {
  const ref = projectRefFromSupabaseUrl(input.supabaseUrl);
  if (!ref) return { ok: false, reason: "DB_IDENTITY_UNPROVABLE" };
  if (PRODUCTION_SUPABASE_REFS.includes(ref)) return { ok: false, reason: "DB_IS_PRODUCTION" };

  const allowed = (input.allowedRefs ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  if (allowed.length === 0 || allowed.some((item) => !REF_PATTERN.test(item))) return { ok: false, reason: "DB_NOT_ALLOWLISTED" };
  // A production ref in the allow-list is a configuration error: refuse everything instead of guessing.
  if (allowed.some((item) => PRODUCTION_SUPABASE_REFS.includes(item))) return { ok: false, reason: "ALLOWLIST_HAS_PRODUCTION" };
  if (!allowed.includes(ref)) return { ok: false, reason: "DB_NOT_ALLOWLISTED" };

  const claim = refClaimOfJwt(input.serviceKey);
  if (claim !== "NOT_JWT" && claim !== ref) return { ok: false, reason: "KEY_PROJECT_MISMATCH" };
  return { ok: true, ref };
}
