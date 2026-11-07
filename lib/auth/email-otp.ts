/**
 * Email OTP (signup confirmation code) — shared pure helpers. Stage A of the LINOE OTP rollout.
 *
 * The whole feature is OFF unless EMAIL_OTP_ENABLED is exactly "true" (server-side env, never NEXT_PUBLIC). While it
 * is off nothing in the UI changes and the existing /auth/confirm link flow is the only confirmation path.
 */
export function isEmailOtpEnabled(): boolean {
  return process.env.EMAIL_OTP_ENABLED === "true";
}

/**
 * The code length is a Supabase Auth project setting (currently 8 digits, may change), so it is deliberately NOT
 * hard-coded here: any all-digit code of a plausible length is passed to Supabase, which is the only authority on
 * whether it is right. This only rejects obvious junk before spending a request.
 */
export const OTP_MIN_DIGITS = 6;
export const OTP_MAX_DIGITS = 10;
export const OTP_PATTERN = new RegExp(`^\\d{${OTP_MIN_DIGITS},${OTP_MAX_DIGITS}}$`);

/** Removes spaces/dashes people type or paste ("1234 5678"). Never changes digits. */
export function normalizeOtpInput(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
}

/**
 * Live sanitising for the code field: keeps digits only (so "1234 5678", "1234-5678" and pasted text with stray
 * characters all work) and never more than the longest code Supabase can issue. It does not know, and must not guess,
 * the configured length: Supabase is the only authority on whether the code is right.
 */
export function sanitizeOtpInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, OTP_MAX_DIGITS);
}

export const RESEND_COOLDOWN_SECONDS = 60;

export const OTP_MESSAGES = {
  invalidFormat: "Masukkan kode yang dikirim ke email Anda (hanya angka).",
  invalidEmail: "Alamat email tidak valid. Kembali dan periksa email Anda.",
  wrongOrExpired: "Kode salah atau sudah kedaluwarsa. Periksa kode, atau kirim ulang kode baru.",
  tooMany: "Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.",
  notConfirmed: "Verifikasi belum terkonfirmasi. Periksa kode Anda, atau kirim ulang kode baru.",
  uncertainVerify: "Kami belum bisa memastikan hasilnya. Tunggu sebentar, lalu masukkan kode sekali lagi.",
  disabled: "Verifikasi kode belum tersedia. Gunakan tautan di email Anda.",
  signedIn: "Anda sedang masuk. Keluar terlebih dahulu untuk memverifikasi akun lain.",
  resendSent: "Jika email Anda terdaftar dan belum terverifikasi, kode baru telah dikirim. Cek juga folder spam.",
  resendWait: "Tunggu sebentar sebelum meminta kode lagi.",
  resendFailed: "Gagal mengirim ulang kode. Silakan coba lagi nanti.",
  resendUncertain:
    "Kami tidak menerima kepastian dari server, jadi kode baru mungkin sudah terkirim. Cek email Anda (termasuk spam) sebelum meminta lagi.",
} as const;

type AuthLikeError = { status?: number; code?: string; name?: string } | null | undefined;

function isTransportFailure(error: AuthLikeError): boolean {
  if (!error) return false;
  return (
    error.name === "AuthRetryableFetchError" ||
    error.name === "AuthUnknownError" ||
    error.status === 0 ||
    (error.status !== undefined && error.status >= 500)
  );
}

function isRateLimited(error: AuthLikeError): boolean {
  return !!error && (error.status === 429 || (error.code?.includes("rate_limit") ?? false));
}

/** Maps a verifyOtp() failure to a safe message. Never the raw error text. */
export function mapVerifyOtpError(error: AuthLikeError): string {
  if (isRateLimited(error)) return OTP_MESSAGES.tooMany;
  if (isTransportFailure(error)) return OTP_MESSAGES.uncertainVerify;
  return OTP_MESSAGES.wrongOrExpired;
}

/** Maps a resend() failure to a safe message. Never the raw error text; never says whether the email exists. */
export function mapResendError(error: AuthLikeError): { message: string } {
  if (isRateLimited(error)) return { message: OTP_MESSAGES.resendWait };
  if (isTransportFailure(error)) return { message: OTP_MESSAGES.resendUncertain };
  return { message: OTP_MESSAGES.resendFailed };
}
