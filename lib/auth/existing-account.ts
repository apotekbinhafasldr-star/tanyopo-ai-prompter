/**
 * Detects whether a supabase.auth.signUp() response means "this email
 * already belongs to an account" rather than "a new account was created" —
 * relevant because this Supabase project is shared with UMKMpro AI, so a
 * LINOE registration can target an email that already has a confirmed
 * account there.
 *
 * Two distinct signals, both checked:
 * - An explicit error with code "user_already_exists" or "email_exists" — some project
 *   configurations return this directly.
 * - No error, but `data.user.identities` is an empty array — Supabase's
 *   documented, side-channel-safe way of signalling "already registered"
 *   for a project with "Confirm email" enabled: signUp() still returns a
 *   user-shaped object (never overwriting the existing account) instead of
 *   a distinguishable error, so a network observer can't fingerprint the
 *   difference between a fresh signup and a duplicate one.
 *
 * Pure and synchronous so this detection logic — the entire point of the
 * shared-Supabase-identity fix — has direct test coverage without mocking
 * the Supabase client.
 */
export function isExistingAccountSignUp(
  error: { status?: number; code?: string } | null,
  data: { user: { identities?: unknown[] | null } | null } | null,
): boolean {
  if (error) {
    // Decided by the error CODE only, never by HTTP status: a 422 also carries unrelated failures such as
    // weak_password or signup_disabled, and calling those "email already registered" is both wrong and a dead end.
    // Both codes are in the official Supabase Auth error-code list (auth-js ErrorCode): `user_already_exists` and
    // `email_exists`. An error without a code is never treated as an existing account.
    return error.code === "user_already_exists" || error.code === "email_exists";
  }

  return data?.user?.identities?.length === 0;
}
