/**
 * Detects whether a supabase.auth.signUp() response means "this email
 * already belongs to an account" rather than "a new account was created" —
 * relevant because this Supabase project is shared with UMKMpro AI, so a
 * LINOE registration can target an email that already has a confirmed
 * account there.
 *
 * Two distinct signals, both checked:
 * - An explicit error (422 / "user_already_exists") — some project
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
    return error.status === 422 || error.code === "user_already_exists";
  }

  return data?.user?.identities?.length === 0;
}
