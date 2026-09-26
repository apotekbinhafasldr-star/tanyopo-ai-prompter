/**
 * Maps a supabase.auth.signUp() error to a safe, specific message for the
 * register form — never the raw error.message, which can contain internal
 * infrastructure detail (e.g. the transactional email provider's own
 * rejection text, complete with provider name and account email — this is
 * exactly what a live Production signup failure surfaced: a Resend "550"
 * rejection because the sending domain isn't verified there yet).
 *
 * Only maps categories that are safe to name specifically. Anything this
 * doesn't recognize falls back to the original generic message rather
 * than guessing what a new/unseen error code means.
 */
export function mapSignupError(error: { status?: number; code?: string } | null): string {
  const GENERIC = "Gagal membuat akun. Silakan coba lagi.";

  if (!error) {
    return GENERIC;
  }

  if (error.status === 429 || error.code?.includes("rate_limit")) {
    return "Terlalu banyak percobaan pendaftaran. Silakan coba lagi dalam beberapa menit.";
  }

  if (error.code === "weak_password") {
    return "Kata sandi belum memenuhi syarat keamanan. Gunakan kombinasi yang lebih kuat.";
  }

  if (error.code === "email_address_invalid") {
    return "Alamat email tidak valid atau tidak dapat digunakan.";
  }

  if (error.code === "signup_disabled") {
    return "Pendaftaran akun baru sedang tidak tersedia. Silakan coba lagi nanti.";
  }

  if (error.status !== undefined && error.status >= 500) {
    return "Layanan pendaftaran sedang mengalami gangguan. Silakan coba lagi dalam beberapa saat.";
  }

  return GENERIC;
}
