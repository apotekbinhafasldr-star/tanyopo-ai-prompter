import { UNCONFIRMED_LOGIN_MESSAGE } from "@/lib/auth/confirm-notice";

export interface MappedLoginError {
  message: string;
  /** True only for Supabase's `email_not_confirmed` (correct password, address not yet confirmed). */
  unconfirmed: boolean;
}

/**
 * Maps a signInWithPassword error to the message shown on the login form. `email_not_confirmed` is only returned by
 * Supabase when the password was right, so naming it does not let anyone probe which addresses exist.
 */
export function mapLoginError(error: { status?: number; code?: string }): MappedLoginError {
  if (error.code === "email_not_confirmed") {
    return { message: UNCONFIRMED_LOGIN_MESSAGE, unconfirmed: true };
  }
  return {
    message: error.status === 400 ? "Email atau kata sandi salah." : "Gagal masuk. Silakan coba lagi.",
    unconfirmed: false,
  };
}
