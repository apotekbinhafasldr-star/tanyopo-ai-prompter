/**
 * Auth recovery messages (signup confirmation). Pure helpers shared by the login page, the login action and the
 * resend action. Nothing here reveals whether an account exists: the "unconfirmed" message is only ever returned for a
 * sign-in whose PASSWORD was correct (Supabase checks the password before the confirmation state), and the resend
 * answer is the same for every address.
 */
export type ConfirmNoticeCode = "link_expired" | "link_invalid";

export const CONFIRM_NOTICE_MESSAGES: Record<ConfirmNoticeCode, string> = {
  link_expired:
    "Tautan konfirmasi sudah kedaluwarsa. Minta tautan baru di bawah. Jika akun Anda sudah aktif, silakan masuk.",
  link_invalid:
    "Tautan konfirmasi tidak berlaku. Bisa jadi sudah dipakai atau terbuka otomatis oleh aplikasi email Anda. " +
    "Jika akun sudah aktif, silakan masuk. Jika belum, minta tautan baru di bawah.",
};

/** Only the two known codes are accepted from the URL; anything else is ignored (never echoed). */
export function parseConfirmNotice(value: unknown): ConfirmNoticeCode | null {
  return value === "link_expired" || value === "link_invalid" ? value : null;
}

export const UNCONFIRMED_LOGIN_MESSAGE =
  "Email Anda belum dikonfirmasi. Buka tautan di email konfirmasi (cek juga folder spam), atau kirim ulang di bawah.";

export const RESEND_CONFIRMATION_MESSAGES = {
  invalidEmail: "Alamat email tidak valid. Periksa lalu coba lagi.",
  signedIn: "Anda sedang masuk. Keluar terlebih dahulu untuk meminta tautan untuk akun lain.",
  /** Same text for every address, whether or not it is registered, unconfirmed or already confirmed. */
  sent: "Jika email itu terdaftar dan belum dikonfirmasi, tautan baru telah dikirim. Cek juga folder spam.",
  wait: "Tunggu sebentar sebelum meminta tautan lagi.",
  uncertain:
    "Kami belum bisa memastikan hasilnya, jadi tautan mungkin sudah terkirim. Cek email Anda (termasuk spam) sebelum meminta lagi.",
} as const;

export const RESEND_CONFIRMATION_COOLDOWN_SECONDS = 60;
