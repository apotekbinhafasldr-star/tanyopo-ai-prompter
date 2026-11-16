/**
 * Auth recovery messages (signup confirmation). Pure helpers shared by the login page and the login action.
 *
 * Design: a confirmation link is only re-sent from loginAction, and only after Supabase refused a sign-in with
 * `email_not_confirmed`, which it returns only when the PASSWORD was correct. There is no anonymous "resend to this
 * address" endpoint. This proves the caller knows the account's password; it is NOT tenant isolation: an unconfirmed
 * account created by another product on the shared Supabase project can also be re-sent a link by whoever holds its
 * credentials (its owner).
 */
export type ConfirmNoticeCode = "link_expired" | "link_invalid";

export const CONFIRM_NOTICE_MESSAGES: Record<ConfirmNoticeCode, string> = {
  link_expired:
    "Tautan konfirmasi sudah kedaluwarsa. Masuk dengan email dan kata sandi Anda: jika email belum dikonfirmasi, kami " +
    "kirim tautan baru. Jika akun sudah aktif, Anda langsung masuk.",
  link_invalid:
    "Tautan konfirmasi tidak berlaku. Bisa jadi sudah dipakai atau terbuka otomatis oleh aplikasi email Anda. Coba " +
    "masuk dengan email dan kata sandi: jika akun sudah aktif Anda langsung masuk, jika belum kami kirim tautan baru.",
};

/** Only the two known codes are accepted from the URL; anything else is ignored (never echoed). */
export function parseConfirmNotice(value: unknown): ConfirmNoticeCode | null {
  return value === "link_expired" || value === "link_invalid" ? value : null;
}

/** Generic text for an unconfirmed sign-in when no resend was attempted. Only ever shown after a correct password. */
export const UNCONFIRMED_LOGIN_MESSAGE =
  "Email Anda belum dikonfirmasi. Buka tautan di email konfirmasi Anda (cek juga folder spam).";

/** What the person is told after a correct password on an unconfirmed address. "sent" is claimed only when Supabase accepted the request. */
export const UNCONFIRMED_RESEND_MESSAGES = {
  sent: "Email Anda belum dikonfirmasi. Kami baru saja mengirim tautan konfirmasi baru. Buka tautan di email itu (cek juga folder spam).",
  wait: "Email Anda belum dikonfirmasi. Permintaan kirim ulang terlalu sering. Cek email Anda (termasuk spam), lalu coba lagi beberapa saat lagi.",
  uncertain:
    "Email Anda belum dikonfirmasi. Kami belum bisa memastikan tautan baru terkirim. Cek email Anda (termasuk spam) sebelum mencoba lagi.",
} as const;

/** Per address: at most one automatic resend per minute and five per fixed one-hour window (in-memory, per server instance). */
export const RESEND_CONFIRMATION_COOLDOWN_SECONDS = 60;
export const RESEND_CONFIRMATION_HOURLY_LIMIT = 5;
